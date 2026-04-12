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

describe("Provider ID collision (#3410, #3623)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should replace text-start providedId "txt-0" with a UUID', async () => {
    const agent = new BuiltInAgent({ model: "openai:gpt-4o-mini" });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([
        { type: "text-start", id: "txt-0" },
        textDelta("Hello"),
        finish(),
      ]) as any,
    );

    const input: RunAgentInput = {
      threadId: "thread-1",
      runId: "run-1",
      messages: [{ id: "1", role: "user", content: "Hi" }],
      tools: [],
      context: [],
      state: {},
    };

    const events = await collectEvents(agent["run"](input));

    // Find the TEXT_MESSAGE_CHUNK event and check its messageId
    const textChunks = events.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textChunks.length).toBeGreaterThan(0);
    const messageId = (textChunks[0] as any).messageId;

    // The messageId should NOT be "txt-0" — it should be a UUID
    expect(messageId).not.toBe("txt-0");
    // UUID v4 pattern
    expect(messageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should replace reasoning-start providedId "reasoning-0" with a UUID', async () => {
    const agent = new BuiltInAgent({ model: "openai:gpt-4o-mini" });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([
        { type: "reasoning-start", id: "reasoning-0" },
        { type: "reasoning-delta", text: "Thinking..." },
        { type: "reasoning-end" },
        { type: "text-start", id: "txt-0" },
        textDelta("Answer"),
        finish(),
      ]) as any,
    );

    const input: RunAgentInput = {
      threadId: "thread-2",
      runId: "run-2",
      messages: [{ id: "1", role: "user", content: "Hi" }],
      tools: [],
      context: [],
      state: {},
    };

    const events = await collectEvents(agent["run"](input));

    // Find REASONING_START event
    const reasoningStarts = events.filter(
      (e) => e.type === EventType.REASONING_START,
    );
    expect(reasoningStarts.length).toBeGreaterThan(0);
    const reasoningId = (reasoningStarts[0] as any).messageId;

    // Should NOT be "reasoning-0"
    expect(reasoningId).not.toBe("reasoning-0");
    expect(reasoningId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should replace providedId "msg-0" with a UUID', async () => {
    const agent = new BuiltInAgent({ model: "openai:gpt-4o-mini" });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([
        { type: "text-start", id: "msg-0" },
        textDelta("Hello"),
        finish(),
      ]) as any,
    );

    const input: RunAgentInput = {
      threadId: "thread-3",
      runId: "run-3",
      messages: [{ id: "1", role: "user", content: "Hi" }],
      tools: [],
      context: [],
      state: {},
    };

    const events = await collectEvents(agent["run"](input));

    const textChunks = events.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textChunks.length).toBeGreaterThan(0);
    const messageId = (textChunks[0] as any).messageId;

    expect(messageId).not.toBe("msg-0");
    expect(messageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("should preserve legitimate provider IDs", async () => {
    const agent = new BuiltInAgent({ model: "openai:gpt-4o-mini" });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([
        { type: "text-start", id: "custom-msg-id-123" },
        textDelta("Hello"),
        finish(),
      ]) as any,
    );

    const input: RunAgentInput = {
      threadId: "thread-4",
      runId: "run-4",
      messages: [{ id: "1", role: "user", content: "Hi" }],
      tools: [],
      context: [],
      state: {},
    };

    const events = await collectEvents(agent["run"](input));

    const textChunks = events.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textChunks.length).toBeGreaterThan(0);
    // Legitimate IDs should be preserved
    expect((textChunks[0] as any).messageId).toBe("custom-msg-id-123");
  });
});
