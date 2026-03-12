export type ConnectionType = "stdio" | "sse";

export interface StdioConfig {
  command: string;
  args: string[];
  transport: "stdio";
}

export interface SSEConfig {
  url: string;
  transport: "sse";
}

export type ServerConfig = StdioConfig | SSEConfig;

export interface MCPConfig {
  mcp_config: Record<string, ServerConfig>;
}

// Local storage key for saving MCP configurations
export const MCP_STORAGE_KEY = "mcp-server-configs";
