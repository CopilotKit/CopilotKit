import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
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

const determineAdapter = () => {
  if (openRouterApiKey) {
    return openaiCompatibleText(determineOpenRouterModelId(), {
      name: "openrouter",
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
  return openaiText("gpt-5.2");
};

const builtInAgent = tanstackAIAgent({
  adapter: determineAdapter(),
  prompt:
    "You are a helpful AI assistant. Use reasoning to answer the user's question. If you don't know the answer, say you don't know.",
  // Think hard and stream the reasoning summary. TanStack AI maps the level
  // to each provider's own reasoning setting. OpenRouter models get none.
  ...(!openRouterApiKey && { reasoning: "high" }),
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
