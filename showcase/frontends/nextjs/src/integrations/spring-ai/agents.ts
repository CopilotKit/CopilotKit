// The agents of each spring-ai demo. One Spring Boot server runs them all:
// most demos share the agent at "/", and the rest have a controller of their
// own.
//
// tool-rendering-reasoning-chain has no runtime. The manifest marks it as not
// supported: spring-ai cannot interleave reasoning with parallel tool calls,
// and the agent at "/" would run it as plain tool rendering. So its page
// fails loudly instead.
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";

// The path of each demo's agent on the agent server, by demo id.
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/a2ui-fixed-schema/run",
  "agent-config": "/agent-config/run",
  "agentic-chat": "/",
  auth: "/",
  "beautiful-chat": "/",
  "chat-customization-css": "/",
  "chat-slots": "/",
  "declarative-gen-ui": "/",
  "declarative-hashbrown": "/byoc-hashbrown/run",
  "declarative-json-render": "/byoc-json-render/run",
  "frontend-tools": "/",
  "frontend-tools-async": "/",
  "gen-ui-agent": "/gen-ui-agent/run",
  "gen-ui-interrupt": "/interrupt-adapted",
  "gen-ui-tool-based": "/",
  "headless-complete": "/",
  "headless-simple": "/",
  hitl: "/",
  "hitl-in-app": "/",
  "hitl-in-chat": "/",
  "interrupt-headless": "/interrupt-adapted",
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
  subagents: "/subagents/run",
  "threadid-frontend-tool-roundtrip": "/",
  "tool-rendering": "/",
  "tool-rendering-custom-catchall": "/",
  "tool-rendering-default-catchall": "/",
  voice: "/",
};

// The runtime options that replace DEMO_RUNTIME_OPTIONS for spring-ai, key by
// key, by demo id.
const RUNTIME_OPTIONS: Partial<Record<string, () => RuntimeOptions>> = {
  // No runtime A2UI settings: the server's `display_flight` tool builds the
  // flight card.
  "a2ui-fixed-schema": () => ({ a2ui: undefined }),
  "beautiful-chat": () => ({ mcpApps: undefined }),
};

export default {
  createRuntimeConfig(demoId) {
    const path = AGENT_PATHS[demoId];
    const agentIds = DEMO_AGENT_IDS[demoId];
    if (path === undefined || agentIds === undefined) return undefined;
    const agents = Object.fromEntries(
      agentIds.map((agentId) => [agentId, httpAgent("spring-ai", path)]),
    );
    return { agents, options: RUNTIME_OPTIONS[demoId]?.() };
  },
} satisfies IntegrationRuntime;
