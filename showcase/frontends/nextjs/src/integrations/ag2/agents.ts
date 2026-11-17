// The agents and runtime options of each ag2 demo, ported from the route
// files of showcase/integrations/ag2. Every agent is a sub-app of the one
// FastAPI server at AGENT_URL_AG2.
import type { McpAppsConfig } from "@copilotkit/runtime/v2";
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { AgentConfigHttpAgent } from "@/lib/agent-config-http-agent";
import { agentUrl, httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";

const SLUG = "ag2";

// The path of each demo's agent on the agent server. A demo that changes only
// the UI uses the shared agent at "/".
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/a2ui-fixed-schema/",
  "agent-config": "/agent-config/",
  "agentic-chat": "/",
  auth: "/",
  "beautiful-chat": "/beautiful-chat/",
  "chat-customization-css": "/",
  "chat-slots": "/",
  "declarative-gen-ui": "/declarative-gen-ui/",
  "declarative-hashbrown": "/byoc-hashbrown/",
  "declarative-json-render": "/byoc-json-render/",
  "frontend-tools": "/",
  "frontend-tools-async": "/",
  "gen-ui-agent": "/gen-ui-agent/",
  "gen-ui-interrupt": "/interrupt-adapted/",
  "gen-ui-tool-based": "/",
  "headless-complete": "/headless-complete/",
  "headless-simple": "/",
  hitl: "/",
  "hitl-in-app": "/",
  "hitl-in-chat": "/hitl-in-chat/",
  "interrupt-headless": "/interrupt-adapted/",
  "mcp-apps": "/mcp-apps/",
  multimodal: "/multimodal/",
  "open-gen-ui": "/open-gen-ui/",
  "open-gen-ui-advanced": "/open-gen-ui-advanced/",
  "prebuilt-popup": "/",
  "prebuilt-sidebar": "/",
  "readonly-state-agent-context": "/",
  "reasoning-custom": "/reasoning/",
  "reasoning-default": "/reasoning/",
  "shared-state-read": "/",
  "shared-state-read-write": "/shared-state-read-write/",
  "shared-state-streaming": "/",
  subagents: "/subagents/",
  "threadid-frontend-tool-roundtrip": "/",
  "tool-rendering": "/",
  "tool-rendering-custom-catchall": "/",
  "tool-rendering-default-catchall": "/",
  "tool-rendering-reasoning-chain": "/tool-rendering-reasoning-chain/",
  voice: "/",
};

// ag2's MCP Apps server runs on its agent server, unless MCP_SERVER_URL names
// another one. `url` is a getter, so the runtime reads both variables when it
// connects to the server.
const AG2_DIAGRAM_MCP_APPS = {
  servers: [
    {
      type: "http",
      get url() {
        return (
          process.env.MCP_SERVER_URL || `${agentUrl(SLUG)}/mcp-apps-server/mcp/`
        );
      },
      serverId: "ag2-diagram",
    },
  ],
} satisfies McpAppsConfig;

// The runtime options that differ from DEMO_RUNTIME_OPTIONS.
const RUNTIME_OPTIONS: Partial<Record<string, RuntimeOptions>> = {
  "beautiful-chat": {
    openGenerativeUI: { agents: ["beautiful-chat"] },
    mcpApps: undefined,
  },
  // injectA2UITool stays unset, so the runtime injects the A2UI tool when the
  // page registers its catalog.
  "declarative-gen-ui": {
    a2ui: { defaultCatalogId: "declarative-gen-ui-catalog" },
  },
  "headless-complete": { mcpApps: AG2_DIAGRAM_MCP_APPS },
  "mcp-apps": { mcpApps: AG2_DIAGRAM_MCP_APPS },
};

export default {
  createRuntimeConfig(demoId) {
    const path = AGENT_PATHS[demoId];
    const agentIds = DEMO_AGENT_IDS[demoId];
    if (path === undefined || agentIds === undefined) return undefined;
    const agent =
      demoId === "agent-config"
        ? new AgentConfigHttpAgent({ url: `${agentUrl(SLUG)}${path}` })
        : httpAgent(SLUG, path);
    return {
      agents: Object.fromEntries(agentIds.map((id) => [id, agent] as const)),
      options: RUNTIME_OPTIONS[demoId],
    };
  },
} satisfies IntegrationRuntime;
