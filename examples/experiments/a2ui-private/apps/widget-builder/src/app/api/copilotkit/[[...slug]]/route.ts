import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
  BasicAgent,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { A2UI_SYSTEM_PROMPT } from "../a2ui-prompt";

const determineModel = () => {
  if (process.env.GEMINI_API_KEY?.trim()) {
    return "google/gemini-2.5-flash";
  }
  if (process.env.OPENAI_API_KEY?.trim()) {
    console.warn(
      "[CopilotKit] GOOGLE_GENERATIVE_AI_API_KEY not found, falling back to OpenAI",
    );
    return "openai/gpt-4.1-mini";
  }
  console.warn("[CopilotKit] No GEMINI_API_KEY or OPENAI_API_KEY found");
  return "google/gemini-2.5-flash";
};

const agent = new BasicAgent({
  model: determineModel(),
  prompt: A2UI_SYSTEM_PROMPT,
  temperature: 0.7,
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
