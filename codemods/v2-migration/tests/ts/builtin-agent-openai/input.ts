import { BuiltInAgent, CopilotRuntime, defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";

const getWeather = defineTool({
  name: "getWeather",
  description: "Get the weather",
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => `Sunny in ${city}`,
});

const agent = new BuiltInAgent({
  model: "openai/gpt-5.5",
  prompt: "You are a helpful assistant.",
  tools: [getWeather],
  mcpServers: [{ type: "http", url: "https://mcp.example.com" }],
  learnedSkills: { enabled: true },
  overridableProperties: ["prompt"],
  capabilities: { tools: true },
  forwardSystemMessages: true,
  forwardDeveloperMessages: false,
});

export const runtime = new CopilotRuntime({ agents: { default: agent } });
