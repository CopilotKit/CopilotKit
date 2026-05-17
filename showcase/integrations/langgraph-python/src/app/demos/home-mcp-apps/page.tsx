"use client";

/**
 * Homepage: MCP Apps — bare-minimum MCP Apps wiring, styled in the
 * experimental "lavender glass" design language.
 *
 * The MCP Apps runtime (/api/copilotkit-mcp-apps) is configured with
 * the server list. The built-in MCPAppsActivityRenderer mounts each
 * MCP app's UI resource in a sandboxed iframe inline in the chat —
 * those iframes are 3rd-party content and keep their own styling, but
 * the chat shell around them carries the experimental theme.
 *
 * Iframe target for the "MCP Apps" chip on the homepage dojo.
 */

import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

import "../_experimental-theme/theme.css";

export default function HomeMcpAppsDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-mcp-apps"
      agent="mcp-apps"
      enableInspector={false}
    >
      <div className="hd-exp-scope h-screen w-screen overflow-hidden">
        <CopilotChat agentId="mcp-apps" className="h-full" />
      </div>
    </CopilotKit>
  );
}
