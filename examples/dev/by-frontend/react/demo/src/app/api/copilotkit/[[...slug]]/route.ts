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
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-6-luna";

const determineOpenRouterModelId = () => {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
};

const prompt =
  "You are a helpful AI assistant. Use reasoning to answer the user's question. If you don't know the answer, say you don't know.";

// The agent runs on the first provider that has an API key. The models that
// reason think at the "high" level and stream a summary of their reasoning.
const createBuiltInAgent = () => {
  if (openRouterApiKey) {
    return new BuiltInAgent({
      model: openaiCompatibleText(determineOpenRouterModelId(), {
        name: "openrouter",
        api: "chat-completions",
        apiKey: openRouterApiKey,
        baseURL: process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL,
      }),
      prompt,
    });
  }
  if (openAIApiKey) {
    return new BuiltInAgent({
      model: openaiText("gpt-6-luna"),
      prompt,
      reasoning: { level: "high", summary: true },
    });
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    // Claude Opus 4.8 reasons with adaptive thinking.
    return new BuiltInAgent({
      model: anthropicText("claude-opus-4-8"),
      prompt,
      reasoning: { level: "high", summary: true },
    });
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return new BuiltInAgent({ model: geminiText("gemini-3.8-flash"), prompt });
  }
  // No key found: the OpenAI adapter throws an error that names OPENAI_API_KEY.
  return new BuiltInAgent({ model: openaiText("gpt-6-luna"), prompt });
};

const builtInAgent = createBuiltInAgent();

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
