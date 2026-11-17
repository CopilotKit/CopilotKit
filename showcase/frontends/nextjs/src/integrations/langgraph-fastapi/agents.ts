// The agents of each langgraph-fastapi demo. Each demo runs one graph on the
// integration's LangGraph server, which AGENT_URL_LANGGRAPH_FASTAPI points at.
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { agentUrl } from "@/lib/agents";
import type { IntegrationRuntime } from "@/lib/agents";

// The settings of a LangGraph agent, other than its address.
type GraphSettings = Omit<
  ConstructorParameters<typeof LangGraphAgent>[0],
  "deploymentUrl"
>;

// A graph that runs with LangGraph's default config.
function graph(graphId: string) {
  return { graphId };
}

// A graph that runs with a recursion limit of 100. LangGraph's default limit
// of 25 stops multi-step graphs, such as gen_ui_agent, before their last step.
function graphWithRecursionLimit(graphId: string) {
  return { graphId, assistantConfig: { recursion_limit: 100 } };
}

// The graph of each demo, by demo id.
const DEMO_GRAPHS: Partial<Record<string, GraphSettings>> = {
  "a2ui-fixed-schema": graph("a2ui_fixed"),
  "a2ui-recovery": graph("a2ui_recovery"),
  "agent-config": graph("agent_config_agent"),
  "agentic-chat": graphWithRecursionLimit("agentic_chat"),
  auth: graph("sample_agent"),
  "beautiful-chat": graph("beautiful_chat"),
  "chat-customization-css": graphWithRecursionLimit("sample_agent"),
  "chat-slots": graphWithRecursionLimit("sample_agent"),
  "declarative-gen-ui": graph("a2ui_dynamic"),
  "declarative-hashbrown": graph("byoc_hashbrown"),
  "declarative-json-render": graph("byoc_json_render"),
  "frontend-tools": graphWithRecursionLimit("frontend_tools"),
  "frontend-tools-async": graphWithRecursionLimit("frontend_tools_async"),
  "gen-ui-agent": graphWithRecursionLimit("gen_ui_agent"),
  "gen-ui-interrupt": graphWithRecursionLimit("interrupt_agent"),
  "gen-ui-tool-based": graphWithRecursionLimit("gen_ui_tool_based"),
  "headless-complete": graph("headless_complete"),
  "headless-simple": graphWithRecursionLimit("sample_agent"),
  hitl: graphWithRecursionLimit("hitl_steps"),
  "hitl-in-app": graphWithRecursionLimit("hitl_in_app"),
  "hitl-in-chat": graphWithRecursionLimit("hitl_in_chat"),
  "interrupt-headless": graphWithRecursionLimit("interrupt_agent"),
  "mcp-apps": graph("mcp_apps"),
  multimodal: graph("multimodal"),
  "open-gen-ui": graph("open_gen_ui"),
  "open-gen-ui-advanced": graph("open_gen_ui_advanced"),
  "prebuilt-popup": graphWithRecursionLimit("sample_agent"),
  "prebuilt-sidebar": graphWithRecursionLimit("sample_agent"),
  "readonly-state-agent-context": graphWithRecursionLimit(
    "readonly_state_agent_context",
  ),
  "reasoning-custom": graphWithRecursionLimit("reasoning_agent"),
  "reasoning-default": graphWithRecursionLimit("reasoning_agent"),
  "shared-state-read": graphWithRecursionLimit("sample_agent"),
  "shared-state-read-write": graphWithRecursionLimit("shared_state_read_write"),
  "shared-state-streaming": graphWithRecursionLimit("shared_state_streaming"),
  subagents: graphWithRecursionLimit("subagents"),
  "threadid-frontend-tool-roundtrip": graphWithRecursionLimit("frontend_tools"),
  "tool-rendering": graphWithRecursionLimit("tool_rendering"),
  "tool-rendering-custom-catchall": graphWithRecursionLimit("tool_rendering"),
  "tool-rendering-default-catchall": graphWithRecursionLimit("tool_rendering"),
  "tool-rendering-reasoning-chain": graphWithRecursionLimit(
    "tool_rendering_reasoning_chain",
  ),
  voice: graph("sample_agent"),
};

// One agent for each agent id, all with the same graph settings.
function langGraphAgents(agentIds: readonly string[], settings: GraphSettings) {
  const deploymentUrl = agentUrl("langgraph-fastapi");
  const agents: Record<string, LangGraphAgent> = {};
  for (const agentId of agentIds) {
    agents[agentId] = new LangGraphAgent({ ...settings, deploymentUrl });
  }
  return agents;
}

// The runtime options of a demo that differ from its DEMO_RUNTIME_OPTIONS.
function runtimeOptions(demoId: string) {
  // No A2UI settings for declarative-gen-ui. The page's catalog turns A2UI
  // on, and the runtime then adds the generate_a2ui tool that the
  // a2ui_dynamic graph calls.
  if (demoId === "declarative-gen-ui") return { a2ui: undefined };
  return undefined;
}

export default {
  createRuntimeConfig(demoId) {
    const agentIds = DEMO_AGENT_IDS[demoId];
    const settings = DEMO_GRAPHS[demoId];
    if (agentIds === undefined || settings === undefined) return undefined;
    return {
      agents: langGraphAgents(agentIds, settings),
      options: runtimeOptions(demoId),
    };
  },
} satisfies IntegrationRuntime;
