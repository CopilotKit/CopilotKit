// The agents and runtime options of each pydantic-ai demo, ported from the
// route files of showcase/integrations/pydantic-ai. Every agent is mounted on
// the one FastAPI server at AGENT_URL_PYDANTIC_AI.
import { HttpAgent } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { splitForwardedProps } from "@/lib/agent-config-http-agent";
import { agentUrl, httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";

const SLUG = "pydantic-ai";

// The path of each demo's agent on the agent server. A demo that changes only
// the UI uses the shared agent at "/".
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/a2ui_fixed/",
  "agent-config": "/agent_config/",
  "agentic-chat": "/",
  auth: "/",
  "beautiful-chat": "/beautiful_chat/",
  "chat-customization-css": "/",
  "chat-slots": "/",
  "declarative-gen-ui": "/a2ui_dynamic/",
  "declarative-hashbrown": "/byoc_hashbrown/",
  "declarative-json-render": "/byoc_json_render/",
  "frontend-tools": "/",
  "frontend-tools-async": "/",
  "gen-ui-agent": "/",
  "gen-ui-interrupt": "/interrupt/",
  "gen-ui-tool-based": "/gen_ui_tool_based/",
  "headless-complete": "/headless_complete/",
  "headless-simple": "/",
  hitl: "/",
  "hitl-in-app": "/",
  "hitl-in-chat": "/hitl_in_chat/",
  "interrupt-headless": "/interrupt/",
  "mcp-apps": "/mcp_apps/",
  multimodal: "/multimodal/",
  "open-gen-ui": "/open_gen_ui/",
  "open-gen-ui-advanced": "/open_gen_ui_advanced/",
  "prebuilt-popup": "/",
  "prebuilt-sidebar": "/",
  "readonly-state-agent-context": "/",
  "reasoning-custom": "/reasoning/",
  "reasoning-default": "/reasoning/",
  "shared-state-read": "/",
  "shared-state-read-write": "/shared_state_read_write/",
  "shared-state-streaming": "/",
  subagents: "/subagents/",
  "threadid-frontend-tool-roundtrip": "/",
  "tool-rendering": "/",
  "tool-rendering-custom-catchall": "/",
  "tool-rendering-default-catchall": "/",
  "tool-rendering-reasoning-chain": "/tool_rendering_reasoning_chain/",
  voice: "/",
};

// The runtime options that differ from DEMO_RUNTIME_OPTIONS.
const RUNTIME_OPTIONS: Partial<Record<string, RuntimeOptions>> = {
  "beautiful-chat": { mcpApps: undefined },
};

// The description of the context entry that carries the provider's
// properties. The agent-config agent on the agent server looks for it.
const PROPERTIES_CONTEXT = "agent-config-properties";

// The agent of the agent-config demo. pydantic-ai's AG-UI bridge gives the
// agent the run's `context`, not its `forwardedProps`, so this agent moves the
// CopilotKit provider's properties into one context entry, as JSON. The new
// entry replaces an earlier one. The class keeps no fields of its own, so the
// copy that `clone()` makes for each request does the same.
class AgentConfigContextHttpAgent extends HttpAgent {
  run(input: RunAgentInput) {
    const { reserved, properties } = splitForwardedProps(input.forwardedProps);
    const hasProperties = Object.keys(properties).length > 0;
    if (!hasProperties) return super.run(input);
    const context = input.context.filter(
      (entry) => entry.description !== PROPERTIES_CONTEXT,
    );
    const propertiesEntry = {
      description: PROPERTIES_CONTEXT,
      value: JSON.stringify(properties),
    };
    return super.run({
      ...input,
      forwardedProps: reserved,
      context: [...context, propertiesEntry],
    });
  }
}

export default {
  createRuntimeConfig(demoId) {
    const path = AGENT_PATHS[demoId];
    const agentIds = DEMO_AGENT_IDS[demoId];
    if (path === undefined || agentIds === undefined) return undefined;
    const agent =
      demoId === "agent-config"
        ? new AgentConfigContextHttpAgent({ url: `${agentUrl(SLUG)}${path}` })
        : httpAgent(SLUG, path);
    return {
      agents: Object.fromEntries(agentIds.map((id) => [id, agent] as const)),
      options: RUNTIME_OPTIONS[demoId],
    };
  },
} satisfies IntegrationRuntime;
