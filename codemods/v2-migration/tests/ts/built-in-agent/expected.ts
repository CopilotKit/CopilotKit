// TODO(copilotkit-2.0): `MCPClient` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/integrations/built-in-agent/mcp-servers
// TODO(copilotkit-2.0): `MCPClient`: `@copilotkit/runtime` no longer re-exports the MCP client types. Import them from `@tanstack/ai-mcp`.
import {
  BuiltInAgent,
  defineTool,
} from "@copilotkit/runtime/agent";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  type MCPClient,
} from "@copilotkit/runtime";
import { resolveModel, type BuiltInAgentClassicConfig } from "@copilotkit/runtime/agent";
import { convertMessagesToVercelAISDKMessages } from "@copilotkit/runtime/agent/ai-sdk";
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
      /* TODO(copilotkit-2.0): `temperature` was removed in 2.0. Pass provider-native options in `modelOptions`. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */ temperature: 0.2,
      /* TODO(copilotkit-2.0): `providerOptions` was removed in 2.0. Pass provider-native options in `modelOptions`. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */ providerOptions: { openai: { reasoningEffort: "low" } },
      tools: [weather],
    }),
    sdk: new BuiltInAgent({ /* TODO(copilotkit-2.0): `model` takes a model string or a TanStack adapter such as `openaiText(...)` in 2.0, not an AI SDK model. Pass one of those, or use a `type: "aisdk"` factory. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */ model: openai("gpt-4o") }),
    claude: new BuiltInAgent({
      /* TODO(copilotkit-2.0): `model` takes a model string or a TanStack adapter such as `openaiText(...)` in 2.0, not an AI SDK model. Pass one of those, or use a `type: "aisdk"` factory. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */ model: anthropic("claude-sonnet-4-5"),
      /* TODO(copilotkit-2.0): `urlDownload` was removed in 2.0. The server no longer downloads attachment URLs. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */ urlDownload: { maxBytes: 1_000_000 },
    }),
    configured: new BuiltInAgent(config),
  },
});

export const handler = createCopilotRuntimeHandler({ runtime });
export const model = /* TODO(copilotkit-2.0): `resolveModel` is async in 2.0. Add `await` before this call. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */ resolveModel("openai/gpt-5");
export const awaited = async () => await resolveModel("openai/gpt-5");
export const toMessages = convertMessagesToVercelAISDKMessages;
export type Clients = MCPClient[];
