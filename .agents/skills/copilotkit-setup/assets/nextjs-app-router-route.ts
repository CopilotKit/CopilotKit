// File: src/app/api/copilotkit/[[...slug]]/route.ts
// Next.js App Router + Hono multi-route endpoint
//
// Prerequisites:
//   npm install @copilotkit/runtime @copilotkit/agent hono
//
// Environment variables:
//   OPENAI_API_KEY=sk-...  (or ANTHROPIC_API_KEY / GOOGLE_API_KEY)

import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/agent";
import { handle } from "hono/vercel";

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: "You are a helpful AI assistant.",
});

const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
