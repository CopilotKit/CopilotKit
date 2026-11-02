import { BuiltInAgent } from "@copilotkit/runtime";

export const agent = new BuiltInAgent({ model: "anthropic/claude-sonnet-4.5", apiKey: process.env.MY_KEY });

export const other = new BuiltInAgent({
  model: "openai/gpt-5.5",
  mcpClients: [client],
  urlDownload: false,
});
