import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheKey, DiskCache } from "../src/cache";

test("cacheKey ignores key order", () => {
  expect(cacheKey("t", { a: 1, b: { c: 2, d: 3 } })).toBe(cacheKey("t", { b: { d: 3, c: 2 }, a: 1 }));
});

test("DiskCache round-trips and expires", async () => {
  const c = new DiskCache(mkdtempSync(join(tmpdir(), "dalaran-test-")));
  await c.set("k", { x: 1 }, 60);
  expect(await c.get("k")).toEqual({ x: 1 });
  await c.set("old", 1, -1);
  expect(await c.get("old")).toBeUndefined();
  expect(await c.get("missing")).toBeUndefined();
});
