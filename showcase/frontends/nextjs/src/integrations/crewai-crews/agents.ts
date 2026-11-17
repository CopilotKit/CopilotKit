// The agents of each crewai-crews demo. One agent server runs them all: demos
// that need a plain assistant share the neutral chat Flow at "/chat", and the
// rest have a Flow of their own.
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";

// The path of each demo's agent on the agent server, by demo id.
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/a2ui-fixed-schema",
  "a2ui-recovery": "/a2ui-recovery",
  "agent-config": "/chat",
  "agentic-chat": "/chat",
  auth: "/chat",
  "beautiful-chat": "/beautiful-chat",
  "byoc-hashbrown": "/byoc-hashbrown",
  "chat-customization-css": "/chat",
  "chat-slots": "/chat",
  "declarative-gen-ui": "/declarative-gen-ui",
  "declarative-hashbrown": "/byoc-hashbrown",
  "declarative-json-render": "/byoc-json-render",
  "frontend-tools": "/frontend-tools",
  "frontend-tools-async": "/frontend-tools",
  "gen-ui-agent": "/gen-ui-agent",
  "gen-ui-interrupt": "/interrupt",
  "gen-ui-tool-based": "/gen-ui-tool-based",
  "headless-complete": "/tool-rendering",
  "headless-simple": "/chat",
  hitl: "/frontend-tools",
  "hitl-in-app": "/frontend-tools",
  "hitl-in-chat": "/frontend-tools",
  "interrupt-headless": "/interrupt",
  "mcp-apps": "/mcp-apps",
  multimodal: "/multimodal",
  "open-gen-ui": "/frontend-tools",
  "open-gen-ui-advanced": "/frontend-tools",
  "prebuilt-popup": "/chat",
  "prebuilt-sidebar": "/chat",
  "readonly-state-agent-context": "/chat",
  "reasoning-custom": "/reasoning",
  "reasoning-default": "/reasoning",
  "shared-state-read": "/shared-state-read",
  "shared-state-read-write": "/shared-state-read-write",
  "shared-state-streaming": "/shared-state-streaming",
  subagents: "/subagents",
  "threadid-frontend-tool-roundtrip": "/chat",
  "tool-rendering": "/tool-rendering",
  "tool-rendering-custom-catchall": "/tool-rendering",
  "tool-rendering-default-catchall": "/tool-rendering",
  "tool-rendering-reasoning-chain": "/tool-rendering-reasoning",
  voice: "/chat",
};

// The runtime options that replace DEMO_RUNTIME_OPTIONS for crewai-crews, key
// by key, by demo id.
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
      agentIds.map((agentId) => [agentId, httpAgent("crewai-crews", path)]),
    );
    return { agents, options: RUNTIME_OPTIONS[demoId]?.() };
  },
} satisfies IntegrationRuntime;
