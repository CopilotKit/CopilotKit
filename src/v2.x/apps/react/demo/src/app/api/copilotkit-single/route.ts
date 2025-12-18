import { CopilotRuntime, InMemoryAgentRunner, createCopilotEndpointSingleRoute } from "@copilotkitnext/runtime";
import { handle } from "hono/vercel";
import { BasicAgent } from "@copilotkitnext/agent";

const determineModel = () => {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai/gpt-4o";
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return "anthropic/claude-sonnet-4.5";
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return "google/gemini-2.5-pro";
  }
  return "openai/gpt-4o";
};

const agent = new BasicAgent({
  model: determineModel(),
  prompt: "You are a helpful AI assistant.",
  temperature: 0.7,
});

const singleRuntime = new CopilotRuntime({
  agents: {
    default: agent,
  },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpointSingleRoute({
  runtime: singleRuntime,
  basePath: "/api/copilotkit-single",
});

export const POST = handle(app);
