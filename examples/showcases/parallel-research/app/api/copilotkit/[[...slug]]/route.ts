import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { parallelServer } from "../../../../lib/parallel-config";
import { RESEARCH_PROMPT } from "../../../../lib/research-prompt";

export const runtime = "nodejs";
const agent = new BuiltInAgent({
  model: "openai:gpt-5.4-mini",
  maxSteps: 6,
  prompt: RESEARCH_PROMPT,
  mcpServers: [parallelServer(process.env.PARALLEL_API_KEY)],
});
const copilotRuntime = new CopilotRuntime({
  agents: { default: agent },
  runner: new InMemoryAgentRunner(),
});
const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
});
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
