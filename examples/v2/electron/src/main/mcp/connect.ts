import { createMCPClient } from "@ai-sdk/mcp";
import type { MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { McpServerConfig } from "./config";

export type ConnectedMcpClient = MCPClient;

export type McpConnect = (cfg: McpServerConfig) => Promise<ConnectedMcpClient>;

export const connectMcpServer: McpConnect = async (cfg) => {
  if (cfg.kind === "stdio") {
    return createMCPClient({
      transport: new Experimental_StdioMCPTransport({
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
      }),
    });
  } else {
    return createMCPClient({
      transport: { type: "http", url: cfg.url, headers: cfg.headers },
    });
  }
};
