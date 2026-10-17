/** Validation for tool arguments. MCP clients can send any JSON, so never trust the declared schema. */

export const MAX_INSTITUTIONS = 10;

/** A string[] (a lone string is accepted as a one-item list). Strings are trimmed; blanks dropped. */
export function stringList(value: unknown, name: string, max = Infinity): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const list = typeof value === "string" ? [value] : value;
  if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) {
    throw new Error(`Argument ${name} must be an array of strings`);
  }
  const out = list.map((s) => s.trim()).filter(Boolean);
  if (out.length > max) throw new Error(`Argument ${name} accepts at most ${max} items (got ${out.length})`);
  return out;
}

/** An optional venue tier: 1 or 2, also accepting "1" / "2". */
export function venueTier(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (n !== 1 && n !== 2) throw new Error("Argument venue_tier must be 1 or 2");
  return n;
}

export function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value); // year: 2023
  if (typeof value !== "string") throw new Error(`Argument ${name} must be a string`);
  return value.trim() || undefined;
}
