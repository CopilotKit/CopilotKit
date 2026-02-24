import { Elysia } from "elysia";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({ model: "openai/gpt-5-mini" }),
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
