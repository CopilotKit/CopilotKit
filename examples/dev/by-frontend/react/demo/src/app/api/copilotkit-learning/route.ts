import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";
import { ScriptedDealAgent } from "@/lib/scripted-deal-agent";

// The learning demo needs the same steps on every run, so it uses a scripted agent and no LLM key.
const runtime = new CopilotRuntime({
  agents: { default: new ScriptedDealAgent() },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotKitRuntimeHandler({
  mode: "single-route",
  cors: true,
  runtime,
  basePath: "/api/copilotkit-learning",
});

export const POST = app;
