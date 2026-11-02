import { Hono } from "hono";
import { serve } from "@hono/node-server";
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

const app = new Hono();

// Root
app.get("/", (c) =>
  c.json({ status: "ok", message: "CopilotKit Hono runtime" }),
);

// Health check
app.get("/health", (c) => c.json({ status: "healthy" }));

// CopilotKit endpoints
const handler = createCopilotRuntimeHandler({
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
