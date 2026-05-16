/**
 * CopilotKit API route for Open Generative UI agent.
 *
 * Uses BuiltInAgent with OpenGenerativeUIMiddleware enabled via the
 * runtime's openGenerativeUI option.
 */

import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";

const MODEL = "openai/gpt-5.2";
export const maxDuration = 300; // 5 minutes timeout for long UI generations

const agent = new BuiltInAgent({
  model: MODEL,
  prompt: `You are a world-class UI engineer. 
When asked for a UI, use generateSandboxedUi to build it using Tailwind CSS (via CDN) and Chart.js.
Keep it simple, clean, and fast to generate. One main view only.
After calling generateSandboxedUi, stop immediately.`,
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
  runner: new InMemoryAgentRunner(),
  openGenerativeUI: true,
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit-opengenui",
});

export const GET = handle(app);
export const POST = handle(app);
