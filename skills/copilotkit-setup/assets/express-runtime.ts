// File: src/index.ts
// Standalone Express server with CopilotKit runtime (single-route)
//
// Frontend pairing: because this server is single-route AND cross-origin,
// the provider must use useSingleEndpoint (true) and an absolute runtimeUrl,
// e.g. <CopilotKit runtimeUrl="http://localhost:4000/api/copilotkit"
// useSingleEndpoint>. The nextjs-app-router-page.tsx asset is for the
// same-origin multi-route Hono route (useSingleEndpoint={false}) and does
// NOT pair with this server.
//
// Prerequisites:
//   npm install @copilotkit/runtime express dotenv zod
//   npm install -D @types/express tsx typescript
//
// Environment variables (store secrets in env, never hardcode them):
//   OPENAI_API_KEY=<your-api-key>  (or ANTHROPIC_API_KEY / GOOGLE_API_KEY)
//   PORT=4000                      (optional, defaults to 4000)
//
// Run:
//   npx tsx watch src/index.ts

import express from "express";
import dotenv from "dotenv";
import { z } from "zod";
import {
  CopilotRuntime,
  BuiltInAgent,
  defineTool,
} from "@copilotkit/runtime/v2";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";

dotenv.config();

// Example server-side tool
const weatherTool = defineTool({
  name: "getWeather",
  description: "Get the current weather for a city",
  parameters: z.object({
    city: z.string().describe("The city name"),
  }),
  execute: async ({ city }) => {
    // Replace with real weather API call
    return { city, temperature: 72, condition: "sunny" };
  },
});

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: "You are a helpful AI assistant.",
  tools: [weatherTool],
  // Allow multiple steps so the agent can call the tool and then use the
  // result to answer. Without maxSteps the agent stops after a single step
  // (the underlying AI SDK default), emitting the tool call but never
  // producing a final reply.
  maxSteps: 5,
});

const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
});

const app = express();

app.use(
  "/api/copilotkit",
  createCopilotExpressHandler({
    runtime,
    basePath: "/",
    mode: "single-route",
  }),
);

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(
    `CopilotKit runtime listening at http://localhost:${port}/api/copilotkit`,
  );
});
