import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const fields = {
  type: "array",
  items: { type: "string" },
  description: "Fields to return",
} as const;

const limit = (def: number, max: number) => ({
  type: "number",
  description: `Max results (default ${def}, max ${max})`,
  default: def,
});

const tool = (
  name: string,
  description: string,
  properties: Record<string, object>,
  required: string[],
): Tool => ({ name, description, inputSchema: { type: "object", properties, required } });

const paperId = { type: "string", description: "Paper ID" };
const authorId = { type: "string", description: "Author ID" };

export const TOOLS: Tool[] = [
  tool(
    "search_papers",
    "Search academic papers by keyword across Semantic Scholar, OpenAlex and arXiv. " +
      "Filters: year; venue (names/aliases) or venue_tier/venue_area/venue_type to restrict to curated " +
      "top ML/AI venues (see list_venues); institution (names or ROR ids) to restrict to papers with an " +
      "author at that institution (see search_institutions). Venue filters skip arXiv; institution " +
      "filters use OpenAlex only. The response lists skipped_sources and failed_sources.",
    {
      query: { type: "string", description: "Search query" },
      limit: limit(10, 100),
      fields,
      year: { type: "string", description: "Year filter, e.g. '2020-2023' or '2023'" },
      venue: {
        type: "array",
        items: { type: "string" },
        description: "Venue names or aliases, e.g. ['NeurIPS', 'ICML']. Unregistered names only filter Semantic Scholar.",
      },
      venue_tier: {
        type: "number",
        enum: [1, 2],
        description: "Restrict to curated venues with tier <= this (1 = flagship, 2 = flagship + strong). Unions with `venue`.",
      },
      venue_area: {
        type: "string",
        description: "Restrict to curated venues in this area: ml, ai, cv, nlp, data-mining, ir, robotics, speech, theory.",
      },
      venue_type: { type: "string", enum: ["conference", "journal"], description: "Restrict curated venues by type." },
      institution: {
        type: "array",
        items: { type: "string" },
        description:
          "Institutions or companies as ROR ids (https://ror.org/00971b260) or names. Names must match " +
          "confidently, otherwise the call fails with candidates; use search_institutions to get the id.",
      },
    },
    ["query"],
  ),
  tool(
    "list_venues",
    "List the curated top-tier ML/AI conferences and journals that search_papers can filter by, " +
      "with aliases, tier, type and areas.",
    {
      tier: { type: "number", enum: [1, 2], description: "Include venues with tier <= this" },
      area: { type: "string", description: "ml, ai, cv, nlp, data-mining, ir, robotics, speech, theory" },
      type: { type: "string", enum: ["conference", "journal"] },
    },
    [],
  ),
  tool(
    "search_institutions",
    "Search the Research Organization Registry (ROR) for universities, companies, labs and other " +
      "research organizations. Returns ROR ids, aliases, acronyms, location, and parent/child " +
      "relations. Pass ROR ids to search_papers `institution`.",
    {
      query: { type: "string", description: "Organization name, acronym or alias" },
      types: {
        type: "array",
        items: { type: "string" },
        description: "ROR types: education, company, nonprofit, government, healthcare, facility, funder, archive, other",
      },
      country: { type: "string", description: "ISO 3166-1 alpha-2 country code, e.g. US" },
      limit: limit(10, 20),
    },
    ["query"],
  ),
  tool(
    "get_institution",
    "Get one organization from ROR by id, including its parent and child organizations.",
    { ror_id: { type: "string", description: "ROR id or URL, e.g. https://ror.org/00971b260" } },
    ["ror_id"],
  ),
  tool(
    "get_paper_details",
    "Get paper details. Supports DOI, ArXiv ID, Semantic Scholar ID, or URL.",
    {
      paper_id: { type: "string", description: "Paper ID (DOI, ArXiv ID, S2 ID, etc.)" },
      fields,
    },
    ["paper_id"],
  ),
  tool(
    "get_paper_citations",
    "Get list of papers that cite this paper.",
    { paper_id: paperId, limit: limit(100, 1000), fields },
    ["paper_id"],
  ),
  tool(
    "get_paper_references",
    "Get list of references of this paper.",
    { paper_id: paperId, limit: limit(100, 1000), fields },
    ["paper_id"],
  ),
  tool("get_author_info", "Get author details.", { author_id: authorId, fields }, ["author_id"]),
  tool(
    "get_author_papers",
    "Get papers by author.",
    { author_id: authorId, limit: limit(100, 1000), fields },
    ["author_id"],
  ),
  tool(
    "get_paper_recommendations",
    "Get similar paper recommendations for a paper.",
    { paper_id: paperId, limit: limit(10, 100), fields },
    ["paper_id"],
  ),
  tool(
    "batch_get_papers",
    "Get details for multiple papers (up to 500).",
    {
      paper_ids: { type: "array", items: { type: "string" }, description: "List of paper IDs" },
      fields,
    },
    ["paper_ids"],
  ),
  tool(
    "download_arxiv_source",
    "Download arXiv LaTeX/source bundle (tar.gz from https://arxiv.org/src/{id}) " +
      "and extract it to a directory. Default base directory is DALARAN_ARXIV_SOURCE_DIR " +
      "or the system temp folder. Overwrites a previous extract of the same id.",
    {
      arxiv_id: {
        type: "string",
        description:
          "arXiv paper id, e.g. 2503.23278 or 2503.23278v1; or arXiv/abs/src URL; or arxiv:2503.23278",
      },
      output_dir: {
        type: "string",
        description:
          "Optional directory under which to create a folder named after the id. " +
          "If omitted, uses env DALARAN_ARXIV_SOURCE_DIR or temp/dalaran-arxiv-src",
      },
    },
    ["arxiv_id"],
  ),
];
