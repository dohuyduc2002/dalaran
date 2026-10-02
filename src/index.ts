#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "./log.js";
import { createServer, settings } from "./server.js";

async function main(): Promise<void> {
  logger.info("Starting Dalaran MCP Server...");
  logger.info(
    `Search channels: Semantic Scholar=${settings.enableSemanticScholar}, arXiv=${settings.enableArxiv}`,
  );
  logger.info(
    `Local cache enabled: dir=${settings.cacheDir}, ttl_seconds=${settings.cacheTtlSeconds}`,
  );
  if (settings.apiKey) logger.info("Semantic Scholar API key detected");
  else logger.warn("No Semantic Scholar API key; using public rate limits");

  await createServer().connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
