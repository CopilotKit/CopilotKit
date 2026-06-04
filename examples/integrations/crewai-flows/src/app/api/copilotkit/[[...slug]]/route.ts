import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { handle } from "hono/vercel";

// 1. Create the CopilotRuntime instance and utilize the HttpAgent AG-UI
//    integration to setup the connection.
const runtime = new CopilotRuntime({
  agents: {
    sample_agent: new HttpAgent({ url: "http://localhost:8000/" }),
  },
  runner: new InMemoryAgentRunner(),
});

// 2. Build a Hono app that handles the CopilotKit runtime requests.
const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
