import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";
import type { BuiltInAgentClassicConfig } from "@copilotkit/runtime/v2";
import { createOpenAI } from "@ai-sdk/openai";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import { handle } from "hono/vercel";
import OpenAI from "openai";

const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";

const determineOpenRouterModelId = () => {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
};

const determineModel = (): BuiltInAgentClassicConfig["model"] => {
  if (openRouterApiKey) {
    const openrouter = createOpenAI({
      apiKey: openRouterApiKey,
      baseURL: process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL,
    });

    return openrouter(determineOpenRouterModelId());
  }
  if (openAIApiKey) {
    return "openai/gpt-5.2";
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    // claude-3-7-sonnet supports extended thinking
    return "anthropic/claude-3-7-sonnet-20250219";
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return "google/gemini-2.5-pro";
  }
  return "openai/gpt-5.2";
};

const builtInAgent = new BuiltInAgent({
  model: determineModel(),
  prompt:
    "You are a helpful AI assistant. Use reasoning to answer the user's question. If you don't know the answer, say you don't know.",
  providerOptions: {
    ...(openAIApiKey
      ? { openai: { reasoningEffort: "high", reasoningSummary: "detailed" } }
      : {}),
    ...(!openAIApiKey &&
      !openRouterApiKey &&
      !!process.env.ANTHROPIC_API_KEY?.trim() && {
        anthropic: { thinking: { type: "enabled", budgetTokens: 5000 } },
      }),
  },
});

// Set up transcription service if OpenAI API key is available
const transcriptionService = openAIApiKey
  ? new TranscriptionServiceOpenAI({
      openai: new OpenAI({ apiKey: openAIApiKey }),
    })
  : undefined;

const honoRuntime = new CopilotRuntime({
  agents: {
    default: builtInAgent,
  },
  runner: new InMemoryAgentRunner(),
  transcriptionService,
  a2ui: {},
  openGenerativeUI: true,
});

const app = createCopilotEndpoint({
  runtime: honoRuntime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
