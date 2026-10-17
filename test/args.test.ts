import { expect, test } from "bun:test";
import { optionalString, stringList, venueTier } from "../src/args";
import { looksLikeRorId, normalizeRorId } from "../src/ror";
import { planSearch } from "../src/plan";
import { resolveVenues, s2VenueNames, VENUES } from "../src/venues";

test("stringList rejects non-string items and enforces the cap", () => {
  expect(stringList(undefined, "x")).toBeUndefined();
  expect(stringList(["a", " b "], "x")).toEqual(["a", "b"]);
  expect(stringList("MIT", "x")).toEqual(["MIT"]); // a lone string is one item, not characters
  expect(() => stringList([1], "x")).toThrow("array of strings");
  expect(() => stringList({}, "x")).toThrow();
  expect(() => stringList(["a", "b", "c"], "x", 2)).toThrow("at most 2");
});

test("venueTier coerces '1' and rejects other values", () => {
  expect(venueTier("1")).toBe(1);
  expect(venueTier(2)).toBe(2);
  expect(venueTier(undefined)).toBeUndefined();
  expect(() => venueTier(3)).toThrow();
  expect(() => venueTier("top")).toThrow();
});

test("optionalString accepts a numeric year", () => {
  expect(optionalString(2023, "year")).toBe("2023");
  expect(optionalString("  ", "year")).toBeUndefined();
  expect(() => optionalString({}, "year")).toThrow();
});

test("normalizeRorId rejects ids embedded in other text", () => {
  expect(normalizeRorId("https://ror.org/00971b260/")).toBe("https://ror.org/00971b260");
  expect(normalizeRorId("ror.org/00971b260")).toBe("https://ror.org/00971b260");
  for (const bad of ["see 00971b260", "00971b260 please", "https://example.com/00971b260", "x00971b260"]) {
    expect(() => normalizeRorId(bad)).toThrow();
    expect(looksLikeRorId(bad)).toBe(false);
  }
});

test("s2VenueNames stays under the size cap and puts canonical names first", () => {
  const all = resolveVenues(undefined, { tier: 2 });
  expect(all.venues.length).toBe(VENUES.length);
  const { names, truncated } = s2VenueNames(all, 400);
  expect(names.join(",").length).toBeLessThanOrEqual(400);
  expect(truncated).toBe(true);
  // canonical names are added before any alias
  expect(names.slice(0, 3)).toEqual(all.venues.slice(0, 3).map((v) => v.name));

  const full = s2VenueNames(all);
  expect(full.names.join(",").length).toBeLessThanOrEqual(1500);
});

test("a broad selector adds a note when the S2 list is shortened", () => {
  const p = planSearch({
    selector: { tier: 2 },
    rorIds: [],
    enabled: { semanticScholar: true, openalex: false, arxiv: true },
  });
  expect(p.semanticScholar?.venues?.join(",").length).toBeLessThanOrEqual(1500);
  expect(p.notes.join(" ")).toContain("shortened");
});

test("venue and institution filters combine: OpenAlex gets both, others are skipped", () => {
  const p = planSearch({
    venue: ["NeurIPS"],
    selector: { area: "cv", tier: 1 },
    rorIds: ["https://ror.org/00971b260"],
    enabled: { semanticScholar: true, openalex: true, arxiv: true },
  });
  expect(p.openalex?.rorIds).toEqual(["https://ror.org/00971b260"]);
  expect(p.openalex?.sourceIds).toContain("S4363606243"); // NeurIPS by name
  expect(p.openalex?.sourceIds?.length).toBeGreaterThan(1); // plus the cv tier-1 venues
  expect(p.semanticScholar).toBeUndefined();
  expect(p.arxiv).toBe(false);
});
