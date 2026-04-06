import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { CopilotRuntime, BuiltInAgent } from "@copilotkit/runtime/v2";
import { createCopilotHonoHandler } from "@copilotkit/runtime/v2/hono";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({ model: "openai/gpt-5-mini" }),
  },
});

const app = new Hono();

// Root
app.get("/", (c) =>
  c.json({ status: "ok", message: "CopilotKit Hono runtime" }),
);

// Health check
app.get("/health", (c) => c.json({ status: "healthy" }));

// CopilotKit endpoints
app.route(
  "/",
  createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" }),
);

const port = Number(process.env.PORT ?? 4003);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Hono runtime listening on http://localhost:${port}`);
  console.log(`  CopilotKit: http://localhost:${port}/api/copilotkit`);
});
