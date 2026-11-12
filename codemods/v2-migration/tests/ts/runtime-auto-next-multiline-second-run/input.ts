import {
  CopilotRuntime,
  CopilotKitIntelligence,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { createDefaultAgent } from "@/agent";

const runtime = new CopilotRuntime({
  agents: { default: createDefaultAgent() },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotRuntimeHandler({
  cors: true,
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = app;
export const POST = app;
