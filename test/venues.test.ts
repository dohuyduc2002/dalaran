import { expect, test } from "bun:test";
import { planSearch } from "../src/plan";
import { findVenue, listVenues, resolveVenues, s2VenueNames, VENUES } from "../src/venues";

const all = { semanticScholar: true, openalex: true, arxiv: true };

test("registry ids and OpenAlex sources are unique and well-formed", () => {
  expect(new Set(VENUES.map((v) => v.id)).size).toBe(VENUES.length);
  for (const v of VENUES) {
    // ICORE-derived venues may lack OpenAlex ids; they then rely on Semantic Scholar name filters.
    if (v.type === "journal" || v.tierSource === "manual") expect(v.openalexSources.length).toBeGreaterThan(0);
    for (const s of v.openalexSources) expect(s).toMatch(/^S\d+$/);
  }
});

test("findVenue matches id, name, and alias ignoring case/punctuation", () => {
  expect(findVenue("neurips")?.id).toBe("neurips");
  expect(findVenue("NIPS")?.id).toBe("neurips");
  expect(findVenue("Conference on Learning Theory")?.id).toBe("colt");
  expect(findVenue("nonexistent venue")).toBeUndefined();
});

test("listVenues filters by tier, area, and type", () => {
  const nlp1 = listVenues({ tier: 1, area: "nlp" }).map((v) => v.id);
  expect(nlp1).toEqual(expect.arrayContaining(["acl", "emnlp", "tacl"]));
  expect(nlp1.every((id) => findVenue(id)!.tier === 1 && findVenue(id)!.areas.includes("nlp"))).toBe(true);
  expect(listVenues({ tier: 2, area: "nlp" }).length).toBeGreaterThan(nlp1.length);
  expect(listVenues({ type: "journal" }).every((v) => v.type === "journal")).toBe(true);
  expect(listVenues({ tier: 1 }).every((v) => v.tier === 1)).toBe(true);
});

test("resolveVenues unions names with selector and reports unknown names", () => {
  const r = resolveVenues(["ICML", "Some Workshop"], { area: "cv", tier: 1 });
  expect(r.venues.map((v) => v.id)).toContain("icml");
  expect(r.venues.map((v) => v.id)).toContain("cvpr");
  expect(r.unknownNames).toEqual(["Some Workshop"]);
  const { names } = s2VenueNames(r);
  expect(names).toContain("Some Workshop");
  expect(names).toContain("International Conference on Machine Learning");
});

test("plan without filters queries every enabled channel", () => {
  const p = planSearch({ selector: {}, rorIds: [], enabled: all });
  expect(p.arxiv).toBe(true);
  expect(p.semanticScholar).toEqual({});
  expect(p.openalex).toEqual({ sourceIds: undefined, rorIds: undefined });
  expect(p.skipped).toEqual([]);
});

test("venue filter skips arXiv and gives OpenAlex source ids", () => {
  const p = planSearch({ venue: ["NeurIPS"], selector: {}, rorIds: [], enabled: all });
  expect(p.arxiv).toBe(false);
  expect(p.skipped.map((s) => s.source)).toEqual(["arxiv"]);
  expect(p.openalex?.sourceIds).toEqual(["S4363606243"]);
  expect(p.semanticScholar?.venues).toContain("Neural Information Processing Systems");
});

test("institution filter uses OpenAlex only", () => {
  const p = planSearch({
    selector: { tier: 1 },
    rorIds: ["https://ror.org/00971b260"],
    enabled: all,
  });
  expect(p.arxiv).toBe(false);
  expect(p.semanticScholar).toBeUndefined();
  expect(p.skipped.map((s) => s.source).sort()).toEqual(["arxiv", "semantic_scholar"]);
  expect(p.openalex?.rorIds).toEqual(["https://ror.org/00971b260"]);
  expect(p.openalex?.sourceIds?.length).toBeGreaterThan(0);
});

test("unregistered venue name is not sent to OpenAlex", () => {
  const p = planSearch({ venue: ["Some Workshop"], selector: {}, rorIds: [], enabled: all });
  expect(p.openalex).toBeUndefined();
  expect(p.skipped.some((s) => s.source === "openalex")).toBe(true);
  expect(p.semanticScholar?.venues).toEqual(["Some Workshop"]);
});

test("selector matching nothing is an error, not an unfiltered search", () => {
  expect(() => planSearch({ selector: { area: "no-such-area" }, rorIds: [], enabled: all })).toThrow();
});

test("a disabled channel is never planned", () => {
  const p = planSearch({ selector: {}, rorIds: [], enabled: { ...all, openalex: false } });
  expect(p.openalex).toBeUndefined();
});

test("a registered venue without an OpenAlex id is reported, not silently dropped", () => {
  const noIds = VENUES.find((v) => v.type === "conference" && !v.openalexSources.length)!;
  const alone = planSearch({ venue: [noIds.name], selector: {}, rorIds: [], enabled: all });
  expect(alone.openalex).toBeUndefined();
  expect(alone.skipped.find((s) => s.source === "openalex")?.reason).toContain(noIds.name);

  const mixed = planSearch({ venue: [noIds.name, "NeurIPS"], selector: {}, rorIds: [], enabled: all });
  expect(mixed.openalex?.sourceIds).toEqual(["S4363606243"]);
  expect(mixed.notes[0]).toContain(noIds.name);
});

test("ICORE-derived tiers match ICORE ranks", () => {
  for (const v of VENUES.filter((x) => x.tierSource === "icore")) {
    expect(v.tier).toBe(v.icore === "A*" ? 1 : 2);
  }
});
