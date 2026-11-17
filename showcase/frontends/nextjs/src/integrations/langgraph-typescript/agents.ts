// The agents of each langgraph-typescript demo. Each demo runs one graph on
// the integration's LangGraph server, which AGENT_URL_LANGGRAPH_TYPESCRIPT
// points at. Every graph runs with LangGraph's default config.
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { agentUrl } from "@/lib/agents";
import type { IntegrationRuntime } from "@/lib/agents";

// The graph of each demo, by demo id.
const DEMO_GRAPHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "a2ui_fixed",
  "a2ui-recovery": "a2ui_recovery",
  "agent-config": "agent_config_agent",
  "agentic-chat": "starterAgent",
  auth: "starterAgent",
  "beautiful-chat": "beautiful_chat",
  "chat-customization-css": "starterAgent",
  "chat-slots": "starterAgent",
  "declarative-gen-ui": "a2ui_dynamic",
  "declarative-hashbrown": "byoc_hashbrown",
  "declarative-json-render": "byoc_json_render",
  "frontend-tools": "frontend_tools",
  "frontend-tools-async": "frontend_tools_async",
  "gen-ui-agent": "gen_ui_agent",
  "gen-ui-interrupt": "interrupt_agent",
  "gen-ui-tool-based": "gen_ui_tool_based",
  "headless-complete": "headless_complete",
  "headless-simple": "starterAgent",
  hitl: "starterAgent",
  "hitl-in-app": "hitl_in_app",
  "hitl-in-chat": "hitl_in_chat",
  "interrupt-headless": "interrupt_agent",
  "mcp-apps": "mcp_apps",
  multimodal: "multimodal",
  "open-gen-ui": "open_gen_ui",
  "open-gen-ui-advanced": "open_gen_ui_advanced",
  "prebuilt-popup": "starterAgent",
  "prebuilt-sidebar": "starterAgent",
  "readonly-state-agent-context": "readonly_state_agent_context",
  "reasoning-custom": "agentic-chat-reasoning",
  "reasoning-default": "agentic-chat-reasoning",
  "shared-state-read": "starterAgent",
  "shared-state-read-write": "shared_state_read_write",
  "shared-state-streaming": "shared_state_streaming",
  subagents: "subagents",
  "threadid-frontend-tool-roundtrip": "frontend_tools",
  "tool-rendering": "tool_rendering",
  "tool-rendering-custom-catchall": "tool_rendering",
  "tool-rendering-default-catchall": "tool_rendering",
  "tool-rendering-reasoning-chain": "tool-rendering-reasoning-chain",
  voice: "starterAgent",
};

// One agent for each agent id, all on the same graph.
function langGraphAgents(agentIds: readonly string[], graphId: string) {
  const deploymentUrl = agentUrl("langgraph-typescript");
  const agents: Record<string, LangGraphAgent> = {};
  for (const agentId of agentIds) {
    agents[agentId] = new LangGraphAgent({ deploymentUrl, graphId });
  }
  return agents;
}

// The runtime options of a demo that differ from its DEMO_RUNTIME_OPTIONS.
function runtimeOptions(demoId: string) {
  switch (demoId) {
    case "beautiful-chat":
      // The runtime adds the generate_a2ui tool to the beautiful_chat graph.
      return {
        a2ui: {
          injectA2UITool: true,
          defaultCatalogId: "copilotkit://app-dashboard-catalog",
        },
      };
    case "declarative-gen-ui":
      // No A2UI settings. The page's catalog turns A2UI on, and the runtime
      // then adds the generate_a2ui tool that the a2ui_dynamic graph calls.
      return { a2ui: undefined };
    default:
      return undefined;
  }
}

export default {
  createRuntimeConfig(demoId) {
    const agentIds = DEMO_AGENT_IDS[demoId];
    const graphId = DEMO_GRAPHS[demoId];
    if (agentIds === undefined || graphId === undefined) return undefined;
    return {
      agents: langGraphAgents(agentIds, graphId),
      options: runtimeOptions(demoId),
    };
  },
} satisfies IntegrationRuntime;
