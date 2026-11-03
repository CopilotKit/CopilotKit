import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { openaiText } from "@tanstack/ai-openai";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";

const runtime = new CopilotRuntime({
  agents: {
    default: tanstackAIAgent({ adapter: () => openaiText("gpt-5-mini") }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  cors: true,
});

const port = Number(Deno.env.get("PORT") ?? "4005");
Deno.serve({ port }, handler);
console.log(
  `Deno runtime listening on http://localhost:${port}/api/copilotkit`,
);
