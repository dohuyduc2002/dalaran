import { afterEach, expect, test } from "bun:test";
import { SemanticScholarClient } from "../src/semanticScholar";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("gives up on 429 once the retry-wait budget is exceeded", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("{}", { status: 429 });
  }) as typeof fetch;
  const started = performance.now();
  // Budget 0 => the first backoff (1s) already exceeds it, so no sleeping at all.
  await expect(new SemanticScholarClient(undefined, 0).searchPapers("x")).rejects.toThrow("rate limited");
  expect(calls).toBe(1);
  expect(performance.now() - started).toBeLessThan(500);
});
