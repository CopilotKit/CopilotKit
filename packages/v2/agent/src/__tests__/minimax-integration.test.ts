import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BasicAgent, resolveModel } from "../index";
import { EventType, type RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  mockStreamTextResponse,
  textDelta,
  finish,
  toolCallStreamingStart,
  toolCallDelta,
  toolCall,
  toolResult,
  collectEvents,
} from "./test-helpers";
import { z } from "zod";

// Mock the ai module
vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
}));

// Mock the SDK clients
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "openai",
  })),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "anthropic",
  })),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "google",
  })),
}));

describe("MiniMax Integration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.MINIMAX_API_KEY = "test-minimax-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should handle MiniMax agent with tool calls", async () => {
    const agent = new BasicAgent({
      model: "minimax/MiniMax-M2.7",
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([
        toolCallStreamingStart("call1", "searchTool"),
        toolCallDelta("call1", '{"query":"test"}'),
        toolCall("call1", "searchTool", { query: "test" }),
        toolResult("call1", "searchTool", { results: ["item1"] }),
        textDelta("Found results."),
        finish(),
      ]) as any,
    );

    const input: RunAgentInput = {
      threadId: "thread1",
      runId: "run1",
      messages: [{ id: "1", role: "user", content: "Search for test" }],
      tools: [],
      context: [],
      state: {},
    };

    const events = await collectEvents(agent["run"](input));

    const eventTypes = events.map((e: any) => e.type);
    expect(eventTypes).toContain(EventType.RUN_STARTED);
    expect(eventTypes).toContain(EventType.TOOL_CALL_START);
    expect(eventTypes).toContain(EventType.TOOL_CALL_END);
    expect(eventTypes).toContain(EventType.TEXT_MESSAGE_CHUNK);
    expect(eventTypes).toContain(EventType.RUN_FINISHED);
  });

  it("should handle multi-turn conversation with MiniMax", async () => {
    const agent = new BasicAgent({
      model: "minimax/MiniMax-M2.7",
      prompt: "You are a helpful assistant powered by MiniMax.",
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([
        textDelta("I understand your question."),
        textDelta(" Here is my answer."),
        finish(),
      ]) as any,
    );

    const input: RunAgentInput = {
      threadId: "thread1",
      runId: "run1",
      messages: [
        { id: "1", role: "user", content: "Hello" },
        { id: "2", role: "assistant", content: "Hi there!" },
        { id: "3", role: "user", content: "What can you do?" },
      ],
      tools: [],
      context: [{ description: "User preference", value: "concise answers" }],
      state: { conversationCount: 2 },
    };

    const events = await collectEvents(agent["run"](input));

    // Verify model was resolved with MiniMax config
    expect(createOpenAI).toHaveBeenCalledWith({
      baseURL: "https://api.minimax.io/v1",
      apiKey: "test-minimax-key",
      compatibility: "compatible",
    });

    // Verify messages include system prompt, context, and state
    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    const systemMessage = callArgs.messages[0];
    expect(systemMessage.role).toBe("system");
    expect(systemMessage.content).toContain(
      "You are a helpful assistant powered by MiniMax.",
    );
    expect(systemMessage.content).toContain("User preference");
    expect(systemMessage.content).toContain("conversationCount");

    // Verify text events
    const textEvents = events.filter(
      (e: any) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textEvents).toHaveLength(2);
  });

  it("should work alongside other providers without interference", async () => {
    // Resolve MiniMax model
    const minimaxModel = resolveModel("minimax/MiniMax-M2.7");
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://api.minimax.io/v1",
        compatibility: "compatible",
      }),
    );

    vi.clearAllMocks();

    // Resolve OpenAI model - should not use MiniMax config
    const openaiModel = resolveModel("openai/gpt-4o");
    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: "test-openai-key",
    });
  });
});
