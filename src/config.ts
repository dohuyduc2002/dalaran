import os from "node:os";
import path from "node:path";
import { logger } from "./log.js";

export const CACHE_TTL_SECONDS_DEFAULT = 24 * 60 * 60;

/** Parse env as bool: 1/true/yes (case-insensitive) => true; anything else => false. */
export function envBool(key: string, def = true): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes"].includes(v.trim().toLowerCase());
}

/** Parse env as int; fall back to default when missing/invalid. */
export function envInt(key: string, def: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return def;
  const n = Number(v.trim());
  if (!Number.isInteger(n)) {
    logger.warn(`Invalid int env ${key}=${JSON.stringify(v)}; fallback to ${def}`);
    return def;
  }
  return n;
}

export const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
export const enableSemanticScholar = envBool("DALARAN_ENABLE_SEMANTIC_SCHOLAR", true);
export const enableArxiv = envBool("DALARAN_ENABLE_ARXIV", true);
export const cacheDir =
  process.env.DALARAN_CACHE_DIR ?? path.join(os.tmpdir(), "dalaran-cache");
export const cacheTtlSeconds = Math.max(
  1,
  envInt("DALARAN_CACHE_TTL_SECONDS", CACHE_TTL_SECONDS_DEFAULT),
);
