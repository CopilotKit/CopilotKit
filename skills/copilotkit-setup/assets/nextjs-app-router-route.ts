// File: src/app/api/copilotkit/[[...slug]]/route.ts
// Next.js App Router + Hono multi-route endpoint
//
// Prerequisites:
//   npm install @copilotkit/runtime hono
//
// Environment variables (store secrets in env, never hardcode them):
//   OPENAI_API_KEY=<your-api-key>  (or ANTHROPIC_API_KEY / GOOGLE_API_KEY)

import {
  CopilotRuntime,
  createCopilotHonoHandler,
  InMemoryAgentRunner,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";
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

const app = createCopilotHonoHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
// PATCH/DELETE back thread operations (useThreads); harmless for the
// BuiltInAgent demo, required once you enable Intelligence/threads.
export const PATCH = handle(app);
export const DELETE = handle(app);
