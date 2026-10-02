import { expect, test } from "bun:test";
import { arxivIdFromUrl, normalizeArxivSourceId } from "../src/arxiv";

test("arxivIdFromUrl strips version", () => {
  expect(arxivIdFromUrl("http://arxiv.org/abs/2201.00978v1")).toBe("2201.00978");
  expect(arxivIdFromUrl("")).toBe("");
});

test("normalizeArxivSourceId", () => {
  expect(normalizeArxivSourceId("arXiv:2503.23278")).toBe("2503.23278");
  expect(normalizeArxivSourceId("https://arxiv.org/abs/2503.23278v2")).toBe("2503.23278v2");
  expect(normalizeArxivSourceId("  2503.23278 ")).toBe("2503.23278");
});
