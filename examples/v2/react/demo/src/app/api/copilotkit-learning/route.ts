import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotEndpointSingleRoute,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { ScriptedDealAgent } from "@/lib/scripted-deal-agent";

// The learning demo needs the same steps on every run, so it uses a scripted agent and no LLM key.
const runtime = new CopilotRuntime({
  agents: { default: new ScriptedDealAgent() },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpointSingleRoute({
  runtime,
  basePath: "/api/copilotkit-learning",
});

export const POST = handle(app);
