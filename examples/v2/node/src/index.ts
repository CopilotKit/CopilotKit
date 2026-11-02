import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  VERSION,
} from "@copilotkit/runtime";
import { openaiText } from "@tanstack/ai-openai";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { serve } from "@hono/node-server";

// Example: Creating a runtime instance
// Note: tanstackAIAgent is used here to verify the import works
// In practice, agents would be passed with proper AbstractAgent interface
const runtime = new CopilotRuntime({
  agents: {
    default: tanstackAIAgent({
      adapter: openaiText("gpt-5-mini"),
      maxIterations: 5,
      modelOptions: { temperature: 0.7 },
    }),
  },
});

const endpoint = createCopilotRuntimeHandler({
  cors: true,
  basePath: "/api/copilotkit",
  runtime,
});

serve({
  fetch: endpoint,
  port: 8787,
});
