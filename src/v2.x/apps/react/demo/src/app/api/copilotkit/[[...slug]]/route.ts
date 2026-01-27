import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkitnext/runtime";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import { handle } from "hono/vercel";
import { BasicAgent } from "@copilotkitnext/agent";
import OpenAI from "openai";

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

// Set up transcription service if OpenAI API key is available
const transcriptionService = process.env.OPENAI_API_KEY?.trim()
  ? new TranscriptionServiceOpenAI({
      openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    })
  : undefined;

const honoRuntime = new CopilotRuntime({
  agents: {
    default: agent,
  },
  runner: new InMemoryAgentRunner(),
  transcriptionService,
});

const app = createCopilotEndpoint({
  runtime: honoRuntime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
