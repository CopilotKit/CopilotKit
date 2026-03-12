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
