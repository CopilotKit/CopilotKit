// The agents of each claude-sdk-typescript demo. One agent server runs them
// all. The agent at "/" passes the page's tools to Claude, so most demos share
// it. Demos whose tools or state live on the server have an endpoint of their
// own.
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { DEMO_RUNTIME_OPTIONS } from "@/demo-runtime-options";
import { httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";

// The path of each demo's agent on the agent server, by demo id.
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/a2ui-fixed-schema",
  "agent-config": "/agent-config",
  "agentic-chat": "/",
  auth: "/",
  "beautiful-chat": "/beautiful-chat",
  "chat-customization-css": "/",
  "chat-slots": "/",
  "declarative-gen-ui": "/declarative-gen-ui",
  "declarative-hashbrown": "/byoc-hashbrown",
  "declarative-json-render": "/byoc-json-render",
  "frontend-tools": "/",
  "frontend-tools-async": "/",
  "gen-ui-agent": "/gen-ui-agent",
  "gen-ui-interrupt": "/",
  "gen-ui-tool-based": "/",
  "headless-complete": "/headless-complete",
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
  "reasoning-custom": "/reasoning",
  "reasoning-default": "/reasoning",
  "shared-state-read": "/",
  "shared-state-read-write": "/shared-state-read-write",
  "shared-state-streaming": "/shared-state-streaming",
  subagents: "/subagents",
  "threadid-frontend-tool-roundtrip": "/",
  "tool-rendering": "/tool-rendering",
  "tool-rendering-custom-catchall": "/tool-rendering",
  "tool-rendering-default-catchall": "/tool-rendering",
  "tool-rendering-reasoning-chain": "/tool-rendering-reasoning-chain",
  voice: "/",
};

// The runtime options that replace DEMO_RUNTIME_OPTIONS for
// claude-sdk-typescript, key by key, by demo id.
const RUNTIME_OPTIONS: Partial<Record<string, () => RuntimeOptions>> = {
  // beautiful-chat uses the MCP Apps server of the mcp-apps demo, whose
  // server id is `excalidraw`.
  "beautiful-chat": () => ({
    mcpApps: DEMO_RUNTIME_OPTIONS["mcp-apps"]?.mcpApps,
  }),
};

// aimock picks its fixtures by the x-aimock-context header. When Claude calls
// go to aimock, every agent sends this integration's slug, so a run that
// arrives without the header still gets this integration's fixtures.
function aimockHeaders() {
  const aimockUrls = [process.env.ANTHROPIC_BASE_URL, process.env.AIMOCK_URL];
  const usesAimock = aimockUrls.some((url) => url?.includes("aimock"));
  return usesAimock
    ? { "x-aimock-context": "claude-sdk-typescript" }
    : undefined;
}

export default {
  createRuntimeConfig(demoId) {
    const path = AGENT_PATHS[demoId];
    const agentIds = DEMO_AGENT_IDS[demoId];
    if (path === undefined || agentIds === undefined) return undefined;
    const headers = aimockHeaders();
    const agents = Object.fromEntries(
      agentIds.map((agentId) => [
        agentId,
        httpAgent("claude-sdk-typescript", path, { headers }),
      ]),
    );
    return { agents, options: RUNTIME_OPTIONS[demoId]?.() };
  },
} satisfies IntegrationRuntime;
