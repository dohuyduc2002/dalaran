import type { Json } from "./semanticScholar.js";

const OPENALEX_API = "https://api.openalex.org/works";

const SELECT = [
  "id", "doi", "title", "publication_year", "publication_date", "cited_by_count",
  "referenced_works_count", "type", "primary_location", "authorships", "abstract_inverted_index",
].join(",");

/** OpenAlex stores abstracts as {word: [positions]}; rebuild the text. */
export function abstractFromInvertedIndex(idx: Record<string, number[]> | null | undefined): string | null {
  if (!idx) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(idx)) for (const p of positions) words[p] = word;
  const text = words.filter((w) => w !== undefined).join(" ").trim();
  return text || null;
}

const shortId = (url: string) => url.split("/").pop() ?? url;

export function workToPaper(w: Json): Json | null {
  if (!w.title) return null;
  const source = w.primary_location?.source;
  const authors = ((w.authorships ?? []) as Json[])
    .map((a) => ({
      name: a.author?.display_name as string,
      institutions: ((a.institutions ?? []) as Json[]).map((i) => ({
        name: i.display_name,
        ror: i.ror ?? null,
        countryCode: i.country_code ?? null,
      })),
    }))
    .filter((a) => a.name);
  return {
    paperId: shortId(w.id),
    title: String(w.title).replace(/\s+/g, " ").trim(),
    abstract: abstractFromInvertedIndex(w.abstract_inverted_index),
    year: w.publication_year ?? null,
    authors,
    citationCount: w.cited_by_count ?? null,
    referenceCount: w.referenced_works_count ?? null,
    influentialCitationCount: null,
    venue: source?.display_name ?? null,
    publicationTypes: w.type ? [w.type] : null,
    publicationDate: w.publication_date ?? null,
    url: w.doi ?? w.id,
    source: "openalex",
  };
}

export interface OpenAlexSearch {
  query: string;
  limit: number;
  /** "2023" or "2020-2023". */
  year?: string;
  /** OpenAlex source ids (`S...`) of the venues to restrict to. */
  sourceIds?: string[];
  /** ROR ids (URLs) of institutions; matches any authorship. */
  rorIds?: string[];
}

export function buildFilter({ year, sourceIds, rorIds }: Omit<OpenAlexSearch, "query" | "limit">): string {
  const f: string[] = [];
  if (year) f.push(`publication_year:${year.trim()}`);
  if (sourceIds?.length) f.push(`primary_location.source.id:${sourceIds.join("|")}`);
  if (rorIds?.length) f.push(`authorships.institutions.ror:${rorIds.join("|")}`);
  return f.join(",");
}

/** OpenAlex works client (https://docs.openalex.org). Fails fast: no retries on 429/403. */
export class OpenAlexClient {
  constructor(
    private readonly apiKey?: string,
    private readonly timeoutMs = 15_000,
    private readonly base = OPENALEX_API,
  ) {}

  async search(opts: OpenAlexSearch): Promise<{ entries: Json[] }> {
    const url = new URL(this.base);
    url.searchParams.set("search", opts.query.trim());
    url.searchParams.set("per-page", String(Math.min(Math.max(1, opts.limit), 100)));
    url.searchParams.set("select", SELECT);
    const filter = buildFilter(opts);
    if (filter) url.searchParams.set("filter", filter);

    const headers: Record<string, string> = {};
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    if (res.status === 429 || res.status === 402 || res.status === 403) {
      throw new Error(
        `OpenAlex ${res.status}: daily budget exhausted or key not activated` +
          (this.apiKey ? "" : " (no OPENALEX_API_KEY set; unauthenticated calls share a small per-IP budget)"),
      );
    }
    if (!res.ok) throw new Error(`OpenAlex ${res.status} ${res.statusText}`);
    const data = (await res.json()) as Json;
    const entries = ((data.results ?? []) as Json[]).map(workToPaper).filter((p): p is Json => p !== null);
    return { entries };
  }
}
