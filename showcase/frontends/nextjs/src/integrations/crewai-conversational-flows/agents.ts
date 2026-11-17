// The agents of each crewai-conversational-flows demo. One agent server runs
// them all, each Flow under /conversational_flows: demos that need a plain
// assistant share the chat Flow, and the rest have a Flow of their own.
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";

// The path of each demo's agent on the agent server, by demo id.
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/conversational_flows/a2ui-fixed-schema",
  "a2ui-recovery": "/conversational_flows/a2ui-recovery",
  "agent-config": "/conversational_flows/chat",
  "agentic-chat": "/conversational_flows/chat",
  auth: "/conversational_flows/chat",
  "beautiful-chat": "/conversational_flows/beautiful-chat",
  "byoc-hashbrown": "/conversational_flows/byoc-hashbrown",
  "chat-customization-css": "/conversational_flows/chat",
  "chat-slots": "/conversational_flows/chat",
  "declarative-gen-ui": "/conversational_flows/declarative-gen-ui",
  "declarative-hashbrown": "/conversational_flows/byoc-hashbrown",
  "declarative-json-render": "/conversational_flows/byoc-json-render",
  "frontend-tools": "/conversational_flows/frontend-tools",
  "frontend-tools-async": "/conversational_flows/frontend-tools",
  "gen-ui-agent": "/conversational_flows/gen-ui-agent",
  "gen-ui-interrupt": "/conversational_flows/interrupt",
  "gen-ui-tool-based": "/conversational_flows/gen-ui-tool-based",
  "headless-complete": "/conversational_flows/tool-rendering",
  "headless-simple": "/conversational_flows/chat",
  hitl: "/conversational_flows/frontend-tools",
  "hitl-in-app": "/conversational_flows/frontend-tools",
  "hitl-in-chat": "/conversational_flows/frontend-tools",
  "interrupt-headless": "/conversational_flows/interrupt",
  "mcp-apps": "/conversational_flows/mcp-apps",
  multimodal: "/conversational_flows/multimodal",
  "open-gen-ui": "/conversational_flows/frontend-tools",
  "open-gen-ui-advanced": "/conversational_flows/frontend-tools",
  "prebuilt-popup": "/conversational_flows/chat",
  "prebuilt-sidebar": "/conversational_flows/chat",
  "readonly-state-agent-context": "/conversational_flows/chat",
  "reasoning-custom": "/conversational_flows/reasoning",
  "reasoning-default": "/conversational_flows/reasoning",
  "shared-state-read": "/conversational_flows/shared-state-read",
  "shared-state-read-write": "/conversational_flows/shared-state-read-write",
  "shared-state-streaming": "/conversational_flows/shared-state-streaming",
  subagents: "/conversational_flows/subagents",
  "threadid-frontend-tool-roundtrip": "/conversational_flows/chat",
  "tool-rendering": "/conversational_flows/tool-rendering",
  "tool-rendering-custom-catchall": "/conversational_flows/tool-rendering",
  "tool-rendering-default-catchall": "/conversational_flows/tool-rendering",
  "tool-rendering-reasoning-chain":
    "/conversational_flows/tool-rendering-reasoning",
  voice: "/conversational_flows/chat",
};

// The runtime options that replace DEMO_RUNTIME_OPTIONS for
// crewai-conversational-flows, key by key, by demo id.
const RUNTIME_OPTIONS: Partial<Record<string, () => RuntimeOptions>> = {
  "beautiful-chat": () => ({ mcpApps: undefined }),
  // No `injectA2UITool`: the catalog that the page passes turns it on.
  "declarative-gen-ui": () => ({
    a2ui: { defaultCatalogId: "declarative-gen-ui-catalog" },
  }),
};

export default {
  createRuntimeConfig(demoId) {
    const path = AGENT_PATHS[demoId];
    const agentIds = DEMO_AGENT_IDS[demoId];
    if (path === undefined || agentIds === undefined) return undefined;
    const agents = Object.fromEntries(
      agentIds.map((agentId) => [
        agentId,
        httpAgent("crewai-conversational-flows", path),
      ]),
    );
    return { agents, options: RUNTIME_OPTIONS[demoId]?.() };
  },
} satisfies IntegrationRuntime;
