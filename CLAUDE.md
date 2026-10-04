# Dalaran development guidance

## Development workflow

1. Read `README.md` for setup and the public MCP capabilities. Use `package.json` as the source of truth for development and validation commands.
2. Trace the requested behavior through the tool declaration, server handler, and affected provider or utility before editing. Identify the inputs, outputs, and failure paths the change affects.
3. Implement the change and update affected tests in `test/`. For MCP contract changes, keep `src/tools.ts`, handlers in `src/server.ts`, and the public documentation consistent.
4. Run the test and typecheck scripts from `package.json`. Run the build script when changing startup, dependencies, or packaging. Report the checks performed and any remaining validation gaps.

## MCP behavior

Reserve stdout for MCP protocol traffic; send diagnostics through `src/log.ts` to stderr.

For provider changes, cover the affected normalization, deduplication, caching, and partial-failure behavior. Validate external integrations through live execution before describing them as working; distinguish local test results from provider verification.

## Commits

When committing through a coding CLI, always include a `Co-authored-by` trailer for the agent making the commit: `Codex <codex@openai.com>` for Codex, or `Claude <noreply@anthropic.com>` for Claude Code.
