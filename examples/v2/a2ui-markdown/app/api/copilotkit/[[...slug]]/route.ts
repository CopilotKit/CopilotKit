import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "[copilotkit] OPENAI_API_KEY is not set. Chat turns will fail until you set it in .env.local and restart the dev server.",
  );
}

// The built-in agent needs no A2UI-specific setup. In markdown mode the
// provider sends the catalog schema and the fence guideline as context; in
// tool mode the runtime injects the render_a2ui tool because the provider
// forwards a catalog. The prompt stays neutral so both modes work.
const builtIn = new BuiltInAgent({
  model: process.env.COPILOTKIT_MODEL ?? "openai/gpt-5.4",
  prompt:
    "You are a helpful assistant. When a visual, interactive answer helps, render it with A2UI as described in your context.",
});

// The LangGraph Python agent in ./agent (uv run main.py).
const langgraph = new LangGraphHttpAgent({
  url: process.env.LANGGRAPH_AGENT_URL ?? "http://localhost:8011/copilotkit",
});

const runtime = new CopilotRuntime({
  agents: { default: builtIn, langgraph },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
