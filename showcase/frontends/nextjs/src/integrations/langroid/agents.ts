// The agents and runtime options of each langroid demo, ported from the route
// files of showcase/integrations/langroid. Every agent is an endpoint of the
// one FastAPI server at AGENT_URL_LANGROID.
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { AgentConfigHttpAgent } from "@/lib/agent-config-http-agent";
import { agentUrl, httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";

const SLUG = "langroid";

// The path of each demo's agent on the agent server. Most demos use the
// unified Langroid agent at "/". shared-state-read-write and subagents use the
// endpoints that read the run's state and send state snapshots.
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/a2ui-fixed-schema",
  "agent-config": "/",
  "agentic-chat": "/",
  auth: "/",
  "beautiful-chat": "/",
  "chat-customization-css": "/",
  "chat-slots": "/",
  "declarative-gen-ui": "/",
  "declarative-hashbrown": "/byoc-hashbrown",
  "declarative-json-render": "/byoc-json-render",
  "frontend-tools": "/",
  "frontend-tools-async": "/",
  "gen-ui-agent": "/gen-ui-agent",
  "gen-ui-interrupt": "/",
  "gen-ui-tool-based": "/",
  "headless-complete": "/",
  "headless-simple": "/",
  hitl: "/",
  "hitl-in-app": "/",
  "hitl-in-chat": "/",
  "interrupt-headless": "/",
  "mcp-apps": "/mcp-apps",
  multimodal: "/multimodal",
  "open-gen-ui": "/",
  "open-gen-ui-advanced": "/",
  "prebuilt-popup": "/",
  "prebuilt-sidebar": "/",
  "readonly-state-agent-context": "/",
  "reasoning-custom": "/reasoning/",
  "reasoning-default": "/reasoning/",
  "shared-state-read": "/",
  "shared-state-read-write": "/shared-state-read-write",
  "shared-state-streaming": "/",
  subagents: "/subagents",
  "threadid-frontend-tool-roundtrip": "/",
  "tool-rendering": "/",
  "tool-rendering-custom-catchall": "/",
  "tool-rendering-default-catchall": "/",
  "tool-rendering-reasoning-chain": "/reasoning/tools/",
  voice: "/",
};

// The runtime options that differ from DEMO_RUNTIME_OPTIONS.
const RUNTIME_OPTIONS: Partial<Record<string, RuntimeOptions>> = {
  "beautiful-chat": { mcpApps: undefined },
  // injectA2UITool stays unset, so the runtime injects the A2UI tool when the
  // page registers its catalog. The agent's own generate_a2ui tool is a stub
  // that the runtime intercepts.
  "declarative-gen-ui": {
    a2ui: { defaultCatalogId: "declarative-gen-ui-catalog" },
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
