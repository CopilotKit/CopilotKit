import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { CopilotKitRuntime } from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiText } from "@tanstack/ai-openai";
import { createCopilotKitRuntimeHandler } from "@copilotkit/runtime";

const runtime = new CopilotKitRuntime({
  agents: {
    default: new BuiltInAgent({ model: openaiText("gpt-6-luna") }),
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
const handler = createCopilotKitRuntimeHandler({
  cors: true,
  runtime,
  basePath: "/api/copilotkit",
});
app.all("/api/copilotkit/*", (c) => handler(c.req.raw));

const port = Number(process.env.PORT ?? 4003);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Hono runtime listening on http://localhost:${port}`);
  console.log(`  CopilotKit: http://localhost:${port}/api/copilotkit`);
});
