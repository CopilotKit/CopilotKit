import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BuiltInAgent } from "../index";
import { EventType, type RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import {
  mockStreamTextResponse,
  textDelta,
  finish,
  collectEvents,
} from "./test-helpers";

// Mock the ai module
vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
  stepCountIs: vi.fn((count: number) => ({ type: "stepCount", count })),
}));

// Mock SDK providers (not used directly, but resolveModel imports them)
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    specificationVersion: "v3",
    modelId,
    provider: "openai",
  })),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => (modelId: string) => ({
    specificationVersion: "v3",
    modelId,
    provider: "anthropic",
  })),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => (modelId: string) => ({
    specificationVersion: "v3",
    modelId,
    provider: "google",
  })),
}));

describe("AI SDK v6 Compatibility", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should accept a LanguageModelV3 instance (specificationVersion 'v3')", async () => {
    // Simulate what @ai-sdk/openai@^3 (AI SDK v6) returns:
    // a model object with specificationVersion: "v3"
    const v3Model = {
      specificationVersion: "v3" as const,
      modelId: "gpt-4o-mini",
      provider: "openai",
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream: vi.fn(),
    };

    // After upgrading to ai@^6, LanguageModel = string | LanguageModelV2 | LanguageModelV3.
    // No 'as any' cast needed — the type accepts V3 models natively.
    const agent = new BuiltInAgent({
      model: v3Model,
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([
        textDelta("Hello from V3 model"),
        finish(),
      ]) as any,
    );

    const input: RunAgentInput = {
      threadId: "thread-v3",
      runId: "run-v3",
      messages: [{ id: "1", role: "user", content: "Hi" }],
      tools: [],
      context: [],
      state: {},
    };

    const events = await collectEvents(agent["run"](input));

    // Verify the model was passed through to streamText
    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.model).toBe(v3Model);

    // Verify normal event emission still works
    expect(events[0]).toMatchObject({
      type: EventType.RUN_STARTED,
      threadId: "thread-v3",
      runId: "run-v3",
    });

    const textEvents = events.filter(
      (e: any) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0]).toMatchObject({
      delta: "Hello from V3 model",
    });

    expect(events[events.length - 1]).toMatchObject({
      type: EventType.RUN_FINISHED,
    });
  });
});
