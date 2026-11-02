import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "[copilotkit] OPENAI_API_KEY is not set. Chat turns will fail until you set it in .env.local and restart the dev server.",
  );
}

// The built-in agent needs no generative UI setup. With the markdown
// transport the provider sends the component schema and the fence guideline
// as context. With the tool transport the runtime gives the agent the
// render_ui tool. The prompt stays neutral so both transports work.
const builtIn = new BuiltInAgent({
  model: process.env.COPILOTKIT_MODEL ?? "openai/gpt-5.4",
  prompt:
    "You are a helpful assistant. When a visual, interactive answer helps, render it with generative UI as described in your context.",
});

// generativeUI: true gives every tool-transport run the render_ui tool. A
// markdown-transport run never gets it: the model writes ```a2ui fences.
const runtime = new CopilotRuntime({
  agents: { default: builtIn },
  runner: new InMemoryAgentRunner(),
  generativeUI: true,
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
