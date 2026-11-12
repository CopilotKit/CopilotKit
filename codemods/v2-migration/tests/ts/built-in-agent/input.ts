import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  defineTool,
  type MCPClient,
} from "@copilotkit/runtime";
import { resolveModel, type BuiltInAgentClassicConfig } from "@copilotkit/runtime/v2";
import { convertMessagesToVercelAISDKMessages } from "@copilotkit/runtime";
import { openai } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_KEY });

const weather = defineTool({
  name: "weather",
  description: "Get the weather",
  parameters: { type: "object", properties: {} },
  execute: async () => "sunny",
});

const config: BuiltInAgentClassicConfig = { model: "openai/gpt-5" };

export const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: "openai/gpt-5",
      temperature: 0.2,
      providerOptions: { openai: { reasoningEffort: "low" } },
      tools: [weather],
    }),
    sdk: new BuiltInAgent({ model: openai("gpt-4o") }),
    claude: new BuiltInAgent({
      model: anthropic("claude-sonnet-4-5"),
      urlDownload: { maxBytes: 1_000_000 },
    }),
    configured: new BuiltInAgent(config),
  },
});

export const handler = createCopilotRuntimeHandler({ runtime });
export const model = resolveModel("openai/gpt-5");
export const awaited = async () => await resolveModel("openai/gpt-5");
export const toMessages = convertMessagesToVercelAISDKMessages;
export type Clients = MCPClient[];
