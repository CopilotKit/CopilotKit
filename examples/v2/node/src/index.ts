import {
  CopilotRuntime,
  createCopilotEndpoint,
  VERSION,
  BasicAgent,
} from "@copilotkit/runtime/v2";
import { serve } from "@hono/node-server";

// Example: Creating a runtime instance
// Note: BasicAgent is used here to verify the import works
// In practice, agents would be passed with proper AbstractAgent interface
const runtime = new CopilotRuntime({
  agents: {
    default: new BasicAgent({
      model: "openai/gpt-4o-mini",
      maxSteps: 5,
      temperature: 0.7,
    }),
  },
});

const endpoint = createCopilotEndpoint({
  basePath: "/api/copilotkit",
  runtime,
});

serve({
  fetch: endpoint.fetch,
  port: 8787,
});
