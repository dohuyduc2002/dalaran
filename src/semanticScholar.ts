import { logger } from "./log.js";

export type Json = Record<string, any>;

const API_BASE_URL = "https://api.semanticscholar.org/graph/v1";
// Retry 429s several times with exponential backoff.
const MAX_429_RETRIES = 6;

export const DEFAULT_PAPER_FIELDS = [
  "paperId", "title", "abstract", "year", "authors", "citationCount",
  "referenceCount", "influentialCitationCount", "venue", "publicationTypes",
  "publicationDate", "url",
];

export const DEFAULT_AUTHOR_FIELDS = [
  "authorId", "name", "affiliations", "homepage", "paperCount", "citationCount", "hIndex",
];

type Params = Record<string, string | number>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SemanticScholarClient {
  private headers: Record<string, string> = {};

  constructor(apiKey?: string) {
    if (apiKey) this.headers["x-api-key"] = apiKey;
  }

  private async request(
    method: "GET" | "POST",
    endpoint: string,
    params?: Params,
    body?: unknown,
    baseDelay = 1.0,
  ): Promise<Json> {
    const url = new URL(`${API_BASE_URL}/${endpoint}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { ...this.headers };
    if (body !== undefined) headers["content-type"] = "application/json";

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        let delay = baseDelay * 2 ** attempt;
        const retryAfter = res.headers.get("Retry-After");
        if (retryAfter && /^\d+$/.test(retryAfter)) delay = Math.max(delay, Number(retryAfter));
        logger.warn(
          `Rate limited (429), retrying in ${delay.toFixed(1)}s (${attempt + 1}/${MAX_429_RETRIES})`,
        );
        await sleep(delay * 1000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`Semantic Scholar ${res.status} ${res.statusText} for ${method} ${endpoint}`);
      }
      return (await res.json()) as Json;
    }
  }

  private paperFields(fields?: string[]) {
    return (fields?.length ? fields : DEFAULT_PAPER_FIELDS).join(",");
  }

  searchPapers(query: string, limit = 10, fields?: string[], year?: string, venue?: string[]) {
    const params: Params = { query, limit: Math.min(limit, 100), fields: this.paperFields(fields) };
    if (year) params.year = year;
    if (venue?.length) params.venue = venue.join(",");
    return this.request("GET", "paper/search", params);
  }

  getPaperDetails(paperId: string, fields?: string[]) {
    return this.request("GET", `paper/${paperId}`, { fields: this.paperFields(fields) });
  }

  getPaperCitations(paperId: string, limit = 100, fields?: string[]) {
    return this.request("GET", `paper/${paperId}/citations`, {
      limit: Math.min(limit, 1000),
      fields: this.paperFields(fields),
    });
  }

  getPaperReferences(paperId: string, limit = 100, fields?: string[]) {
    return this.request("GET", `paper/${paperId}/references`, {
      limit: Math.min(limit, 1000),
      fields: this.paperFields(fields),
    });
  }

  getAuthorInfo(authorId: string, fields?: string[]) {
    return this.request("GET", `author/${authorId}`, {
      fields: (fields?.length ? fields : DEFAULT_AUTHOR_FIELDS).join(","),
    });
  }

  getAuthorPapers(authorId: string, limit = 100, fields?: string[]) {
    return this.request("GET", `author/${authorId}/papers`, {
      limit: Math.min(limit, 1000),
      fields: this.paperFields(fields),
    });
  }

  getRecommendations(paperId: string, limit = 10, fields?: string[]) {
    return this.request("GET", `recommendations/v1/papers/forpaper/${paperId}`, {
      limit: Math.min(limit, 100),
      fields: this.paperFields(fields),
    });
  }

  batchGetPapers(paperIds: string[], fields?: string[]) {
    return this.request(
      "POST",
      "paper/batch",
      { fields: this.paperFields(fields) },
      { ids: paperIds.slice(0, 500) },
    );
  }
}
