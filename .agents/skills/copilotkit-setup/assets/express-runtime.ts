// File: src/index.ts
// Standalone Express server with CopilotKit runtime (single-route)
//
// Prerequisites:
//   npm install @copilotkit/runtime @copilotkit/agent express dotenv zod
//   npm install -D @types/express tsx typescript
//
// Environment variables:
//   OPENAI_API_KEY=sk-...  (or ANTHROPIC_API_KEY / GOOGLE_API_KEY)
//   PORT=4000              (optional, defaults to 4000)
//
// Run:
//   npx tsx watch src/index.ts

import express from "express";
import dotenv from "dotenv";
import { z } from "zod";
import { CopilotRuntime } from "@copilotkit/runtime";
import { createCopilotEndpointSingleRouteExpress } from "@copilotkit/runtime/express";
import { BuiltInAgent, defineTool } from "@copilotkit/agent";
import type { ToolDefinition } from "@copilotkit/agent";

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
}) as unknown as ToolDefinition;

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: "You are a helpful AI assistant.",
  tools: [weatherTool],
});

const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
});

const app = express();

app.use(
  "/api/copilotkit",
  createCopilotEndpointSingleRouteExpress({
    runtime,
    basePath: "/",
  }),
);

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(
    `CopilotKit runtime listening at http://localhost:${port}/api/copilotkit`,
  );
});
