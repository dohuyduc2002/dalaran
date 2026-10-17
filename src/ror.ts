import type { Json } from "./semanticScholar.js";

const ROR_API = "https://api.ror.org/v2/organizations";
const ROR_ID_RE = /(0[a-hj-km-np-tv-z0-9]{6}[0-9]{2})\b/i;

/** Accept `00971b260`, `ror.org/00971b260`, or the full URL; return the canonical URL. */
export function normalizeRorId(raw: string): string {
  const m = ROR_ID_RE.exec((raw ?? "").trim());
  if (!m) throw new Error(`Invalid ROR id: ${JSON.stringify(raw)}. Expected e.g. https://ror.org/00971b260`);
  return `https://ror.org/${m[1].toLowerCase()}`;
}

/** True for ROR ids and ror.org URLs, false for free-text names. */
export const looksLikeRorId = (raw: string): boolean =>
  /ror\.org\//i.test(raw) || new RegExp(`^${ROR_ID_RE.source}$`, "i").test(raw.trim());

const nameOfType = (names: Json[], type: string) =>
  names.filter((n) => n.types?.includes(type)).map((n) => n.value as string);

/** Flatten a ROR v2 record into the fields an agent needs. */
export function normalizeOrganization(org: Json): Json {
  const names: Json[] = org.names ?? [];
  const loc = org.locations?.[0]?.geonames_details ?? {};
  const link = (t: string) => (org.links ?? []).find((l: Json) => l.type === t)?.value ?? null;
  const ext = (t: string) => (org.external_ids ?? []).find((e: Json) => e.type === t)?.preferred ?? null;
  const name = nameOfType(names, "ror_display")[0] ?? names[0]?.value ?? null;
  const rel = (t: string) =>
    (org.relationships ?? [])
      .filter((r: Json) => r.type === t)
      .map((r: Json) => ({ ror_id: r.id, name: r.label }));
  return {
    ror_id: org.id,
    name,
    aliases: [...new Set([...nameOfType(names, "alias"), ...nameOfType(names, "label")])].filter(
      (n) => n !== name,
    ),
    acronyms: nameOfType(names, "acronym"),
    types: org.types ?? [],
    status: org.status ?? null,
    country_code: loc.country_code ?? null,
    country: loc.country_name ?? null,
    city: loc.name ?? null,
    website: link("website"),
    wikipedia: link("wikipedia"),
    domains: org.domains ?? [],
    established: org.established ?? null,
    parents: rel("parent"),
    children: rel("child"),
    related: rel("related"),
    external_ids: { wikidata: ext("wikidata"), isni: ext("isni"), grid: ext("grid"), fundref: ext("fundref") },
  };
}

export interface RorSearchOptions {
  /** ROR types, e.g. education, company, nonprofit, government, facility. */
  types?: string[];
  /** ISO 3166-1 alpha-2, e.g. US. */
  country?: string;
  limit?: number;
}

/** Research Organization Registry client (https://ror.readme.io/v2/docs/api-v2). No key needed. */
export class RorClient {
  constructor(
    private readonly timeoutMs = 10_000,
    private readonly base = ROR_API,
  ) {}

  private async get(url: URL): Promise<Json> {
    const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (res.status === 404) throw new Error("ROR: organization not found");
    if (!res.ok) throw new Error(`ROR ${res.status} ${res.statusText}`);
    return (await res.json()) as Json;
  }

  async search(query: string, { types, country, limit = 10 }: RorSearchOptions = {}): Promise<Json> {
    const url = new URL(this.base);
    url.searchParams.set("query", query.trim());
    const filters: string[] = [];
    if (types?.length) filters.push(`types:${types.join(",")}`);
    if (country) filters.push(`locations.geonames_details.country_code:${country.toUpperCase()}`);
    if (filters.length) url.searchParams.set("filter", filters.join(","));
    const data = await this.get(url);
    const items: Json[] = (data.items ?? []).slice(0, Math.min(Math.max(1, limit), 20));
    return { total: data.number_of_results ?? items.length, data: items.map(normalizeOrganization) };
  }

  async getById(rorId: string): Promise<Json> {
    const id = normalizeRorId(rorId);
    return normalizeOrganization(await this.get(new URL(`${this.base}/${id.split("/").pop()}`)));
  }

  /**
   * Resolve a free-text affiliation using ROR's matcher. Only `chosen` matches are
   * trusted; otherwise returns the candidates so the caller can ask for an explicit id.
   */
  async resolveAffiliation(name: string): Promise<{ chosen?: Json; candidates: Json[] }> {
    const url = new URL(this.base);
    url.searchParams.set("affiliation", name.trim());
    const data = await this.get(url);
    const items: Json[] = data.items ?? [];
    const chosen = items.find((i) => i.chosen);
    return {
      chosen: chosen && normalizeOrganization(chosen.organization),
      candidates: items.slice(0, 5).map((i) => ({ ...normalizeOrganization(i.organization), score: i.score })),
    };
  }
}
