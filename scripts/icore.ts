import type { Venue } from "../src/venues";

/** ICORE field-of-research codes we treat as ML/AI-relevant, and the registry area each maps to. */
export const FOR_AREAS: Record<string, string> = {
  "4602": "ai",
  "4603": "cv",
  "4605": "data-mining",
  "4611": "ml",
};

export interface IcoreRow {
  title: string;
  acronym: string;
  rank: string;
  fors: string[];
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") (row.push(field), (field = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) (row.push(field), rows.push(row));
  return rows;
}

/** ICORE export has no header: id,title,acronym,source,rank,dblp,for1,for2,for3. */
export function parseIcore(csv: string): IcoreRow[] {
  return parseCsv(csv)
    .filter((r) => r.length >= 7)
    .map((r) => ({
      title: r[1].trim(),
      acronym: r[2].trim(),
      rank: r[4].trim(),
      fors: r.slice(6, 9).map((f) => f.trim()).filter(Boolean),
    }));
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const tierOf = (rank: string): 1 | 2 | undefined => (rank === "A*" ? 1 : rank === "A" ? 2 : undefined);

/** Rows that belong in the registry: rank A* or A with at least one ML/AI-relevant field code. */
export function selectRows(rows: IcoreRow[]): IcoreRow[] {
  return rows.filter((r) => r.acronym && tierOf(r.rank) && r.fors.some((f) => f in FOR_AREAS));
}

export interface SyncReport {
  updated: string[];
  added: string[];
  removed: string[];
  keptManual: string[];
}

/**
 * Merge ICORE rows into the registry.
 *  - Journals and entries with `tierSource: "manual"` are never touched.
 *  - Other conferences matched in ICORE take their tier from the ICORE rank.
 *  - Managed conferences that dropped below A (or left the selected fields) are removed.
 *  - New rows are appended with no OpenAlex sources (resolve separately).
 */
export function mergeIcore(existing: Venue[], rows: IcoreRow[]): { venues: Venue[]; report: SyncReport } {
  const report: SyncReport = { updated: [], added: [], removed: [], keptManual: [] };
  const wanted = new Map(selectRows(rows).map((r) => [slug(r.acronym), r]));
  const venues: Venue[] = [];
  const seen = new Set<string>();

  for (const v of existing) {
    const manual = v.type === "journal" || v.tierSource === "manual";
    if (manual) {
      if (v.type === "conference") report.keptManual.push(v.name);
      venues.push(v);
      continue;
    }
    const row = wanted.get(slug(v.id)) ?? wanted.get(slug(v.name));
    if (!row) {
      report.removed.push(v.name);
      continue;
    }
    seen.add(slug(row.acronym));
    const areas = [...new Set([...v.areas, ...row.fors.map((f) => FOR_AREAS[f]).filter(Boolean)])];
    const aliases = [...new Set([...v.aliases, row.title])].filter((a) => norm(a) !== norm(v.name));
    const next: Venue = { ...v, aliases, areas, tier: tierOf(row.rank)!, icore: row.rank, tierSource: "icore" };
    if (JSON.stringify(next) !== JSON.stringify(v)) report.updated.push(v.name);
    venues.push(next);
  }

  const fresh = [...wanted.values()]
    .filter((r) => !seen.has(slug(r.acronym)) && !venues.some((v) => slug(v.id) === slug(r.acronym)))
    .sort((a, b) => tierOf(a.rank)! - tierOf(b.rank)! || a.acronym.localeCompare(b.acronym));
  for (const r of fresh) {
    report.added.push(r.acronym);
    venues.push({
      id: slug(r.acronym),
      name: r.acronym,
      aliases: norm(r.title) === norm(r.acronym) ? [] : [r.title],
      type: "conference",
      areas: [...new Set(r.fors.map((f) => FOR_AREAS[f]).filter(Boolean))],
      tier: tierOf(r.rank)!,
      openalexSources: [],
      icore: r.rank,
      tierSource: "icore",
    });
  }
  return { venues, report };
}

/** Keep the registry file's one-entry-per-line style so diffs stay reviewable. */
export function serializeRegistry(venues: Venue[]): string {
  const line = (v: Venue) =>
    "  { " +
    Object.entries(v)
      .filter(([, val]) => val !== undefined)
      .map(([k, val]) => `${JSON.stringify(k)}: ${JSON.stringify(val)}`)
      .join(", ") +
    " }";
  return `[\n${venues.map(line).join(",\n")}\n]\n`;
}

const GENERIC = new Set([
  "international", "conference", "on", "of", "the", "and", "in", "for", "annual", "acm", "ieee",
  "symposium", "workshop", "proceedings", "meeting", "was", "a", "an", "to",
]);
const distinctive = (title: string) => norm(title).split(" ").filter((w) => w.length > 1 && !GENERIC.has(w));

/**
 * Pick OpenAlex conference sources that really are this venue. A source qualifies when its
 * display name equals the venue name or an alias exactly (normalised), or ends in "(ACRONYM)"
 * AND contains every distinctive word of an alias title. The second condition matters:
 * acronym-only matching picked "(ISWC)" wearable computers for the Semantic Web conference and
 * "(SDM)" aerospace conferences for SIAM Data Mining. Unresolved venues stay empty for review.
 */
export function pickSources(
  venue: Pick<Venue, "name" | "aliases">,
  candidates: { id: string; display_name: string; type: string; works_count: number }[],
): string[] {
  const names = new Set([venue.name, ...venue.aliases].map(norm));
  const paren = new RegExp(`\\(${venue.name.replace(/[^a-zA-Z0-9]/g, "")}\\)\\s*$`, "i");
  const titles = venue.aliases.map((a) => distinctive(a)).filter((w) => w.length > 0);
  return candidates
    .filter((c) => c.type === "conference" && c.works_count >= 50)
    .filter((c) => {
      if (names.has(norm(c.display_name))) return true;
      if (!paren.test(c.display_name)) return false;
      const words = new Set(norm(c.display_name).split(" "));
      return titles.some((t) => t.every((w) => words.has(w)));
    })
    .map((c) => c.id.split("/").pop()!);
}
