import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { MastraAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";
import { handle } from "hono/vercel";

const runtime = new CopilotRuntime({
  // @ts-expect-error - ignore for now, typing error
  agents: MastraAgent.getLocalAgents({ mastra }),
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
