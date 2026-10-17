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
  enableOpenalex,
  enableSemanticScholar,
  openalexApiKey,
  s2MaxRetryWaitSeconds,
} from "./config.js";
import { logger } from "./log.js";
import { mergeParallelSearchResults } from "./merge.js";
import { OpenAlexClient } from "./openalex.js";
import { planSearch } from "./plan.js";
import { looksLikeRorId, normalizeRorId, RorClient } from "./ror.js";
import { SemanticScholarClient, type Json } from "./semanticScholar.js";
import { TOOLS } from "./tools.js";
import { listVenues } from "./venues.js";

const cache = new DiskCache(cacheDir);
const s2 = new SemanticScholarClient(apiKey, s2MaxRetryWaitSeconds);
const arxiv = new ArxivClient();
const openalex = new OpenAlexClient(openalexApiKey);
const ror = new RorClient();

/** Tools whose results are stable enough to cache on disk. */
const CACHEABLE = new Set(["search_papers", "search_institutions", "get_institution"]);

function required<T>(args: Json, key: string): T {
  if (args[key] === undefined || args[key] === null) {
    throw new Error(`Missing required argument: ${key}`);
  }
  return args[key] as T;
}

/** Resolve institution names / ROR ids to canonical ROR ids. Ambiguous names are rejected. */
async function resolveInstitutions(inputs: string[]): Promise<{ rorIds: string[]; resolved: Json[] }> {
  const rorIds: string[] = [];
  const resolved: Json[] = [];
  for (const raw of inputs) {
    if (looksLikeRorId(raw)) {
      const id = normalizeRorId(raw);
      rorIds.push(id);
      resolved.push({ input: raw, ror_id: id });
      continue;
    }
    const { chosen, candidates } = await ror.resolveAffiliation(raw);
    if (!chosen) {
      const hint = candidates.map((c) => `${c.name} (${c.ror_id})`).join("; ") || "no candidates";
      throw new Error(
        `Could not confidently resolve institution ${JSON.stringify(raw)} to one ROR id. ` +
          `Candidates: ${hint}. Pass an explicit ROR id (see search_institutions).`,
      );
    }
    rorIds.push(chosen.ror_id);
    resolved.push({ input: raw, ror_id: chosen.ror_id, name: chosen.name });
  }
  return { rorIds: [...new Set(rorIds)], resolved };
}

async function searchPapers(args: Json): Promise<Json> {
  const limit = Math.min(Math.max(1, Number(args.limit ?? 10)), 100);
  const query = required<string>(args, "query");
  const year: string | undefined = args.year;

  const { rorIds, resolved } = await resolveInstitutions(args.institution ?? []);
  const plan = planSearch({
    venue: args.venue,
    selector: { tier: args.venue_tier, area: args.venue_area, type: args.venue_type },
    rorIds,
    enabled: { semanticScholar: enableSemanticScholar, openalex: enableOpenalex, arxiv: enableArxiv },
  });

  // Query all planned channels concurrently, then merge by title.
  const sources: string[] = [];
  const tasks: Promise<Json[]>[] = [];
  if (plan.semanticScholar) {
    sources.push("semantic_scholar");
    tasks.push(
      s2
        .searchPapers(query, limit, args.fields, year, plan.semanticScholar.venues)
        .then((r) => r.data ?? []),
    );
  }
  if (plan.openalex) {
    sources.push("openalex");
    tasks.push(openalex.search({ query, limit, year, ...plan.openalex }).then((r) => r.entries));
  }
  if (plan.arxiv) {
    sources.push("arxiv");
    tasks.push(arxiv.search(query, limit, 0, year).then((r) => r.entries ?? []));
  }

  const entries: Record<string, Json[]> = { semantic_scholar: [], openalex: [], arxiv: [] };
  const failed: { source: string; error: string }[] = [];
  const settled = await Promise.allSettled(tasks);
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      logger.info(`search_papers: ${sources[i]} failed in parallel fetch (${error})`);
      failed.push({ source: sources[i], error });
      return;
    }
    entries[sources[i]] = r.value;
    logger.info(`search_papers: ${sources[i]} returned ${r.value.length} items`);
  });

  const result: Json = mergeParallelSearchResults(entries, limit);
  if (plan.venuesApplied.length) result.venues_applied = plan.venuesApplied;
  if (resolved.length) result.resolved_institutions = resolved;
  if (plan.skipped.length) result.skipped_sources = plan.skipped;
  if (plan.notes.length) result.notes = plan.notes;
  if (failed.length) result.failed_sources = failed;
  return result;
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
    case "list_venues":
      return {
        data: listVenues({ tier: args.tier, area: args.area, type: args.type }).map(
          ({ openalexSources: _omit, ...v }) => v,
        ),
      };
    case "search_institutions":
      return ror.search(required(args, "query"), {
        types: args.types,
        country: args.country,
        limit: args.limit,
      });
    case "get_institution":
      return ror.getById(required(args, "ror_id"));
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
      const key = CACHEABLE.has(name) ? cacheKey(name, args) : undefined;
      if (key) {
        const cached = await cache.get<Json>(key);
        if (cached !== undefined) {
          logger.info(`cache hit: ${name}`);
          return asContent(cached);
        }
      }
      const result = await callTool(name, args);
      // Never pin a degraded (partial-failure) result in the cache for the full TTL.
      if (key && !result.failed_sources) await cache.set(key, result, cacheTtlSeconds);
      return asContent(result);
    } catch (e) {
      return { ...asContent(String(e instanceof Error ? e.message : e)), isError: true };
    }
  });

  return server;
}

export const settings = { enableSemanticScholar, enableArxiv, enableOpenalex, openalexApiKey, cacheDir, cacheTtlSeconds, apiKey };
