import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";

export const mastraAgent = new Agent({
  name: "Weather Agent",
  instructions: `
      You are a helpful assistant.
`,
  model: openai("gpt-4o"),
});
