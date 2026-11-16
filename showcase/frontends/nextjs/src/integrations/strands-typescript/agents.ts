// The agents of each strands-typescript demo. One agent server runs them all:
// most demos share the agent at "/", and the rest have an endpoint of their own.
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";

// The path of each demo's agent on the agent server, by demo id.
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/a2ui-fixed-schema/",
  "a2ui-recovery": "/a2ui-recovery/",
  "agent-config": "/",
  "agentic-chat": "/",
  auth: "/",
  "beautiful-chat": "/beautiful-chat",
  "chat-customization-css": "/",
  "chat-slots": "/",
  "declarative-gen-ui": "/declarative-gen-ui/",
  "declarative-hashbrown": "/byoc-hashbrown/",
  "declarative-json-render": "/byoc-json-render/",
  "frontend-tools": "/",
  "frontend-tools-async": "/",
  "gen-ui-agent": "/",
  "gen-ui-interrupt": "/interrupt/",
  "gen-ui-tool-based": "/",
  "headless-complete": "/",
  "headless-simple": "/",
  hitl: "/",
  "hitl-in-app": "/",
  "hitl-in-chat": "/",
  "interrupt-headless": "/interrupt/",
  "mcp-apps": "/",
  multimodal: "/",
  "open-gen-ui": "/",
  "open-gen-ui-advanced": "/",
  "prebuilt-popup": "/",
  "prebuilt-sidebar": "/",
  "readonly-state-agent-context": "/",
  "reasoning-custom": "/reasoning/",
  "reasoning-default": "/reasoning/",
  "shared-state-read": "/",
  "shared-state-read-write": "/",
  "shared-state-streaming": "/",
  subagents: "/",
  "threadid-frontend-tool-roundtrip": "/",
  "tool-rendering": "/",
  "tool-rendering-custom-catchall": "/",
  "tool-rendering-default-catchall": "/",
  "tool-rendering-reasoning-chain": "/reasoning-chain/",
  voice: "/voice/",
};

// The runtime options that replace DEMO_RUNTIME_OPTIONS for
// strands-typescript, key by key, by demo id.
const RUNTIME_OPTIONS: Partial<Record<string, () => RuntimeOptions>> = {
  "a2ui-fixed-schema": () => ({
    a2ui: {
      injectA2UITool: false,
      defaultCatalogId: "copilotkit://flight-fixed-catalog",
    },
  }),
  // No runtime A2UI settings: the catalog that the page passes turns A2UI on,
  // with tool injection, and the strands adapter injects `generate_a2ui`.
  "a2ui-recovery": () => ({ a2ui: undefined }),
  "declarative-gen-ui": () => ({ a2ui: undefined }),
  "beautiful-chat": () => ({ mcpApps: undefined }),
};

export default {
  createRuntimeConfig(demoId) {
    const path = AGENT_PATHS[demoId];
    const agentIds = DEMO_AGENT_IDS[demoId];
    if (path === undefined || agentIds === undefined) return undefined;
    const agents = Object.fromEntries(
      agentIds.map((agentId) => [
        agentId,
        httpAgent("strands-typescript", path),
      ]),
    );
    return { agents, options: RUNTIME_OPTIONS[demoId]?.() };
  },
} satisfies IntegrationRuntime;
