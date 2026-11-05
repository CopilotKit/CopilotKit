import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { anthropicText } from "@tanstack/ai-anthropic";
import { geminiText } from "@tanstack/ai-gemini";
import { openaiText } from "@tanstack/ai-openai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5-mini";

const determineOpenRouterModelId = () => {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
};

const determineModel = () => {
  if (openRouterApiKey) {
    return openaiCompatibleText(determineOpenRouterModelId(), {
      name: "openrouter",
      api: "chat-completions",
      apiKey: openRouterApiKey,
      baseURL: process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL,
    });
  }
  if (openAIApiKey) {
    return openaiText("gpt-5.2");
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    // Claude Opus 4.8 supports adaptive thinking
    return anthropicText("claude-opus-4-8");
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return geminiText("gemini-3.8-flash");
  }
  // No key found: the OpenAI adapter throws an error that names OPENAI_API_KEY.
  return openaiText("gpt-5.2");
};

// Options for the provider that determineModel picked, in that provider's
// own request format.
const determineModelOptions = () => {
  if (openRouterApiKey) return undefined;
  if (openAIApiKey)
    return { reasoning: { effort: "high", summary: "detailed" } };
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { thinking: { type: "adaptive" } };
  }
  return undefined;
};

const builtInAgent = new BuiltInAgent({
  model: determineModel(),
  prompt:
    "You are a helpful AI assistant. Use reasoning to answer the user's question. If you don't know the answer, say you don't know.",
  modelOptions: determineModelOptions(),
});

// Set up transcription service if OpenAI API key is available
const transcriptionService = openAIApiKey
  ? new TranscriptionServiceOpenAI({
      openai: new OpenAI({ apiKey: openAIApiKey }),
    })
  : undefined;

const runtime = new CopilotRuntime({
  agents: {
    default: builtInAgent,
  },
  runner: new InMemoryAgentRunner(),
  transcriptionService,
  a2ui: {},
  openGenerativeUI: true,
});

const app = createCopilotRuntimeHandler({
  cors: true,
  runtime: runtime,
  basePath: "/api/copilotkit",
});

export const GET = app;
export const POST = app;
