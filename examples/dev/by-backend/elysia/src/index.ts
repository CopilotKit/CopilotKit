import { Elysia } from "elysia";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiText } from "@tanstack/ai-openai";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({ model: openaiText("gpt-6-luna") }),
  },
});

const handler = createCopilotRuntimeHandler({ runtime, cors: true });

const port = Number(process.env.PORT ?? 4004);
new Elysia()
  .all("/api/copilotkit/*", ({ request }) => handler(request))
  .listen(port);

console.log(
  `Elysia runtime listening on http://localhost:${port}/api/copilotkit`,
);
