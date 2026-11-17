// The agents of each mastra demo. They run in this process and call the LLM
// themselves (OPENAI_BASE_URL, OPENAI_API_KEY), so this integration has no
// env.ts. The Mastra instance and its agents are built when the runtime route
// first asks for a mastra demo: importing this module builds nothing.
import { MastraAgent, getLocalAgent } from "@ag-ui/mastra";
import type { IntegrationRuntime, RuntimeConfig } from "@/lib/agents";
import { getMastra } from "./agent";
import type { MastraAgentKey } from "./agent";

// One demo's config. Every branch below returns this one type: object
// literals with different agent keys would infer a union that RuntimeConfig
// rejects.
function runtimeConfig(
  agents: RuntimeConfig["agents"],
  options?: RuntimeConfig["options"],
) {
  return { agents, options };
}

// The AG-UI agent that runs one Mastra agent for one demo. The resource id
// scopes the agent's working memory, so demos that share a Mastra agent never
// see each other's memory.
function demoAgent(demoId: string, agentId: MastraAgentKey) {
  return getLocalAgent({
    mastra: getMastra(),
    agentId,
    resourceId: `mastra-${demoId}`,
  });
}

export default {
  createRuntimeConfig(demoId) {
    switch (demoId) {
      // These demos run the shared weatherAgent, and each page uses the demo
      // id as its agent id.
      case "chat-customization-css":
      case "chat-slots":
      case "declarative-gen-ui":
      case "frontend-tools-async":
      case "gen-ui-tool-based":
      case "headless-simple":
      case "hitl-in-app":
      case "hitl-in-chat":
      case "prebuilt-popup":
      case "prebuilt-sidebar":
      case "readonly-state-agent-context":
      case "shared-state-read":
      case "threadid-frontend-tool-roundtrip":
        return runtimeConfig({ [demoId]: demoAgent(demoId, "weatherAgent") });
      case "agent-config":
        return runtimeConfig({
          "agent-config-demo": demoAgent(demoId, "weatherAgent"),
        });
      case "agentic-chat":
        return runtimeConfig({
          agentic_chat: demoAgent(demoId, "weatherAgent"),
        });
      case "auth":
        return runtimeConfig({
          "auth-demo": demoAgent(demoId, "weatherAgent"),
        });
      case "declarative-json-render":
        return runtimeConfig({
          byoc_json_render: demoAgent(demoId, "weatherAgent"),
        });
      case "frontend-tools":
        return runtimeConfig({
          frontend_tools: demoAgent(demoId, "weatherAgent"),
        });
      case "hitl":
        return runtimeConfig({
          human_in_the_loop: demoAgent(demoId, "weatherAgent"),
        });
      case "voice":
        return runtimeConfig({
          "voice-demo": demoAgent(demoId, "weatherAgent"),
        });
      case "a2ui-fixed-schema":
        return runtimeConfig(
          { "a2ui-fixed-schema": demoAgent(demoId, "weatherAgent") },
          // Pins the catalog that the page registers, so a model that omits
          // `catalogId` does not fall back to the basic catalog ("Catalog not
          // found").
          {
            a2ui: {
              injectA2UITool: false,
              defaultCatalogId: "copilotkit://flight-fixed-catalog",
            },
          },
        );

      // These demos have a Mastra agent of their own.
      case "gen-ui-interrupt":
      case "interrupt-headless":
        return runtimeConfig({ [demoId]: demoAgent(demoId, "interruptAgent") });
      case "reasoning-custom":
      case "reasoning-default":
        return runtimeConfig({ [demoId]: demoAgent(demoId, "reasoningAgent") });
      case "tool-rendering":
      case "tool-rendering-custom-catchall":
      case "tool-rendering-default-catchall":
        return runtimeConfig({
          [demoId]: demoAgent(demoId, "toolRenderingAgent"),
        });
      case "a2ui-recovery":
        return runtimeConfig({
          "a2ui-recovery": demoAgent(demoId, "a2uiRecoveryAgent"),
        });
      case "background-agents":
        return runtimeConfig({
          "background-agents": demoAgent(demoId, "backgroundAgentsAgent"),
        });
      case "beautiful-chat":
        return runtimeConfig({
          "beautiful-chat": demoAgent(demoId, "beautifulChatAgent"),
        });
      case "browser-use":
        return runtimeConfig({
          "browser-use": demoAgent(demoId, "browserUseAgent"),
        });
      case "declarative-hashbrown":
        return runtimeConfig({
          "declarative-hashbrown-demo": demoAgent(demoId, "byocHashbrownAgent"),
        });
      case "gen-ui-agent":
        return runtimeConfig({
          "gen-ui-agent": demoAgent(demoId, "genUiAgent"),
        });
      case "headless-complete":
        return runtimeConfig({
          "headless-complete": demoAgent(demoId, "headlessCompleteAgent"),
        });
      case "mcp-apps":
        return runtimeConfig({
          "mcp-apps": demoAgent(demoId, "mcpAppsAgent"),
        });
      case "multimodal":
        return runtimeConfig({
          "multimodal-demo": demoAgent(demoId, "multimodalAgent"),
        });
      case "observational-memory":
        return runtimeConfig({
          // `observationalMemory: true` makes the bridge forward the
          // Observer's `data-om-*` chunks as activity events. The agent's
          // Memory turns Observational Memory on; this only surfaces it.
          "observational-memory": new MastraAgent({
            agentId: "observationalMemoryAgent",
            agent: getMastra().getAgent("observationalMemoryAgent"),
            resourceId: `mastra-${demoId}`,
            observationalMemory: true,
          }),
        });
      case "open-gen-ui":
        return runtimeConfig({
          "open-gen-ui": demoAgent(demoId, "openGenUiAgent"),
        });
      case "open-gen-ui-advanced":
        return runtimeConfig({
          "open-gen-ui-advanced": demoAgent(demoId, "openGenUiAdvancedAgent"),
        });
      case "shared-state-read-write":
        return runtimeConfig({
          "shared-state-read-write": demoAgent(
            demoId,
            "sharedStateReadWriteAgent",
          ),
        });
      case "shared-state-streaming":
        return runtimeConfig({
          "shared-state-streaming": demoAgent(
            demoId,
            "sharedStateStreamingAgent",
          ),
        });
      case "subagents":
        return runtimeConfig({
          subagents: demoAgent(demoId, "subagentsSupervisorAgent"),
        });
      case "tool-rendering-reasoning-chain":
        return runtimeConfig({
          "tool-rendering-reasoning-chain": demoAgent(
            demoId,
            "reasoningChainAgent",
          ),
        });
      default:
        return undefined;
    }
  },
} satisfies IntegrationRuntime;
