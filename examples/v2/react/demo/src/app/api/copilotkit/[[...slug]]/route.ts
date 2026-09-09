import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";
import type { BuiltInAgentClassicConfig } from "@copilotkit/runtime/v2";
import { createOpenAI } from "@ai-sdk/openai";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import { EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { handle } from "hono/vercel";
import OpenAI from "openai";
import { Observable } from "rxjs";

const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.6-terra";
const DEFAULT_OPENAI_MODEL = "openai/gpt-5.6-terra";

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
    return DEFAULT_OPENAI_MODEL;
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    // Claude Opus 4.8 supports adaptive thinking
    return "anthropic/claude-opus-4-8";
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return "google/gemini-2.5-pro";
  }
  return DEFAULT_OPENAI_MODEL;
};

class DemoAgent extends BuiltInAgent {
  private demoConfig: BuiltInAgentClassicConfig;

  constructor(demoConfig: BuiltInAgentClassicConfig) {
    super(demoConfig);
    this.demoConfig = demoConfig;
  }

  override run(input: RunAgentInput) {
    const latestUserMessage = [...input.messages]
      .toReversed()
      .find((message) => message.role === "user");

    if (
      JSON.stringify(latestUserMessage?.content)
        .toLowerCase()
        .includes("agent error")
    ) {
      return new Observable((subscriber) => {
        subscriber.next({
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        });
        subscriber.error(new Error("Intentional agent error for the demo."));
      });
    }

    return super.run(input);
  }

  override clone() {
    return new DemoAgent(this.demoConfig);
  }
}

const builtInAgent = new DemoAgent({
  model: determineModel(),
  prompt: "You are a helpful assistant.",
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
  openGenerativeUI: false,
});

const app = createCopilotEndpoint({
  runtime: honoRuntime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
