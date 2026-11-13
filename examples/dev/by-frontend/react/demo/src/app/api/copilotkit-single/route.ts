import {
  CopilotKitRuntime,
  InMemoryAgentRunner,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { anthropicText } from "@tanstack/ai-anthropic";
import { geminiText } from "@tanstack/ai-gemini";
import { openaiText } from "@tanstack/ai-openai";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const determineModel = () => {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return openaiText("gpt-6-luna");
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return anthropicText("claude-sonnet-4-6");
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return geminiText("gemini-3.8-flash");
  }
  // No key found: the OpenAI adapter throws an error that names OPENAI_API_KEY.
  return openaiText("gpt-6-luna");
};

const agent = new BuiltInAgent({
  model: determineModel(),
  prompt: "You are a helpful AI assistant.",
});

// Set up transcription service if OpenAI API key is available
const transcriptionService = process.env.OPENAI_API_KEY?.trim()
  ? new TranscriptionServiceOpenAI({
      openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    })
  : undefined;

const singleRuntime = new CopilotKitRuntime({
  agents: {
    default: agent,
  },
  runner: new InMemoryAgentRunner(),
  transcriptionService,
});

const app = createCopilotKitRuntimeHandler({
  mode: "single-route",
  cors: true,
  runtime: singleRuntime,
  basePath: "/api/copilotkit-single",
});

export const POST = app;
