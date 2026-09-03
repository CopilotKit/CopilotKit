import { tavily } from "@tavily/core";
import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  defineTool,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { z } from "zod";
import { prompt } from "../../../../lib/prompt";

const searchInternet = defineTool({
  name: "searchInternet",
  description: "Searches the internet for information.",
  parameters: z.object({
    query: z.string().describe("The query to search the internet for."),
  }),
  execute: async ({ query }) => {
    const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
    return client.search(query, { maxResults: 5 });
  },
});

const agent = new BuiltInAgent({
  model: process.env.COPILOTKIT_MODEL ?? "openai/gpt-4o-mini",
  prompt,
  tools: [searchInternet],
  maxSteps: 5,
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
