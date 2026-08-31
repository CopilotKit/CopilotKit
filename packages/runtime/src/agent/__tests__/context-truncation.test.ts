import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BasicAgent } from "../index";
import {
  MAX_CONTEXT_VALUE_LENGTH,
  truncateContextValue,
} from "../context-truncation";
import { streamText } from "ai";
import { mockStreamTextResponse, finish, collectEvents } from "./test-helpers";
import type { RunAgentInput } from "@ag-ui/client";

vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
  stepCountIs: vi.fn((count: number) => ({ type: "stepCount", count })),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "openai",
  })),
}));

describe("BuiltInAgent Application Context Truncation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("truncates oversized context values in the assembled system prompt", async () => {
    const agent = new BasicAgent({ model: "openai/gpt-4o" });
    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([finish()]) as any,
    );

    const input: RunAgentInput = {
      threadId: "thread1",
      runId: "run1",
      messages: [],
      tools: [],
      context: [{ description: "big", value: "x".repeat(50_000) }],
      state: {},
    };

    await collectEvents(agent["run"](input));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    const content = callArgs.messages[0].content as string;

    expect(content).toContain("## Context from the application");
    expect(content).toContain("… [truncated by CopilotKit]");
    expect(content.length).toBeGreaterThan(20_000);
    expect(content.length).toBeLessThan(50_000);
  });

  it("leaves within-limit context values unchanged", async () => {
    const agent = new BasicAgent({ model: "openai/gpt-4o" });
    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([finish()]) as any,
    );

    const input: RunAgentInput = {
      threadId: "thread2",
      runId: "run2",
      messages: [],
      tools: [],
      context: [{ description: "small", value: "hello" }],
      state: {},
    };

    await collectEvents(agent["run"](input));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    const content = callArgs.messages[0].content as string;
    expect(content).toContain("hello");
    expect(content).not.toContain("truncated");
  });
});

describe("truncateContextValue", () => {
  it("keeps the return value (including marker) within MAX_CONTEXT_VALUE_LENGTH", () => {
    const result = truncateContextValue("x".repeat(50_000));
    expect(result.length).toBe(MAX_CONTEXT_VALUE_LENGTH);
    expect(result).toContain("… [truncated by CopilotKit]");
  });

  it("leaves a value at exactly the limit untouched (no marker)", () => {
    const value = "x".repeat(MAX_CONTEXT_VALUE_LENGTH);
    expect(truncateContextValue(value)).toBe(value);
  });

  it("truncates a value just over the limit to exactly the limit", () => {
    const value = "x".repeat(MAX_CONTEXT_VALUE_LENGTH + 1);
    const result = truncateContextValue(value);
    expect(result.length).toBe(MAX_CONTEXT_VALUE_LENGTH);
    expect(result).toContain("… [truncated by CopilotKit]");
  });

  it("does not end on a lone high surrogate when the slice lands mid-pair", () => {
    // 0xd83d is a high surrogate; "a" + emoji repeated lands a lone high
    // surrogate at the cut point. The result must not end with an unpaired one.
    const value = "a" + "😀".repeat(20_000);
    const result = truncateContextValue(value);
    const last = result.charCodeAt(result.length - 1);
    expect(last < 0xd800 || last > 0xdbff).toBe(true);
  });
});
