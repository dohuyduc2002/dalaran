// MCP stdio uses stdout for protocol traffic, so all logs go to stderr.
const emit = (level: string, msg: string) =>
  console.error(`${level}:dalaran:${msg}`);

export const logger = {
  info: (msg: string) => emit("INFO", msg),
  warn: (msg: string) => emit("WARNING", msg),
};
