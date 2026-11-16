// The agents of each built-in-agent demo. They run in this process and call
// the LLM themselves (OPENAI_BASE_URL, OPENAI_API_KEY), so this integration
// has no env.ts. An agent is built when the runtime route first asks for its
// demo: importing this module builds nothing.
import type { IntegrationRuntime, RuntimeConfig } from "@/lib/agents";
import { createTranscriptionService } from "@/lib/transcription-service";
import {
  createA2UIRecoveryAgent,
  createDeclarativeGenUIAgent,
} from "./agent/factory/a2ui-factory";
import { createA2UIFixedSchemaAgent } from "./agent/factory/a2ui-fixed-schema-factory";
import { createAgentConfigAgent } from "./agent/factory/agent-config-factory";
import { createAgenticChatAgent } from "./agent/factory/agentic-chat-factory";
import { createBeautifulChatAgent } from "./agent/factory/beautiful-chat-factory";
import { createByocHashbrownAgent } from "./agent/factory/byoc-hashbrown-factory";
import { createByocJsonRenderAgent } from "./agent/factory/byoc-json-render-factory";
import {
  GEN_UI_AGENT_PROMPT,
  GEN_UI_TOOL_BASED_PROMPT,
  SUBAGENTS_PROMPT,
} from "./agent/factory/demo-prompts";
import { createMcpAppsAgent } from "./agent/factory/mcp-apps-factory";
import { createMultimodalAgent } from "./agent/factory/multimodal-factory";
import { createOguiAgent } from "./agent/factory/ogui-factory";
import {
  createAgenticChatReasoningAgent,
  createReasoningDefaultRenderAgent,
  createToolRenderingReasoningChainAgent,
} from "./agent/factory/reasoning-factory";
import { createBuiltInAgent } from "./agent/factory/tanstack-factory";

// One demo's config. Every branch below returns this one type: object
// literals with different agent keys would infer a union that RuntimeConfig
// rejects.
function runtimeConfig(
  agents: RuntimeConfig["agents"],
  options?: RuntimeConfig["options"],
) {
  return { agents, options };
}

export default {
  createRuntimeConfig(demoId) {
    switch (demoId) {
      // These demos share the generic built-in agent, and each page uses the
      // demo id as its agent id. The aimock fixture drives what each one does.
      case "chat-customization-css":
      case "chat-slots":
      case "frontend-tools-async":
      case "gen-ui-interrupt":
      case "headless-complete":
      case "headless-simple":
      case "hitl-in-app":
      case "hitl-in-chat":
      case "interrupt-headless":
      case "prebuilt-popup":
      case "prebuilt-sidebar":
      case "readonly-state-agent-context":
      case "shared-state-read":
      case "shared-state-read-write":
      case "shared-state-streaming":
      case "threadid-frontend-tool-roundtrip":
      case "tool-rendering":
      case "tool-rendering-custom-catchall":
      case "tool-rendering-default-catchall":
        return runtimeConfig({ [demoId]: createBuiltInAgent() });
      case "auth":
        return runtimeConfig({ "auth-demo": createBuiltInAgent() });
      case "frontend-tools":
        return runtimeConfig({ frontend_tools: createBuiltInAgent() });
      case "hitl":
        return runtimeConfig({ human_in_the_loop: createBuiltInAgent() });
      case "voice":
        // Transcription needs its own key, OPENAI_TRANSCRIPTION_API_KEY.
        // Without it there is no transcription service, so the page shows no
        // mic: aimock cannot transcribe.
        return runtimeConfig(
          { "voice-demo": createBuiltInAgent() },
          { transcriptionService: createTranscriptionService() },
        );

      // These demos tell the generic agent what to do in a system prompt.
      case "gen-ui-agent":
        return runtimeConfig({
          "gen-ui-agent": createBuiltInAgent({
            systemPrompt: GEN_UI_AGENT_PROMPT,
          }),
        });
      case "gen-ui-tool-based":
        return runtimeConfig({
          "gen-ui-tool-based": createBuiltInAgent({
            systemPrompt: GEN_UI_TOOL_BASED_PROMPT,
          }),
        });
      case "subagents":
        return runtimeConfig({
          subagents: createBuiltInAgent({ systemPrompt: SUBAGENTS_PROMPT }),
        });

      // These demos have an agent of their own.
      case "agentic-chat":
        return runtimeConfig({ agentic_chat: createAgenticChatAgent() });
      case "a2ui-fixed-schema":
        return runtimeConfig({
          "a2ui-fixed-schema": createA2UIFixedSchemaAgent(),
        });
      case "a2ui-recovery":
        return runtimeConfig({ "a2ui-recovery": createA2UIRecoveryAgent() });
      case "agent-config":
        return runtimeConfig({ "agent-config-demo": createAgentConfigAgent() });
      case "beautiful-chat":
        // The agent declares the `render_a2ui` tool that the A2UI middleware
        // injects, so the runtime must inject it.
        return runtimeConfig(
          { "beautiful-chat": createBeautifulChatAgent() },
          {
            a2ui: {
              injectA2UITool: true,
              defaultCatalogId: "copilotkit://app-dashboard-catalog",
            },
          },
        );
      case "declarative-gen-ui":
        return runtimeConfig({
          "declarative-gen-ui": createDeclarativeGenUIAgent(),
        });
      case "declarative-hashbrown":
        return runtimeConfig({
          "declarative-hashbrown-demo": createByocHashbrownAgent(),
        });
      case "declarative-json-render":
        return runtimeConfig({ byoc_json_render: createByocJsonRenderAgent() });
      case "mcp-apps":
        return runtimeConfig({ "mcp-apps": createMcpAppsAgent() });
      case "multimodal":
        return runtimeConfig({ "multimodal-demo": createMultimodalAgent() });
      case "open-gen-ui":
      case "open-gen-ui-advanced":
        return runtimeConfig({ [demoId]: createOguiAgent() });
      case "reasoning-custom":
        return runtimeConfig({
          "reasoning-custom": createAgenticChatReasoningAgent(),
        });
      case "reasoning-default":
        return runtimeConfig({
          "reasoning-default": createReasoningDefaultRenderAgent(),
        });
      case "tool-rendering-reasoning-chain":
        return runtimeConfig({
          "tool-rendering-reasoning-chain":
            createToolRenderingReasoningChainAgent(),
        });
      default:
        return undefined;
    }
  },
} satisfies IntegrationRuntime;
