import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { DESIGN_GUIDE } from "../../../lib/design-guide";
import { agentRouteHooks } from "../../../lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "[copilotkit] OPENAI_API_KEY is not set. Chat turns will fail until you set it.",
  );
}

// The built-in agent needs no generative UI setup. With the markdown
// transport the provider sends the standard component schema and the fence
// guideline as context. With the tool transport the runtime gives the agent
// the render_ui tool. The prompt names no transport, so both work; its only
// addition is DESIGN_GUIDE, which tells the model how to arrange the
// components (stat tiles side by side, nothing stretched full width).
//
// "openai/<model>" goes through the OpenAI Responses API, so tools work with
// reasoning on. A low effort keeps replies fast; OPENAI_REASONING_EFFORT
// changes it.
const builtIn = new BuiltInAgent({
  model: process.env.COPILOTKIT_MODEL ?? "openai/gpt-5.6-sol",
  prompt: `You are a helpful assistant in a public demo of CopilotKit's standard generative UI components. When a visual, interactive answer helps, render it with generative UI as described in your context. Keep the text around a surface short.

${DESIGN_GUIDE}`,
  maxOutputTokens: 16_000,
  providerOptions: {
    openai: { reasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? "low" },
  },
});

// generativeUI: true gives every tool-transport run the render_ui tool. A
// markdown-transport run never gets it: the model writes ```a2ui fences.
const copilotRuntime = new CopilotRuntime({
  agents: { default: builtIn },
  runner: new InMemoryAgentRunner(),
  generativeUI: true,
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
  hooks: agentRouteHooks(),
});

export const GET = handler;
export const POST = handler;
