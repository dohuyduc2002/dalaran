import registry from "./venues.json";

export interface Venue {
  id: string;
  name: string;
  aliases: string[];
  type: "conference" | "journal";
  areas: string[];
  /** 1 = flagship venue, 2 = strong venue. Curated; see README. */
  tier: 1 | 2;
  /** OpenAlex source ids (`S...`). One venue can span several (OpenAlex splits them). */
  openalexSources: string[];
  /** ICORE rank this tier was derived from, when `tierSource` is "icore". */
  icore?: string;
  /** "manual" entries are never overwritten by scripts/sync-icore.ts. Journals are always manual. */
  tierSource?: "icore" | "manual";
}

export const VENUES = registry as Venue[];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const byName = new Map<string, Venue>();
for (const v of VENUES) for (const n of [v.id, v.name, ...v.aliases]) byName.set(norm(n), v);

export function findVenue(name: string): Venue | undefined {
  return byName.get(norm(name));
}

export interface VenueSelector {
  /** Include venues with tier <= this value. */
  tier?: number;
  area?: string;
  type?: string;
}

export function listVenues({ tier, area, type }: VenueSelector = {}): Venue[] {
  return VENUES.filter(
    (v) =>
      (tier === undefined || v.tier <= tier) &&
      (!area || v.areas.includes(area.toLowerCase())) &&
      (!type || v.type === type.toLowerCase()),
  );
}

export interface ResolvedVenues {
  venues: Venue[];
  /** Names not in the registry; only channels that filter by venue name can use them. */
  unknownNames: string[];
}

/** Union of registry matches for explicit names and for the tier/area selector. */
export function resolveVenues(names: string[] | undefined, selector: VenueSelector): ResolvedVenues {
  const out = new Map<string, Venue>();
  const unknownNames: string[] = [];
  for (const n of names ?? []) {
    const v = findVenue(n);
    if (v) out.set(v.id, v);
    else unknownNames.push(n);
  }
  if (selector.tier !== undefined || selector.area || selector.type) {
    for (const v of listVenues(selector)) out.set(v.id, v);
  }
  return { venues: [...out.values()], unknownNames };
}

/**
 * Names for Semantic Scholar's comma-joined `venue` param, bounded so a broad selector
 * (e.g. venue_tier 2) cannot build a URL the API rejects. Canonical names go first for every
 * venue, then aliases while there is room. `truncated` lists venues whose aliases were cut.
 */
export function s2VenueNames(
  { venues, unknownNames }: ResolvedVenues,
  maxChars = 1500,
): { names: string[]; truncated: boolean } {
  const names: string[] = [];
  let used = 0;
  let truncated = false;
  const add = (n: string) => {
    if (names.includes(n)) return;
    if (used + n.length + 1 > maxChars) return void (truncated = true);
    names.push(n);
    used += n.length + 1;
  };
  for (const n of unknownNames) add(n);
  for (const v of venues) add(v.name);
  for (const v of venues) for (const a of v.aliases) add(a);
  return { names, truncated };
}
