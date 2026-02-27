import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BuiltInAgent } from "../index";
import { EventType, type RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import {
  mockStreamTextResponse,
  toolCallStreamingStart,
  toolCall,
  toolResult,
  finish,
  collectEvents,
} from "./test-helpers";

// Mock the ai module
vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
  stepCountIs: vi.fn(() => () => false),
}));

// Mock the SDK clients
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "openai",
  })),
}));

describe("Tool result content field (#3198)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const baseInput: RunAgentInput = {
    threadId: "thread1",
    runId: "run1",
    messages: [],
    tools: [],
    context: [],
    state: {},
  };

  it("should set content to empty string when tool result output is undefined", async () => {
    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
    });

    // Simulate a tool whose execute returns undefined (like backend actions
    // with empty execute stubs)
    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([
        toolCallStreamingStart("call1", "backendAction"),
        toolCall("call1", "backendAction", { userId: "abcd" }),
        toolResult("call1", "backendAction", undefined),
        finish(),
      ]) as any,
    );

    const events = await collectEvents(agent["run"](baseInput));

    const resultEvent = events.find(
      (e: any) => e.type === EventType.TOOL_CALL_RESULT,
    ) as any;

    expect(resultEvent).toBeDefined();
    expect(resultEvent.toolCallId).toBe("call1");
    // content MUST be a string — not undefined — to satisfy the
    // ToolCallResultEvent Zod schema
    expect(typeof resultEvent.content).toBe("string");
  });

  it("should set content to empty string when tool result output is null", async () => {
    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([
        toolCallStreamingStart("call1", "backendAction"),
        toolCall("call1", "backendAction", {}),
        toolResult("call1", "backendAction", null),
        finish(),
      ]) as any,
    );

    const events = await collectEvents(agent["run"](baseInput));

    const resultEvent = events.find(
      (e: any) => e.type === EventType.TOOL_CALL_RESULT,
    ) as any;

    expect(resultEvent).toBeDefined();
    expect(typeof resultEvent.content).toBe("string");
    expect(resultEvent.content).toBe("null");
  });

  it("should correctly serialize object tool results", async () => {
    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([
        toolCallStreamingStart("call1", "fetchUser"),
        toolCall("call1", "fetchUser", { userId: "abcd" }),
        toolResult("call1", "fetchUser", { name: "Darth Doe" }),
        finish(),
      ]) as any,
    );

    const events = await collectEvents(agent["run"](baseInput));

    const resultEvent = events.find(
      (e: any) => e.type === EventType.TOOL_CALL_RESULT,
    ) as any;

    expect(resultEvent).toBeDefined();
    expect(resultEvent.content).toBe('{"name":"Darth Doe"}');
  });
});
