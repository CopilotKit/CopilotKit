import {
  CopilotKitRuntime,
  CopilotKitIntelligence,
  InMemoryAgentRunner,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";
import { createDefaultAgent } from "@/agent";

const runtime = new CopilotKitRuntime({
  agents: { default: createDefaultAgent() },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotKitRuntimeHandler({
  cors: true,
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = app;
export const POST = app;
