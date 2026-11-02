import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { openaiText } from "@tanstack/ai-openai";
import { prompt } from "../../../../lib/prompt";

const agent = tanstackAIAgent({
  adapter: openaiText("gpt-5-mini"),
  prompt,
  maxIterations: 5,
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
