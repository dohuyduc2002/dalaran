import { expect, test } from "bun:test";
import { mergeParallelSearchResults } from "../src/merge";

test("dedupes by title, keeps S2 first, merges fields and sources", () => {
  const r = mergeParallelSearchResults(
    {
      semantic_scholar: [
        { title: "Attention  Is All You Need", citationCount: 100, abstract: "short", authors: [{ name: "A" }] },
      ],
      arxiv: [
        {
          title: "attention is all you need",
          citationCount: null,
          abstract: "a much longer abstract",
          authors: [{ name: "a" }, { name: "B" }],
          pdfUrl: "http://x/pdf",
        },
        { title: "Other", source: "arxiv" },
      ],
    },
    10,
  );
  expect(r.total).toBe(2);
  const p = r.data[0];
  expect(p.citationCount).toBe(100);
  expect(p.abstract).toBe("a much longer abstract");
  expect(p.authors.map((a: any) => a.name)).toEqual(["A", "B"]);
  expect(p.pdfUrl).toBe("http://x/pdf");
  expect(p.sources).toEqual(["semantic_scholar", "arxiv"]);
});

test("respects limit", () => {
  const arxiv = [1, 2, 3].map((i) => ({ title: `t${i}` }));
  expect(mergeParallelSearchResults({ arxiv }, 2).data).toHaveLength(2);
});
