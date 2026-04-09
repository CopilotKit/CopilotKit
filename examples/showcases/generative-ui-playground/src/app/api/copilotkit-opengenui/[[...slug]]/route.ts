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
} from "@copilotkitnext/runtime";
import { handle } from "hono/vercel";
import { BuiltInAgent } from "@copilotkitnext/agent";

const MODEL = "openai/gpt-5.2";

const agent = new BuiltInAgent({
  model: MODEL,
  prompt: `You are an AI assistant that builds interactive UIs on demand.

When the user asks for any visual or interactive element, use the generateSandboxedUi tool to create it.
You can use CDN libraries like Chart.js, D3.js, Three.js, or x-data-spreadsheet to build rich UIs.

Be creative and build polished, well-styled interfaces. Always include proper CSS styling.`,
  temperature: 0.7,
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
