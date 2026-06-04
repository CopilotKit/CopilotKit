import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { LlamaIndexAgent } from "@ag-ui/llamaindex";
import { handle } from "hono/vercel";

const runtime = new CopilotRuntime({
  agents: {
    sample_agent: new LlamaIndexAgent({
      url: (process.env.AGENT_URL || "http://127.0.0.1:9000") + "/run",
    }),
  },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
