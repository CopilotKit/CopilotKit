import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { anthropicText } from "@tanstack/ai-anthropic";
import { openaiText } from "@tanstack/ai-openai";

// TODO(copilotkit-2.0): `apiKey` is not a `tanstackAIAgent` option. The adapter reads the API key from the environment. To pass a key in code, build the adapter with the create function of its package. See https://docs.copilotkit.ai/migrate/runtime-2.0
export const agent = tanstackAIAgent({ adapter: anthropicText("claude-sonnet-4.5"), apiKey: process.env.MY_KEY });

export const other = tanstackAIAgent({
  adapter: openaiText("gpt-5.5"),
  // TODO(copilotkit-2.0): `mcpClients` is not a `tanstackAIAgent` option. List the servers in `mcpServers`, or add their tools to `tools`. See https://docs.copilotkit.ai/migrate/runtime-2.0
  mcpClients: [client],
  // TODO(copilotkit-2.0): `urlDownload` is not a `tanstackAIAgent` option. Use `aiSdkAgent` from "@copilotkit/runtime/ai-sdk" to keep it. See https://docs.copilotkit.ai/migrate/runtime-2.0
  urlDownload: false,
});
