import type { Json } from "./semanticScholar.js";

const normalizeTitleKey = (title?: string | null): string =>
  title ? title.replace(/\s+/g, " ").trim().toLowerCase() : "";

const isEmpty = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

function mergeAuthorLists(base: Json[], incoming: Json[]): Json[] {
  const merged: Json[] = [];
  const seen = new Set<string>();
  for (const a of [...(base ?? []), ...(incoming ?? [])]) {
    if (!a || typeof a !== "object") continue;
    const name = String(a.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(a);
  }
  return merged;
}

/** Keep backward-compatible `source` while exposing all matched channels via `sources[]`. */
function mergeSourceTags(existing: Json, incoming: Json, fallback: string): void {
  const all: string[] = [];
  const add = (s: unknown) => {
    if (typeof s === "string" && s && !all.includes(s)) all.push(s);
  };
  add(existing.source);
  add(incoming.source);
  add(fallback);
  for (const list of [existing.sources, incoming.sources]) {
    if (Array.isArray(list)) list.forEach(add);
  }
  if (all.length) {
    existing.source = all[0];
    existing.sources = all;
  }
}

const NUMERIC_MAX = new Set(["citationCount", "referenceCount", "influentialCitationCount"]);

function mergePaperByTitle(existing: Json, incoming: Json, sourceName: string): void {
  for (const [key, val] of Object.entries(incoming)) {
    if (key === "source" || key === "sources") continue;
    const cur = existing[key];
    if (NUMERIC_MAX.has(key) && Number.isInteger(cur) && Number.isInteger(val)) {
      existing[key] = Math.max(cur, val);
    } else if (key === "abstract" && typeof cur === "string" && typeof val === "string") {
      if (val.trim().length > cur.trim().length) existing[key] = val;
    } else if (key === "authors" && Array.isArray(cur) && Array.isArray(val)) {
      existing[key] = mergeAuthorLists(cur, val);
    } else if (isEmpty(cur) && !isEmpty(val)) {
      existing[key] = val;
    }
  }
  mergeSourceTags(existing, incoming, sourceName);
}

/** Merge multi-source results by normalized title key. */
export function mergeParallelSearchResults(sourceResults: Record<string, Json[]>, limit: number) {
  // Semantic Scholar first to preserve richer citation metadata on duplicates.
  const priority = ["semantic_scholar", "arxiv"];
  const byTitle = new Map<string, Json>();
  for (const source of priority) {
    for (const paper of sourceResults[source] ?? []) {
      if (!paper || typeof paper !== "object") continue;
      paper.source ??= source;
      const key = normalizeTitleKey(paper.title);
      if (!key) continue;
      const existing = byTitle.get(key);
      if (!existing) {
        const copy = { ...paper };
        mergeSourceTags(copy, paper, source);
        byTitle.set(key, copy);
      } else {
        mergePaperByTitle(existing, paper, source);
      }
    }
  }
  const merged = [...byTitle.values()];
  return { total: merged.length, offset: 0, data: merged.slice(0, limit) };
}
