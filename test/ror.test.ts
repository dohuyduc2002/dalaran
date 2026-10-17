import { afterEach, expect, test } from "bun:test";
import { looksLikeRorId, normalizeOrganization, normalizeRorId, RorClient } from "../src/ror";

// Trimmed from a live api.ror.org/v2 response for Google DeepMind.
const deepmind = {
  id: "https://ror.org/00971b260",
  domains: ["deepmind.google"],
  established: 2010,
  external_ids: [
    { type: "fundref", preferred: "100017149", all: ["100017149"] },
    { type: "isni", preferred: null, all: ["0000 0004 5999 1726"] },
  ],
  links: [{ type: "website", value: "https://deepmind.google" }],
  locations: [{ geonames_details: { country_code: "GB", country_name: "United Kingdom", name: "London" } }],
  names: [
    { types: ["alias"], value: "DeepMind" },
    { types: ["label"], value: "Google DeepMind" },
    { types: ["label", "ror_display"], value: "Google DeepMind (United Kingdom)" },
  ],
  relationships: [{ type: "parent", id: "https://ror.org/02e9yx751", label: "Alphabet (United States)" }],
  status: "active",
  types: ["company", "funder"],
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const mockFetch = (fn: (url: URL) => Response) => {
  globalThis.fetch = (async (u: any) => fn(new URL(String(u)))) as typeof fetch;
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("normalizeRorId accepts id, host path, and URL", () => {
  for (const s of ["00971b260", "ror.org/00971b260", "https://ror.org/00971B260"]) {
    expect(normalizeRorId(s)).toBe("https://ror.org/00971b260");
  }
  expect(() => normalizeRorId("Stanford")).toThrow();
});

test("looksLikeRorId separates ids from names", () => {
  expect(looksLikeRorId("https://ror.org/00971b260")).toBe(true);
  expect(looksLikeRorId("00971b260")).toBe(true);
  expect(looksLikeRorId("Stanford University")).toBe(false);
  expect(looksLikeRorId("MIT")).toBe(false);
});

test("normalizeOrganization flattens a ROR v2 record", () => {
  const o = normalizeOrganization(deepmind);
  expect(o.name).toBe("Google DeepMind (United Kingdom)");
  expect(o.aliases).toEqual(["DeepMind", "Google DeepMind"]);
  expect(o.country_code).toBe("GB");
  expect(o.website).toBe("https://deepmind.google");
  expect(o.parents).toEqual([{ ror_id: "https://ror.org/02e9yx751", name: "Alphabet (United States)" }]);
  expect(o.external_ids.fundref).toBe("100017149");
});

test("search sends filters and truncates to limit", async () => {
  let seen: URL | undefined;
  mockFetch((u) => {
    seen = u;
    return json({ number_of_results: 3, items: [deepmind, deepmind, deepmind] });
  });
  const r = await new RorClient().search(" deepmind ", { types: ["company"], country: "gb", limit: 2 });
  expect(seen?.searchParams.get("query")).toBe("deepmind");
  expect(seen?.searchParams.get("filter")).toBe(
    "types:company,locations.geonames_details.country_code:GB",
  );
  expect(r.total).toBe(3);
  expect(r.data).toHaveLength(2);
});

test("resolveAffiliation trusts only chosen matches", async () => {
  mockFetch(() =>
    json({ items: [{ chosen: false, score: 0.7, organization: deepmind }] }),
  );
  const miss = await new RorClient().resolveAffiliation("MIT");
  expect(miss.chosen).toBeUndefined();
  expect(miss.candidates).toHaveLength(1);

  mockFetch(() => json({ items: [{ chosen: true, score: 1, organization: deepmind }] }));
  const hit = await new RorClient().resolveAffiliation("Google DeepMind");
  expect(hit.chosen?.ror_id).toBe("https://ror.org/00971b260");
});

test("getById maps 404 to a clear error", async () => {
  mockFetch(() => json({}, 404));
  await expect(new RorClient().getById("00971b260")).rejects.toThrow("not found");
});
