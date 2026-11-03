import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { anthropicText } from "@tanstack/ai-anthropic";
import { geminiText } from "@tanstack/ai-gemini";
import { openaiText } from "@tanstack/ai-openai";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const determineAdapter = () => {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return openaiText("gpt-5-mini");
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return anthropicText("claude-sonnet-4-6");
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return geminiText("gemini-3.8-flash");
  }
  return openaiText("gpt-5-mini");
};

const agent = tanstackAIAgent({
  adapter: determineAdapter,
  prompt: "You are a helpful AI assistant.",
  modelOptions: { temperature: 0.7 },
});

// Set up transcription service if OpenAI API key is available
const transcriptionService = process.env.OPENAI_API_KEY?.trim()
  ? new TranscriptionServiceOpenAI({
      openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    })
  : undefined;

const singleRuntime = new CopilotRuntime({
  agents: {
    default: agent,
  },
  runner: new InMemoryAgentRunner(),
  transcriptionService,
});

const app = createCopilotRuntimeHandler({
  mode: "single-route",
  cors: true,
  runtime: singleRuntime,
  basePath: "/api/copilotkit-single",
});

export const POST = app;
