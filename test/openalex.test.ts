import { afterEach, expect, test } from "bun:test";
import { mergeParallelSearchResults } from "../src/merge";
import { abstractFromInvertedIndex, buildFilter, OpenAlexClient, workToPaper } from "../src/openalex";

// Trimmed from a live api.openalex.org/works response.
const work = {
  id: "https://openalex.org/W7133191858",
  doi: "https://doi.org/10.52202/075280-0082",
  title: "A generative model of the hippocampal  formation",
  publication_year: 2023,
  publication_date: "2023-12-10",
  cited_by_count: 10,
  referenced_works_count: 40,
  type: "conference-paper",
  primary_location: { source: { display_name: "neural information processing systems" } },
  abstract_inverted_index: { Abstract: [0], models: [2], Generative: [1] },
  authorships: [
    {
      author: { display_name: "Tom M George" },
      institutions: [{ display_name: "University College London", ror: "https://ror.org/02jx3x895", country_code: "GB" }],
    },
    { author: { display_name: "Caswell Barry" }, institutions: [] },
  ],
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("abstractFromInvertedIndex restores word order", () => {
  expect(abstractFromInvertedIndex({ Abstract: [0], models: [2], Generative: [1] })).toBe(
    "Abstract Generative models",
  );
  expect(abstractFromInvertedIndex(null)).toBeNull();
});

test("workToPaper normalizes to the shared paper shape with institutions", () => {
  const p = workToPaper(work)!;
  expect(p.paperId).toBe("W7133191858");
  expect(p.title).toBe("A generative model of the hippocampal formation");
  expect(p.venue).toBe("neural information processing systems");
  expect(p.source).toBe("openalex");
  expect(p.authors[0]).toEqual({
    name: "Tom M George",
    institutions: [{ name: "University College London", ror: "https://ror.org/02jx3x895", countryCode: "GB" }],
  });
  expect(workToPaper({ ...work, title: null })).toBeNull();
});

test("buildFilter ORs ids within a field and ANDs fields", () => {
  expect(buildFilter({})).toBe("");
  expect(
    buildFilter({ year: "2021-2023", sourceIds: ["S1", "S2"], rorIds: ["https://ror.org/a", "https://ror.org/b"] }),
  ).toBe(
    "publication_year:2021-2023,primary_location.source.id:S1|S2,authorships.institutions.ror:https://ror.org/a|https://ror.org/b",
  );
});

test("search sends bearer key and filter, and parses results", async () => {
  let req: { url: URL; headers: Headers } | undefined;
  globalThis.fetch = (async (u: any, init: any) => {
    req = { url: new URL(String(u)), headers: new Headers(init.headers) };
    return new Response(JSON.stringify({ results: [work, { ...work, title: null }] }));
  }) as typeof fetch;
  const r = await new OpenAlexClient("k").search({ query: "diffusion", limit: 500, sourceIds: ["S1"] });
  expect(req?.headers.get("authorization")).toBe("Bearer k");
  expect(req?.url.searchParams.get("per-page")).toBe("100");
  expect(req?.url.searchParams.get("filter")).toBe("primary_location.source.id:S1");
  expect(req?.url.searchParams.has("api_key")).toBe(false);
  expect(r.entries).toHaveLength(1);
});

test("search fails fast on an exhausted budget", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("{}", { status: 429 });
  }) as typeof fetch;
  await expect(new OpenAlexClient().search({ query: "x", limit: 5 })).rejects.toThrow("OPENALEX_API_KEY");
  expect(calls).toBe(1);
});

test("merge keeps OpenAlex affiliations when Semantic Scholar wins the duplicate", () => {
  const s2 = { title: "Same Paper", authors: [{ name: "Tom M George" }], citationCount: 5, source: "semantic_scholar" };
  const oa = workToPaper({ ...work, title: "Same Paper" })!;
  const merged = mergeParallelSearchResults({ semantic_scholar: [s2], openalex: [oa], arxiv: [] }, 10);
  expect(merged.data).toHaveLength(1);
  expect(merged.data[0].citationCount).toBe(10);
  expect(merged.data[0].sources).toEqual(["semantic_scholar", "openalex"]);
  expect(merged.data[0].authors[0].institutions[0].ror).toBe("https://ror.org/02jx3x895");
  expect(s2.authors[0]).toEqual({ name: "Tom M George" }); // inputs not mutated
});
