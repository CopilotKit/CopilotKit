import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BasicAgent, resolveModel } from "../index";
import { EventType, type RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
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

describe("MiniMax Provider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.MINIMAX_API_KEY = "test-minimax-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("resolveModel", () => {
    it("should resolve minimax/MiniMax-M2.7 model string", () => {
      const model = resolveModel("minimax/MiniMax-M2.7");

      expect(createOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.minimax.io/v1",
        apiKey: "test-minimax-key",
        compatibility: "compatible",
      });
      expect(model).toMatchObject({ modelId: "MiniMax-M2.7" });
    });

    it("should resolve minimax/MiniMax-M2.7-highspeed model string", () => {
      const model = resolveModel("minimax/MiniMax-M2.7-highspeed");

      expect(createOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.minimax.io/v1",
        apiKey: "test-minimax-key",
        compatibility: "compatible",
      });
      expect(model).toMatchObject({ modelId: "MiniMax-M2.7-highspeed" });
    });

    it("should resolve minimax:MiniMax-M2.7 colon format", () => {
      const model = resolveModel("minimax:MiniMax-M2.7");

      expect(createOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.minimax.io/v1",
        apiKey: "test-minimax-key",
        compatibility: "compatible",
      });
      expect(model).toMatchObject({ modelId: "MiniMax-M2.7" });
    });

    it("should use explicit apiKey over env var", () => {
      const model = resolveModel("minimax/MiniMax-M2.7", "explicit-key");

      expect(createOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.minimax.io/v1",
        apiKey: "explicit-key",
        compatibility: "compatible",
      });
    });

    it("should fall back to MINIMAX_API_KEY env var", () => {
      process.env.MINIMAX_API_KEY = "env-minimax-key";
      const model = resolveModel("minimax/MiniMax-M2.7");

      expect(createOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.minimax.io/v1",
        apiKey: "env-minimax-key",
        compatibility: "compatible",
      });
    });

    it("should be case-insensitive for provider name", () => {
      const model = resolveModel("MINIMAX/MiniMax-M2.7");

      expect(createOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.minimax.io/v1",
        apiKey: "test-minimax-key",
        compatibility: "compatible",
      });
    });

    it("should include minimax in unknown provider error", () => {
      expect(() => resolveModel("unknown/model")).toThrow(
        /minimax/,
      );
    });
  });

  describe("BasicAgent with MiniMax", () => {
    it("should create agent with MiniMax M2.7 model", async () => {
      const agent = new BasicAgent({
        model: "minimax/MiniMax-M2.7",
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          textDelta("Hello from MiniMax"),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
      };

      const events = await collectEvents(agent["run"](input));

      expect(events[0]).toMatchObject({
        type: EventType.RUN_STARTED,
        threadId: "thread1",
        runId: "run1",
      });

      const textEvents = events.filter(
        (e: any) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      );
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0]).toMatchObject({
        type: EventType.TEXT_MESSAGE_CHUNK,
        delta: "Hello from MiniMax",
      });

      expect(events[events.length - 1]).toMatchObject({
        type: EventType.RUN_FINISHED,
      });
    });

    it("should create agent with MiniMax M2.7-highspeed model", async () => {
      const agent = new BasicAgent({
        model: "minimax/MiniMax-M2.7-highspeed",
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          textDelta("Fast response"),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
      };

      const events = await collectEvents(agent["run"](input));

      const textEvents = events.filter(
        (e: any) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      );
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0]).toMatchObject({
        delta: "Fast response",
      });
    });

    it("should pass temperature to MiniMax agent", async () => {
      const agent = new BasicAgent({
        model: "minimax/MiniMax-M2.7",
        temperature: 0.7,
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([finish()]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.7);
    });

    it("should pass prompt to MiniMax agent", async () => {
      const agent = new BasicAgent({
        model: "minimax/MiniMax-M2.7",
        prompt: "You are a helpful MiniMax-powered assistant.",
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([finish()]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [{ id: "1", role: "user", content: "Hello" }],
        tools: [],
        context: [],
        state: {},
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.messages[0]).toMatchObject({
        role: "system",
        content: "You are a helpful MiniMax-powered assistant.",
      });
    });
  });
});
