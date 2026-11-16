// The agents and runtime options of each claude-sdk-python demo, ported from
// the route files of showcase/integrations/claude-sdk-python. Every agent is
// an endpoint of the one FastAPI server at AGENT_URL_CLAUDE_SDK_PYTHON.
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { DEMO_RUNTIME_OPTIONS } from "@/demo-runtime-options";
import { AgentConfigHttpAgent } from "@/lib/agent-config-http-agent";
import { agentUrl, httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";

const SLUG = "claude-sdk-python";

// The path of each demo's agent on the agent server. A demo that changes only
// the UI uses the shared agent at "/".
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/a2ui-fixed-schema",
  "agent-config": "/agent-config",
  "agentic-chat": "/",
  auth: "/",
  "beautiful-chat": "/beautiful-chat",
  "chat-customization-css": "/",
  "chat-slots": "/",
  "declarative-gen-ui": "/declarative-gen-ui",
  "declarative-hashbrown": "/declarative-hashbrown",
  "declarative-json-render": "/declarative-json-render",
  "frontend-tools": "/",
  "frontend-tools-async": "/",
  "gen-ui-agent": "/gen-ui-agent",
  "gen-ui-interrupt": "/interrupt-adapted",
  "gen-ui-tool-based": "/",
  "headless-complete": "/headless-complete",
  "headless-simple": "/",
  hitl: "/",
  "hitl-in-app": "/",
  "hitl-in-chat": "/hitl-in-chat",
  "interrupt-headless": "/interrupt-adapted",
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

// The runtime options that differ from DEMO_RUNTIME_OPTIONS.
const RUNTIME_OPTIONS: Partial<Record<string, RuntimeOptions>> = {
  // The MCP Apps server of the mcp-apps demo, with the serverId "excalidraw".
  "beautiful-chat": { mcpApps: DEMO_RUNTIME_OPTIONS["mcp-apps"]?.mcpApps },
};

// aimock picks its fixtures by the x-aimock-context header. When Claude calls
// go to aimock, every agent sends this integration's slug, so a run that
// arrives without the header still gets this integration's fixtures.
function aimockHeaders() {
  const aimockUrls = [process.env.ANTHROPIC_BASE_URL, process.env.AIMOCK_URL];
  const usesAimock = aimockUrls.some((url) => url?.includes("aimock"));
  return usesAimock ? { "x-aimock-context": SLUG } : undefined;
}

export default {
  createRuntimeConfig(demoId) {
    const path = AGENT_PATHS[demoId];
    const agentIds = DEMO_AGENT_IDS[demoId];
    if (path === undefined || agentIds === undefined) return undefined;
    const headers = aimockHeaders();
    const agent =
      demoId === "agent-config"
        ? new AgentConfigHttpAgent({ url: `${agentUrl(SLUG)}${path}`, headers })
        : httpAgent(SLUG, path, { headers });
    return {
      agents: Object.fromEntries(agentIds.map((id) => [id, agent] as const)),
      options: RUNTIME_OPTIONS[demoId],
    };
  },
} satisfies IntegrationRuntime;
