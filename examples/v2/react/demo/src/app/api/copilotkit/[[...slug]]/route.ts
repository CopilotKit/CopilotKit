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
    // Claude Opus 4.8 supports adaptive thinking
    return "anthropic/claude-opus-4-8";
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return "google/gemini-2.5-pro";
  }
  return "openai/gpt-5.2";
};

const builtInAgent = new BuiltInAgent({
  model: determineModel(),
  prompt: `You are a helpful AI assistant for a CopilotKit Inspector demo.

Use the available frontend tools when the user requests one of these demos:
- For an intentional failed tool call, call failDemoTool with a concise reason.
- For a chart or generative UI, call showDemoChart with three or four labeled values between 0 and 100.
- For an approval or human-in-the-loop request, call requestDemoApproval with the action that needs approval.
- For a theme request, call setTheme.

After a demo tool call, briefly tell the user they can open the CopilotKit Inspector from the tool call to inspect it. Do not call demo tools unless the user asks for the corresponding demo.`,
  providerOptions: {
    ...(openAIApiKey
      ? { openai: { reasoningEffort: "high", reasoningSummary: "detailed" } }
      : {}),
    ...(!openAIApiKey &&
      !openRouterApiKey &&
      !!process.env.ANTHROPIC_API_KEY?.trim() && {
        anthropic: { thinking: { type: "adaptive" } },
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
