import { serve } from "@hono/node-server";
import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import {
  OpenAIAgent,
  SlowToolCallStreamingAgent,
} from "@copilotkit/demo-agents";

const runtime = new CopilotRuntime({
  agents: {
    // @ts-ignore
    default: new SlowToolCallStreamingAgent(),
    // @ts-ignore
    openai: new OpenAIAgent(),
  },
  runner: new InMemoryAgentRunner(),
});

// Create the CopilotKit endpoint with CORS for local dev (Angular demo at http://localhost:4200)
const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
  cors: {
    origin: "http://localhost:4200",
    credentials: true,
  },
});

const port = Number(process.env.PORT || 3001);
serve({ fetch: app.fetch, port });
console.log(
  `CopilotKit runtime listening at http://localhost:${port}/api/copilotkit`,
);
