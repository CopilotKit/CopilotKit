import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { prompt } from "../../../../lib/prompt";

const agent = new BuiltInAgent({
  model: process.env.COPILOTKIT_MODEL ?? "openai/gpt-4o-mini",
  prompt,
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
