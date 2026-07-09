import {
  CopilotRuntime,
  createCopilotHonoHandler,
  InMemoryAgentRunner,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";

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

const builtInAgent = new BuiltInAgent({
  model: determineModel(),
  prompt: "You are a helpful AI assistant.",
});

const honoRuntime = new CopilotRuntime({
  agents: { default: builtInAgent },
  runner: new InMemoryAgentRunner(),
});

export const app = createCopilotHonoHandler({
  runtime: honoRuntime,
  basePath: "/api/copilotkit",
});
