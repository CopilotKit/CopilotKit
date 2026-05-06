import type { AbstractAgent } from "@ag-ui/client";
import type { MCPClientConfig, MCPClientConfigHTTP } from "../../../../agent";
import type { CopilotKitIntelligence } from "../../intelligence-platform/client";
import { INTELLIGENCE_USER_ID_HEADER } from "../../intelligence-platform/client";

/**
 * Append the Intelligence platform's MCP server (bash + thread tools) to
 * the agent's per-run effective server list. The MCP config is built fresh
 * per-request: `Authorization: Bearer <apiKey>` and `X-Cpki-User-Id:
 * <userId>` are baked into a custom `options.fetch` via closure, so each
 * outbound MCP request carries the right project Bearer + per-user header
 * without dragging a user concept into the public `MCPClientConfig`.
 *
 * Skipped when:
 *   - The Intelligence client has `mcpServer: false` (default).
 *   - The user's static `config.mcpServers` already includes a server
 *     pointing at the same URL — explicit user config wins, no duplicate
 *     attach.
 *
 * @internal — runtime-side wiring; not exposed to users.
 */
export function attachIntelligenceMcpServer(params: {
  intelligence: CopilotKitIntelligence;
  agent: AbstractAgent;
  userId: string;
}): void {
  const { intelligence, agent, userId } = params;
  if (!intelligence.ɵisMcpServerEnabled?.()) return;

  const apiUrl = intelligence.ɵgetApiUrl();
  const apiKey = intelligence.ɵgetApiKey();
  if (!apiUrl || !apiKey) return;

  const intelligenceMcpUrl = `${apiUrl}/mcp`;

  // If the user has already added a server pointing at the same URL, their
  // explicit config wins.
  const userServers =
    (agent as { config?: { mcpServers?: MCPClientConfig[] } }).config
      ?.mcpServers ?? [];
  if (
    userServers.some((s) => s.type === "http" && s.url === intelligenceMcpUrl)
  ) {
    return;
  }

  const intelligenceServer: MCPClientConfigHTTP = {
    type: "http",
    url: intelligenceMcpUrl,
    options: {
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${apiKey}`);
        headers.set(INTELLIGENCE_USER_ID_HEADER, userId);
        return globalThis.fetch(url, { ...init, headers });
      },
    },
  };

  // Append to the agent's @internal runtime side-channel.
  const agentWithSideChannel = agent as {
    runtimeMcpServers?: MCPClientConfig[];
  };
  agentWithSideChannel.runtimeMcpServers = [
    ...(agentWithSideChannel.runtimeMcpServers ?? []),
    intelligenceServer,
  ];
}
