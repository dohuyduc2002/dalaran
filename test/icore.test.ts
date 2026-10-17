import { expect, test } from "bun:test";
import { mergeIcore, parseCsv, parseIcore, pickSources, selectRows, serializeRegistry } from "../scripts/icore";
import type { Venue } from "../src/venues";

// Shape of the real ICORE export: no header, id,title,acronym,source,rank,dblp,for1,for2,for3.
const csv = [
  `1,"International Conference on Machine Learning",ICML,ICORE2026,A*,Yes,4611,,`,
  `2,"Conference, with ""quotes""",QQ,ICORE2026,A,Yes,4602,4611,`,
  `3,Asian Conference on Machine Learning,ACML,ICORE2026,C,Yes,4611,,`,
  `4,Operating Systems Conf,OSDI,ICORE2026,A*,Yes,4606,,`,
  `5,Brand New Vision Conf,BNVC,ICORE2026,A,Yes,4603,,`,
].join("\r\n");

const venue = (o: Partial<Venue>): Venue => ({
  id: "x", name: "X", aliases: [], type: "conference", areas: [], tier: 1, openalexSources: [], ...o,
});

test("parseCsv handles quotes, commas, escaped quotes and CRLF", () => {
  const rows = parseCsv(csv);
  expect(rows).toHaveLength(5);
  expect(rows[1][1]).toBe('Conference, with "quotes"');
});

test("selectRows keeps A*/A in ML/AI fields only", () => {
  expect(selectRows(parseIcore(csv)).map((r) => r.acronym)).toEqual(["ICML", "QQ", "BNVC"]);
});

test("mergeIcore updates managed, protects manual and journals, drops stale, adds new", () => {
  const existing: Venue[] = [
    venue({ id: "icml", name: "ICML", tier: 2, openalexSources: ["S1"], tierSource: "icore" }),
    venue({ id: "gone", name: "GONE", tierSource: "icore" }),
    venue({ id: "qq", name: "QQ", tier: 1, tierSource: "manual" }),
    venue({ id: "jmlr", name: "JMLR", type: "journal" }),
  ];
  const { venues, report } = mergeIcore(existing, parseIcore(csv));
  const by = Object.fromEntries(venues.map((v) => [v.id, v]));

  expect(by.icml.tier).toBe(1); // A* => tier 1, re-derived
  expect(by.icml.icore).toBe("A*");
  expect(by.icml.openalexSources).toEqual(["S1"]); // curated ids survive
  expect(by.icml.aliases).toContain("International Conference on Machine Learning");
  expect(by.gone).toBeUndefined();
  expect(by.qq.tier).toBe(1); // manual untouched even though ICORE says A
  expect(by.qq.icore).toBeUndefined();
  expect(by.jmlr).toBeDefined();
  expect(by.bnvc).toMatchObject({ tier: 2, icore: "A", areas: ["cv"], openalexSources: [], tierSource: "icore" });
  expect(report).toMatchObject({ added: ["BNVC"], removed: ["GONE"], keptManual: ["QQ"] });
});

test("mergeIcore is idempotent", () => {
  const once = mergeIcore([], parseIcore(csv)).venues;
  const twice = mergeIcore(once, parseIcore(csv));
  expect(twice.venues).toEqual(once);
  expect(twice.report.updated).toEqual([]);
});

test("serializeRegistry round-trips as JSON", () => {
  const v = mergeIcore([], parseIcore(csv)).venues;
  expect(JSON.parse(serializeRegistry(v))).toEqual(v);
});

test("pickSources accepts exact/parenthesised names only", () => {
  const cands = [
    { id: "https://openalex.org/S1", display_name: "Annual Meeting of the Association for Computational Linguistics (ACL)", type: "conference", works_count: 900 },
    { id: "https://openalex.org/S2", display_name: "Annual Meeting of the Association for Computational Linguistics: System Demonstrations (ACL Demo)", type: "conference", works_count: 100 },
    { id: "https://openalex.org/S3", display_name: "Association for Computational Linguistics", type: "conference", works_count: 10 },
    { id: "https://openalex.org/S4", display_name: "ACL", type: "journal", works_count: 900 },
  ];
  expect(pickSources({ name: "ACL", aliases: ["Association for Computational Linguistics"] }, cands)).toEqual(["S1"]);
});

test("pickSources rejects acronym collisions seen in the first live run", () => {
  const c = (id: string, display_name: string) => ({ id, display_name, type: "conference", works_count: 500 });
  const pick = (name: string, title: string, cands: ReturnType<typeof c>[]) =>
    pickSources({ name, aliases: [title] }, cands);

  expect(
    pick("ISWC", "International Semantic Web Conference", [
      c("S1", "ACM International Symposium on Wearable Computers (ISWC)"),
      c("S2", "International Semantic Web Conference (ISWC)"),
    ]),
  ).toEqual(["S2"]);
  expect(
    pick("SDM", "SIAM International Conference on Data Mining", [
      c("S1", "AIAA/ASME/ASCE/AHS/ASC Structures, Structural Dynamics, and Materials Conference (SDM)"),
      c("S2", "SIAM International Conference on Data Mining (SDM)"),
    ]),
  ).toEqual(["S2"]);
  expect(
    pick("ECAI", "European Conference on Artificial Intelligence", [
      c("S1", "International Conference on Electronics, Computers and Artificial Intelligence (ECAI)"),
      c("S2", "European Conference on Artificial Intelligence (ECAI)"),
    ]),
  ).toEqual(["S2"]);
  expect(
    pick("ICDT", "International Conference on Database Theory", [
      c("S1", "International Conference on Disruptive Technologies (ICDT)"),
      c("S2", "International Conference on Database Theory (ICDT)"),
    ]),
  ).toEqual(["S2"]);
});
