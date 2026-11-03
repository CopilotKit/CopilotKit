import { Elysia } from "elysia";
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

const handler = createCopilotRuntimeHandler({ runtime, cors: true });

const port = Number(process.env.PORT ?? 4004);
new Elysia()
  .all("/api/copilotkit/*", ({ request }) => handler(request))
  .listen(port);

console.log(
  `Elysia runtime listening on http://localhost:${port}/api/copilotkit`,
);
