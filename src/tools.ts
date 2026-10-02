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
    "Search academic papers by keyword. Optional filters: year, venue.",
    {
      query: { type: "string", description: "Search query" },
      limit: limit(10, 100),
      fields,
      year: { type: "string", description: "Year filter, e.g. '2020-2023' or '2023'" },
      venue: { type: "array", items: { type: "string" }, description: "Venue names to filter" },
    },
    ["query"],
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
