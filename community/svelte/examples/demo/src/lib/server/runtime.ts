import {
  CopilotRuntime,
  createCopilotHonoHandler,
  InMemoryAgentRunner,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";

const determineModel = () => {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai/gpt-6-luna";
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return "anthropic/claude-haiku-4-5";
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return "google/gemini-3.8-flash";
  }
  return "openai/gpt-6-luna";
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
