import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** Minimal on-disk JSON cache with per-entry TTL. */
export class DiskCache {
  constructor(private readonly dir: string) {}

  private file(key: string): string {
    const h = crypto.createHash("sha256").update(key).digest("hex");
    return path.join(this.dir, `${h}.json`);
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await fs.readFile(this.file(key), "utf8");
      const { expires, value } = JSON.parse(raw) as { expires: number; value: T };
      return Date.now() < expires ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const expires = Date.now() + ttlSeconds * 1000;
      await fs.writeFile(this.file(key), JSON.stringify({ expires, value }));
    } catch {
      // Cache failures must never break a tool call.
    }
  }
}

/** Stable JSON: object keys sorted recursively. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function cacheKey(tool: string, args: Record<string, unknown>): string {
  return `${tool}:${stableStringify(args)}`;
}
