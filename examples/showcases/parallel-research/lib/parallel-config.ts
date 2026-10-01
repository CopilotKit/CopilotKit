export const PARALLEL_MCP_URL = "https://search.parallel.ai/mcp";

/** Configure the fixed MCP endpoint with optional server-side Bearer authentication. */
export function parallelServer(apiKey?: string) {
  const key = apiKey?.trim();
  return {
    type: "http" as const,
    url: PARALLEL_MCP_URL,
    ...(key ? { options: { requestInit: { headers: { Authorization: `Bearer ${key}` } } } } : {}),
  };
}
