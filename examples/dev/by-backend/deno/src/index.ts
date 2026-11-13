import {
  CopilotKitRuntime,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiText } from "@tanstack/ai-openai";

const runtime = new CopilotKitRuntime({
  agents: {
    default: new BuiltInAgent({ model: openaiText("gpt-6-luna") }),
  },
});

const handler = createCopilotKitRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  cors: true,
});

const port = Number(Deno.env.get("PORT") ?? "4005");
Deno.serve({ port }, handler);
console.log(
  `Deno runtime listening on http://localhost:${port}/api/copilotkit`,
);
