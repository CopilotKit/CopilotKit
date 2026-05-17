"use client";

/**
 * Homepage: MCP Apps — bare-minimum MCP Apps provider wiring.
 *
 * The MCP Apps runtime (/api/copilotkit-mcp-apps) is configured with the
 * server list (see /api/copilotkit-mcp-apps/route.ts). The frontend just
 * points at that runtime and renders <CopilotChat /> — the built-in
 * MCPAppsActivityRenderer mounts each MCP app's UI resource in a
 * sandboxed iframe inline in the conversation.
 *
 * Iframe target for the "MCP Apps" chip on the website homepage dojo.
 */

import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

export default function HomeMcpAppsDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-mcp-apps" agent="mcp-apps">
      <CopilotChat agentId="mcp-apps" />
    </CopilotKit>
  );
}
