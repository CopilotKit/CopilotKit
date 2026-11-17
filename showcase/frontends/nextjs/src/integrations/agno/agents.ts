// The agents of each agno demo. One agent server runs them all: most demos
// share the main agent at "/agui", and the rest have an AG-UI endpoint of
// their own. The gen-ui-agent, shared-state-read-write and subagents
// endpoints send a state snapshot after each run, which the main agent does
// not.
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";

// The path of each demo's agent on the agent server, by demo id.
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/a2ui-fixed-schema/agui",
  "agent-config": "/agent-config/agui",
  "agentic-chat": "/agui",
  auth: "/agui",
  "beautiful-chat": "/agui",
  "chat-customization-css": "/agui",
  "chat-slots": "/agui",
  "declarative-gen-ui": "/declarative-gen-ui/agui",
  "declarative-hashbrown": "/byoc-hashbrown/agui",
  "declarative-json-render": "/byoc-json-render/agui",
  "frontend-tools": "/agui",
  "frontend-tools-async": "/agui",
  "gen-ui-agent": "/gen-ui-agent/agui",
  "gen-ui-interrupt": "/interrupt-adapted/agui",
  "gen-ui-tool-based": "/agui",
  "headless-complete": "/agui",
  "headless-simple": "/agui",
  hitl: "/agui",
  "hitl-in-app": "/agui",
  "hitl-in-chat": "/agui",
  "interrupt-headless": "/interrupt-adapted/agui",
  "mcp-apps": "/mcp-apps/agui",
  multimodal: "/multimodal/agui",
  "open-gen-ui": "/open-gen-ui/agui",
  "open-gen-ui-advanced": "/open-gen-ui/agui",
  "prebuilt-popup": "/agui",
  "prebuilt-sidebar": "/agui",
  "readonly-state-agent-context": "/agui",
  "reasoning-custom": "/reasoning/agui",
  "reasoning-default": "/reasoning/agui",
  "shared-state-read": "/agui",
  "shared-state-read-write": "/shared-state-rw/agui",
  "shared-state-streaming": "/agui",
  subagents: "/subagents/agui",
  "threadid-frontend-tool-roundtrip": "/agui",
  "tool-rendering": "/agui",
  "tool-rendering-custom-catchall": "/agui",
  "tool-rendering-default-catchall": "/agui",
  "tool-rendering-reasoning-chain": "/reasoning/agui",
  voice: "/agui",
};

// The runtime options that replace DEMO_RUNTIME_OPTIONS for agno, key by key,
// by demo id.
const RUNTIME_OPTIONS: Partial<Record<string, () => RuntimeOptions>> = {
  "beautiful-chat": () => ({ mcpApps: undefined }),
};

export default {
  createRuntimeConfig(demoId) {
    const path = AGENT_PATHS[demoId];
    const agentIds = DEMO_AGENT_IDS[demoId];
    if (path === undefined || agentIds === undefined) return undefined;
    const agents = Object.fromEntries(
      agentIds.map((agentId) => [agentId, httpAgent("agno", path)]),
    );
    return { agents, options: RUNTIME_OPTIONS[demoId]?.() };
  },
} satisfies IntegrationRuntime;
