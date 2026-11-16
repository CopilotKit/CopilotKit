// The agents and runtime options of each llamaindex demo, ported from the
// route files of showcase/integrations/llamaindex. Every agent is a router of
// the one FastAPI server at AGENT_URL_LLAMAINDEX, and each router serves
// AG-UI at <prefix>/run.
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { AgentConfigHttpAgent } from "@/lib/agent-config-http-agent";
import { agentUrl, httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";

const SLUG = "llamaindex";

// The path of each demo's agent on the agent server. A demo that changes only
// the UI uses the shared router at "/run".
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/a2ui-fixed/run",
  "agent-config": "/agent-config/run",
  "agentic-chat": "/run",
  auth: "/run",
  "beautiful-chat": "/beautiful-chat/run",
  "chat-customization-css": "/run",
  "chat-slots": "/run",
  "declarative-gen-ui": "/a2ui-dynamic/run",
  "declarative-hashbrown": "/byoc-hashbrown/run",
  "declarative-json-render": "/byoc-json-render/run",
  "frontend-tools": "/run",
  "frontend-tools-async": "/frontend-tools-async/run",
  "gen-ui-agent": "/gen-ui-agent/run",
  "gen-ui-interrupt": "/interrupt/run",
  "gen-ui-tool-based": "/gen-ui-tool-based/run",
  "headless-complete": "/run",
  "headless-simple": "/run",
  hitl: "/run",
  "hitl-in-app": "/hitl-in-app/run",
  "hitl-in-chat": "/hitl-in-chat/run",
  "interrupt-headless": "/interrupt/run",
  "mcp-apps": "/mcp-apps/run",
  multimodal: "/multimodal/run",
  "open-gen-ui": "/open-gen-ui/run",
  "open-gen-ui-advanced": "/open-gen-ui-advanced/run",
  "prebuilt-popup": "/run",
  "prebuilt-sidebar": "/run",
  "readonly-state-agent-context": "/run",
  "reasoning-custom": "/reasoning/run",
  "reasoning-default": "/reasoning/run",
  "shared-state-read": "/run",
  "shared-state-read-write": "/shared-state-read-write/run",
  "shared-state-streaming": "/run",
  subagents: "/subagents/run",
  "threadid-frontend-tool-roundtrip": "/run",
  "tool-rendering": "/run",
  "tool-rendering-custom-catchall": "/run",
  "tool-rendering-default-catchall": "/run",
  "tool-rendering-reasoning-chain": "/tool-rendering-reasoning-chain/run",
  voice: "/voice/run",
};

// The runtime options that differ from DEMO_RUNTIME_OPTIONS. All three demos
// set injectA2UITool to true:
// - a2ui-fixed-schema and declarative-gen-ui: the agent streams a
//   `render_a2ui` tool call, and the A2UI middleware watches for that call
//   only when it injects the tool.
// - beautiful-chat: the agent has no A2UI tool of its own.
const RUNTIME_OPTIONS: Partial<Record<string, RuntimeOptions>> = {
  "a2ui-fixed-schema": { a2ui: { injectA2UITool: true } },
  "beautiful-chat": {
    a2ui: {
      injectA2UITool: true,
      defaultCatalogId: "copilotkit://app-dashboard-catalog",
    },
    mcpApps: undefined,
  },
  "declarative-gen-ui": {
    a2ui: {
      injectA2UITool: true,
      defaultCatalogId: "declarative-gen-ui-catalog",
    },
  },
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
