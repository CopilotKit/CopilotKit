export const PARALLEL_MCP_URL = "https://search.parallel.ai/mcp";

// Pass auth through HTTP transport options, never a browser-visible env var.
export function parallelServer(apiKey?: string) {
  const key = apiKey?.trim();
  return {
    type: "http" as const,
    url: PARALLEL_MCP_URL,
    ...(key ? { options: { requestInit: { headers: { Authorization: `Bearer ${key}` } } } } : {}),
  };
}
