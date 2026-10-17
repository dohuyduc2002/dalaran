#!/usr/bin/env bun
// Refresh src/venues.json from the ICORE conference ranking export.
//   bun scripts/sync-icore.ts [--csv path] [--resolve-openalex] [--dry-run]
// Mark an entry `"tierSource": "manual"` in venues.json to protect it from this script.
import fs from "node:fs";
import path from "node:path";
import { mergeIcore, parseIcore, pickSources, serializeRegistry } from "./icore";
import type { Venue } from "../src/venues";

const ICORE_URL =
  "https://portal.core.edu.au/conf-ranks/?search=&by=all&source=ICORE2026&sort=arank&page=1&do=Export";
const REGISTRY = path.join(import.meta.dir, "../src/venues.json");

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const csvPath = args[args.indexOf("--csv") + 1];

const csv = csvPath && args.includes("--csv")
  ? fs.readFileSync(csvPath, "utf8")
  : await (async () => {
      const res = await fetch(ICORE_URL);
      if (!res.ok) throw new Error(`ICORE export failed: ${res.status}`);
      return res.text();
    })();

const existing = JSON.parse(fs.readFileSync(REGISTRY, "utf8")) as Venue[];
const { venues, report } = mergeIcore(existing, parseIcore(csv));

if (flag("--resolve-openalex")) {
  const key = process.env.OPENALEX_API_KEY;
  const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
  let resolved = 0;
  for (const v of venues.filter((x) => x.type === "conference" && !x.openalexSources.length)) {
    const found = new Map<string, any>();
    for (const q of [v.aliases[0] ?? v.name, v.name]) {
      const url = new URL("https://api.openalex.org/sources");
      url.searchParams.set("search", q);
      url.searchParams.set("per-page", "10");
      url.searchParams.set("select", "id,display_name,type,works_count");
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`OpenAlex ${res.status} while resolving ${v.name}`);
      for (const c of ((await res.json()) as any).results ?? []) found.set(c.id, c);
      await Bun.sleep(120);
    }
    v.openalexSources = pickSources(v, [...found.values()]);
    if (v.openalexSources.length) resolved++;
  }
  console.error(`OpenAlex: resolved sources for ${resolved} venues`);
}

const unresolved = venues.filter((v) => v.type === "conference" && !v.openalexSources.length).map((v) => v.name);
console.error(
  `added ${report.added.length}, updated ${report.updated.length}, removed ${report.removed.length}, ` +
    `kept manual ${report.keptManual.length}`,
);
if (report.removed.length) console.error(`removed (no longer A*/A in selected fields): ${report.removed.join(", ")}`);
if (unresolved.length) console.error(`no OpenAlex source (Semantic Scholar name filter only): ${unresolved.join(", ")}`);

if (flag("--dry-run")) console.error("dry run: registry not written");
else fs.writeFileSync(REGISTRY, serializeRegistry(venues));
