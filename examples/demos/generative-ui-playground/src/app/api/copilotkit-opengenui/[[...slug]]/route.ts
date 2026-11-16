/**
 * CopilotKit API route for Open Generative UI agent.
 *
 * Uses BuiltInAgent with OpenGenerativeUIMiddleware enabled via the
 * runtime's openGenerativeUI option.
 */

import {
  CopilotKitRuntime,
  createCopilotKitRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiText } from "@tanstack/ai-openai";

const MODEL = openaiText("gpt-6-luna");

const agent = new BuiltInAgent({
  model: MODEL,
  prompt: `You are an AI assistant that builds interactive UIs on demand.

When the user asks for any visual or interactive element, use the generateSandboxedUi tool to create it.
You can use CDN libraries like Chart.js, D3.js, Three.js, or x-data-spreadsheet to build rich UIs.

Be creative and build polished, well-styled interfaces. Always include proper CSS styling.`,
});

const runtime = new CopilotKitRuntime({
  agents: { default: agent },
  runner: new InMemoryAgentRunner(),
  openGenerativeUI: true,
});

const app = createCopilotKitRuntimeHandler({
  cors: true,
  runtime,
  basePath: "/api/copilotkit-opengenui",
});

export const GET = app;
export const POST = app;
