import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ArxivClient, downloadArxivSource } from "./arxiv.js";
import { cacheKey, DiskCache } from "./cache.js";
import {
  apiKey,
  cacheDir,
  cacheTtlSeconds,
  enableArxiv,
  enableSemanticScholar,
} from "./config.js";
import { logger } from "./log.js";
import { mergeParallelSearchResults } from "./merge.js";
import { SemanticScholarClient, type Json } from "./semanticScholar.js";
import { TOOLS } from "./tools.js";

const cache = new DiskCache(cacheDir);
const s2 = new SemanticScholarClient(apiKey);
const arxiv = new ArxivClient();

function required<T>(args: Json, key: string): T {
  if (args[key] === undefined || args[key] === null) {
    throw new Error(`Missing required argument: ${key}`);
  }
  return args[key] as T;
}

async function searchPapers(args: Json): Promise<Json> {
  const limit = Math.min(Math.max(1, Number(args.limit ?? 10)), 100);
  const query = required<string>(args, "query");
  const year: string | undefined = args.year;

  // Query all enabled channels concurrently, then merge by title.
  const sources: string[] = [];
  const tasks: Promise<Json[]>[] = [];
  if (enableSemanticScholar) {
    sources.push("semantic_scholar");
    tasks.push(
      s2.searchPapers(query, limit, args.fields, year, args.venue).then((r) => r.data ?? []),
    );
  }
  if (enableArxiv) {
    sources.push("arxiv");
    tasks.push(arxiv.search(query, limit, 0, year).then((r) => r.entries ?? []));
  }

  const entries: Record<string, Json[]> = { semantic_scholar: [], arxiv: [] };
  const settled = await Promise.allSettled(tasks);
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      logger.info(`search_papers: ${sources[i]} failed in parallel fetch (${r.reason})`);
      return;
    }
    entries[sources[i]] = r.value;
    logger.info(`search_papers: ${sources[i]} returned ${r.value.length} items`);
  });
  return mergeParallelSearchResults(entries, limit);
}

async function callTool(name: string, args: Json): Promise<Json> {
  switch (name) {
    case "search_papers":
      return searchPapers(args);
    case "get_paper_details":
      return s2.getPaperDetails(required(args, "paper_id"), args.fields);
    case "get_paper_citations":
      return s2.getPaperCitations(required(args, "paper_id"), args.limit ?? 100, args.fields);
    case "get_paper_references":
      return s2.getPaperReferences(required(args, "paper_id"), args.limit ?? 100, args.fields);
    case "get_author_info":
      return s2.getAuthorInfo(required(args, "author_id"), args.fields);
    case "get_author_papers":
      return s2.getAuthorPapers(required(args, "author_id"), args.limit ?? 100, args.fields);
    case "get_paper_recommendations":
      return s2.getRecommendations(required(args, "paper_id"), args.limit ?? 10, args.fields);
    case "batch_get_papers":
      return s2.batchGetPapers(required(args, "paper_ids"), args.fields);
    case "download_arxiv_source":
      return downloadArxivSource(required(args, "arxiv_id"), args.output_dir);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const asContent = (result: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

export function createServer(): Server {
  const server = new Server(
    { name: "dalaran", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Json;
    try {
      const key = name === "search_papers" ? cacheKey(name, args) : undefined;
      if (key) {
        const cached = await cache.get<Json>(key);
        if (cached !== undefined) {
          logger.info(`cache hit: ${name}`);
          return asContent(cached);
        }
      }
      const result = await callTool(name, args);
      if (key) await cache.set(key, result, cacheTtlSeconds);
      return asContent(result);
    } catch (e) {
      return { ...asContent(String(e instanceof Error ? e.message : e)), isError: true };
    }
  });

  return server;
}

export const settings = { enableSemanticScholar, enableArxiv, cacheDir, cacheTtlSeconds, apiKey };
