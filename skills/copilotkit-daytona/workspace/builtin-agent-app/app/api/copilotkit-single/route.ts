// An existing CopilotKit Built-in Agent runtime route, with NO tools yet.
// The copilotkit-daytona skill adds a Daytona-backed `runCode` tool here.
import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotEndpointSingleRoute,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";

const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.4-mini",
  prompt: "You are a helpful assistant.",
});

const runtime = new CopilotRuntime({
  agents: { default: builtInAgent },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpointSingleRoute({
  runtime,
  basePath: "/api/copilotkit-single",
});

export const POST = handle(app);
