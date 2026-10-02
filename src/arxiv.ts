import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { XMLParser } from "fast-xml-parser";
import * as tar from "tar";
import { logger } from "./log.js";
import type { Json } from "./semanticScholar.js";

const ARXIV_API_BASE = "https://export.arxiv.org/api/query";
const ARXIV_SRC_BASE = "https://arxiv.org/src";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => ["entry", "author", "link"].includes(name),
});

/** Extract arXiv id from abs URL, e.g. http://arxiv.org/abs/2201.00978v1 -> 2201.00978. */
export function arxivIdFromUrl(idUrl: string): string {
  if (!idUrl) return "";
  const m = /arxiv\.org\/abs\/([\w.-]+)/i.exec(idUrl);
  if (!m) return idUrl;
  return m[1].replace(/v\d+$/, "");
}

/**
 * Normalize user input to an arXiv id suitable for https://arxiv.org/src/{id}.
 * Accepts plain ids, arxiv:ID, and abs/src URLs. Preserves version suffix if present.
 */
export function normalizeArxivSourceId(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  let m = /arxiv\.org\/(?:abs|src)\/([\w.-]+)/i.exec(s);
  if (m) return m[1];
  m = /\barxiv:\s*([\w.-]+)/i.exec(s);
  if (m) return m[1];
  return s;
}

const text = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return text((v as Json)["#text"]);
  return String(v).trim();
};

function entryToPaper(entry: Json): Json | null {
  const arxivId = arxivIdFromUrl(text(entry.id));
  if (!arxivId) return null;

  const title = text(entry.title).replace(/\n/g, " ").trim();
  const abstract = text(entry.summary).replace(/\n/g, " ").trim();
  const dateStr = text(entry.published) || text(entry.updated);
  const yearNum = dateStr.length >= 4 ? parseInt(dateStr.slice(0, 4), 10) : NaN;

  const authors = ((entry.author ?? []) as Json[])
    .map((a) => text(a.name))
    .filter(Boolean)
    .map((name) => ({ name }));

  let linkAlternate: string | null = null;
  let linkPdf: string | null = null;
  for (const link of (entry.link ?? []) as Json[]) {
    const href = link["@_href"] ?? "";
    const rel = link["@_rel"] ?? "";
    const titleAttr = String(link["@_title"] ?? "").toLowerCase();
    if (rel === "alternate") linkAlternate = href;
    else if (titleAttr.includes("pdf") || (rel === "related" && href.includes("pdf"))) linkPdf = href;
  }

  return {
    paperId: arxivId,
    title,
    abstract: abstract || null,
    year: Number.isNaN(yearNum) ? null : yearNum,
    authors,
    citationCount: null,
    referenceCount: null,
    influentialCitationCount: null,
    venue: entry.primary_category?.["@_term"] ?? null,
    publicationTypes: null,
    publicationDate: dateStr || null,
    url: linkAlternate || `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: linkPdf,
    source: "arxiv",
  };
}

/** arXiv API client (https://info.arxiv.org/help/api/user-manual.html). */
export class ArxivClient {
  constructor(private readonly timeoutMs = 30_000) {}

  async search(query: string, limit = 10, start = 0, year?: string) {
    let searchQuery = `all:${query.trim()}`;
    if (year) {
      // submittedDate filter: [YYYYMMDDTTTT TO YYYYMMDDTTTT] in GMT
      const [a, b] = year.includes("-") ? year.split("-") : [year, year];
      const y1 = a.trim().slice(0, 4);
      const y2 = b.trim().slice(0, 4);
      searchQuery += ` AND submittedDate:[${y1}01010000 TO ${y2}12312359]`;
    }
    const url = new URL(ARXIV_API_BASE);
    url.searchParams.set("search_query", searchQuery);
    url.searchParams.set("start", String(start));
    url.searchParams.set("max_results", String(Math.min(limit, 2000)));
    url.searchParams.set("sortBy", "relevance");
    url.searchParams.set("sortOrder", "descending");

    let xml: string;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      xml = await res.text();
    } catch (e) {
      logger.warn(`arXiv search failed: ${e}`);
      return { totalResults: 0, entries: [] as Json[] };
    }

    const feed = parser.parse(xml).feed ?? {};
    const totalResults = parseInt(text(feed.totalResults), 10) || 0;
    const entries: Json[] = [];
    for (const entry of (feed.entry ?? []) as Json[]) {
      // arXiv reports errors as an entry titled "Error".
      if (text(entry.title).toLowerCase() === "error") continue;
      const paper = entryToPaper(entry);
      if (paper) entries.push(paper);
    }
    return { totalResults, entries };
  }
}

async function listFiles(root: string, max = 300): Promise<[string[], boolean]> {
  const all: string[] = [];
  const walk = async (dir: string) => {
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) await walk(p);
      else if (d.isFile()) all.push(path.relative(root, p).split(path.sep).join("/"));
    }
  };
  await walk(root);
  all.sort();
  return [all.slice(0, max), all.length > max];
}

/** Download the LaTeX/source bundle (tar.gz) from arXiv and extract it. */
export async function downloadArxivSource(
  arxivId: string,
  outputDir?: string,
  timeoutMs = 120_000,
): Promise<Json> {
  const aid = normalizeArxivSourceId(arxivId);
  if (!aid || !/^[\w.-]+$/.test(aid)) {
    throw new Error(
      "Invalid arXiv id. Use e.g. 2503.23278, arXiv:2503.23278, or an arxiv.org abs/src URL.",
    );
  }

  let base = outputDir || process.env.DALARAN_ARXIV_SOURCE_DIR;
  if (!base) base = path.join(os.tmpdir(), "dalaran-arxiv-src");
  if (base.startsWith("~")) base = path.join(os.homedir(), base.slice(1));
  const root = path.resolve(base);
  await fs.mkdir(root, { recursive: true });
  const extractRoot = path.join(root, aid.replaceAll(path.sep, "_").replaceAll("..", "_"));
  await fs.rm(extractRoot, { recursive: true, force: true });
  await fs.mkdir(extractRoot, { recursive: true });

  const url = `${ARXIV_SRC_BASE}/${aid}`;
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 404) {
    throw new Error(`No source package at ${url} (404). The paper may have no submitted source.`);
  }
  if (!res.ok) throw new Error(`arXiv source download failed: ${res.status} ${res.statusText}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (!data.length) throw new Error("Empty response from arXiv source URL");

  try {
    // node-tar rejects absolute paths and ".." traversal; also skip links entirely.
    await pipeline(
      Readable.from(data),
      tar.x({
        cwd: extractRoot,
        filter: (_p, entry) => {
          const type = (entry as tar.ReadEntry).type;
          return type !== "SymbolicLink" && type !== "Link";
        },
      }),
    );
  } catch (e) {
    throw new Error(
      `Download from arXiv was not a valid tar.gz archive: ${e}. ` +
        `If the paper only has PDF, source may be unavailable.`,
    );
  }

  const [files, truncated] = await listFiles(extractRoot);
  return {
    arxiv_id: aid,
    source_url: url,
    extract_dir: extractRoot,
    files,
    files_listed: files.length,
    files_truncated: truncated,
  };
}
