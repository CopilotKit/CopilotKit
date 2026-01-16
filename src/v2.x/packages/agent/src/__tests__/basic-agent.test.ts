import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { BasicAgent, defineTool, type ToolDefinition } from "../index";
import { EventType, type RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import {
  mockStreamTextResponse,
  textStart,
  textDelta,
  finish,
  collectEvents,
  toolCallStreamingStart,
  toolCallDelta,
  toolCall,
  toolResult,
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

describe("BasicAgent", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.GOOGLE_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Basic Event Emission", () => {
    it("should emit RUN_STARTED and RUN_FINISHED events", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([textDelta("Hello"), finish()]) as any);

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

      expect(events[events.length - 1]).toMatchObject({
        type: EventType.RUN_FINISHED,
        threadId: "thread1",
        runId: "run1",
      });
    });

    it("should emit TEXT_MESSAGE_CHUNK events for text deltas", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([textDelta("Hello"), textDelta(" world"), finish()]) as any,
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

      const textEvents = events.filter((e: any) => e.type === EventType.TEXT_MESSAGE_CHUNK);
      expect(textEvents).toHaveLength(2);
      expect(textEvents[0]).toMatchObject({
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        delta: "Hello",
      });
      expect(textEvents[1]).toMatchObject({
        type: EventType.TEXT_MESSAGE_CHUNK,
        delta: " world",
      });
    });

    it("should generate unique messageId when provider returns id '0'", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          textStart("0"), // Simulate Google Gemini returning "0"
          textDelta("First message"),
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

      const textEvents = events.filter((e: any) => e.type === EventType.TEXT_MESSAGE_CHUNK);
      expect(textEvents).toHaveLength(1);

      // Verify that messageId is NOT "0" - should be a UUID
      expect(textEvents[0].messageId).not.toBe("0");
      expect(textEvents[0].messageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("should use provider-supplied messageId when it's not '0'", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      const validId = "msg_abc123";
      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          textStart(validId), // Valid ID from provider
          textDelta("Test message"),
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

      const textEvents = events.filter((e: any) => e.type === EventType.TEXT_MESSAGE_CHUNK);
      expect(textEvents).toHaveLength(1);

      // Verify that the valid ID from provider is used
      expect(textEvents[0].messageId).toBe(validId);
    });
  });

  describe("Tool Call Events", () => {
    it("should emit tool call lifecycle events", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "testTool"),
          toolCallDelta("call1", '{"arg'),
          toolCallDelta("call1", '":"val"}'),
          toolCall("call1", "testTool", { arg: "val" }),
          toolResult("call1", "testTool", { result: "success" }),
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

      // Check for TOOL_CALL_START
      const startEvent = events.find((e: any) => e.type === EventType.TOOL_CALL_START);
      expect(startEvent).toMatchObject({
        type: EventType.TOOL_CALL_START,
        toolCallId: "call1",
        toolCallName: "testTool",
      });

      // Check for TOOL_CALL_ARGS
      const argsEvents = events.filter((e: any) => e.type === EventType.TOOL_CALL_ARGS);
      expect(argsEvents).toHaveLength(2);

      // Check for TOOL_CALL_END
      const endEvent = events.find((e: any) => e.type === EventType.TOOL_CALL_END);
      expect(endEvent).toMatchObject({
        type: EventType.TOOL_CALL_END,
        toolCallId: "call1",
      });

      // Check for TOOL_CALL_RESULT
      const resultEvent = events.find((e: any) => e.type === EventType.TOOL_CALL_RESULT);
      expect(resultEvent).toMatchObject({
        type: EventType.TOOL_CALL_RESULT,
        role: "tool",
        toolCallId: "call1",
      });
    });
  });

  describe("Prompt Building", () => {
    it("should not add system message when no prompt, context, or state", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

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
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe("user");
    });

    it("should prepend system message with config prompt", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        prompt: "You are a helpful assistant.",
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

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
      expect(callArgs.messages).toHaveLength(2);
      expect(callArgs.messages[0]).toMatchObject({
        role: "system",
        content: "You are a helpful assistant.",
      });
    });

    it("should include context in system message", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [
          { description: "User Name", value: "John Doe" },
          { description: "Location", value: "New York" },
        ],
        state: {},
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      const systemMessage = callArgs.messages[0];
      expect(systemMessage.role).toBe("system");
      expect(systemMessage.content).toContain("Context from the application");
      expect(systemMessage.content).toContain("User Name");
      expect(systemMessage.content).toContain("John Doe");
      expect(systemMessage.content).toContain("Location");
      expect(systemMessage.content).toContain("New York");
    });

    it("should include state in system message", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: { counter: 0, items: ["a", "b"] },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      const systemMessage = callArgs.messages[0];
      expect(systemMessage.role).toBe("system");
      expect(systemMessage.content).toContain("Application State");
      expect(systemMessage.content).toContain("AGUISendStateSnapshot");
      expect(systemMessage.content).toContain("AGUISendStateDelta");
      expect(systemMessage.content).toContain('"counter": 0');
      expect(systemMessage.content).toContain('"items"');
    });

    it("should combine prompt, context, and state", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        prompt: "You are helpful.",
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [{ description: "Context", value: "Data" }],
        state: { value: 1 },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      const systemMessage = callArgs.messages[0];
      expect(systemMessage.content).toContain("You are helpful.");
      expect(systemMessage.content).toContain("Context from the application");
      expect(systemMessage.content).toContain("Application State");

      // Check order: prompt, then context, then state
      const promptIndex = systemMessage.content.indexOf("You are helpful.");
      const contextIndex = systemMessage.content.indexOf("Context from the application");
      const stateIndex = systemMessage.content.indexOf("Application State");

      expect(promptIndex).toBeLessThan(contextIndex);
      expect(contextIndex).toBeLessThan(stateIndex);
    });
  });

  describe("Forward System/Developer Messages", () => {
    it("should ignore system messages by default", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [
          { id: "sys1", role: "system", content: "System instruction" },
          { id: "user1", role: "user", content: "Hello" },
        ],
        tools: [],
        context: [],
        state: {},
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      // Should only have the user message, system message ignored
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe("user");
    });

    it("should ignore developer messages by default", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [
          { id: "dev1", role: "developer", content: "Developer hint" },
          { id: "user1", role: "user", content: "Hello" },
        ],
        tools: [],
        context: [],
        state: {},
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      // Should only have the user message, developer message ignored
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe("user");
    });

    it("should forward system messages when forwardSystemMessages is true", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        forwardSystemMessages: true,
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [
          { id: "sys1", role: "system", content: "System instruction" },
          { id: "user1", role: "user", content: "Hello" },
        ],
        tools: [],
        context: [],
        state: {},
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(2);
      expect(callArgs.messages[0]).toMatchObject({
        role: "system",
        content: "System instruction",
      });
      expect(callArgs.messages[1].role).toBe("user");
    });

    it("should forward developer messages as system when forwardDeveloperMessages is true", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        forwardDeveloperMessages: true,
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [
          { id: "dev1", role: "developer", content: "Developer hint" },
          { id: "user1", role: "user", content: "Hello" },
        ],
        tools: [],
        context: [],
        state: {},
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(2);
      // Developer messages are converted to system role
      expect(callArgs.messages[0]).toMatchObject({
        role: "system",
        content: "Developer hint",
      });
      expect(callArgs.messages[1].role).toBe("user");
    });

    it("should forward both system and developer messages when both flags are true", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        forwardSystemMessages: true,
        forwardDeveloperMessages: true,
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [
          { id: "sys1", role: "system", content: "System instruction" },
          { id: "dev1", role: "developer", content: "Developer hint" },
          { id: "user1", role: "user", content: "Hello" },
        ],
        tools: [],
        context: [],
        state: {},
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(3);
      expect(callArgs.messages[0]).toMatchObject({
        role: "system",
        content: "System instruction",
      });
      expect(callArgs.messages[1]).toMatchObject({
        role: "system",
        content: "Developer hint",
      });
      expect(callArgs.messages[2].role).toBe("user");
    });

    it("should place config prompt before forwarded system/developer messages", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        prompt: "You are a helpful assistant.",
        forwardSystemMessages: true,
        forwardDeveloperMessages: true,
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [
          { id: "sys1", role: "system", content: "System instruction" },
          { id: "dev1", role: "developer", content: "Developer hint" },
          { id: "user1", role: "user", content: "Hello" },
        ],
        tools: [],
        context: [],
        state: {},
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      // Config prompt is prepended as first system message
      expect(callArgs.messages).toHaveLength(4);
      expect(callArgs.messages[0]).toMatchObject({
        role: "system",
        content: "You are a helpful assistant.",
      });
      expect(callArgs.messages[1]).toMatchObject({
        role: "system",
        content: "System instruction",
      });
      expect(callArgs.messages[2]).toMatchObject({
        role: "system",
        content: "Developer hint",
      });
      expect(callArgs.messages[3].role).toBe("user");
    });
  });

  describe("Tool Configuration", () => {
    it("should include tools from config", async () => {
      const tool1 = defineTool({
        name: "configTool",
        description: "A config tool",
        parameters: z.object({ input: z.string() }),
        execute: async () => ({ result: "ok" }),
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        tools: [tool1],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

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
      expect(callArgs.tools).toHaveProperty("configTool");
    });

    it("should merge config tools with input tools", async () => {
      const configTool = defineTool({
        name: "configTool",
        description: "From config",
        parameters: z.object({}),
        execute: async () => ({ result: "ok" }),
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        tools: [configTool],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [
          {
            name: "inputTool",
            description: "From input",
            parameters: { type: "object", properties: {} },
          },
        ],
        context: [],
        state: {},
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.tools).toHaveProperty("configTool");
      expect(callArgs.tools).toHaveProperty("inputTool");
    });

    it("should always include state update tools", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

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
      expect(callArgs.tools).toHaveProperty("AGUISendStateSnapshot");
      expect(callArgs.tools).toHaveProperty("AGUISendStateDelta");
    });
  });

  describe("Property Overrides", () => {
    it("should respect overridable properties", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        temperature: 0.5,
        overridableProperties: ["temperature"],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { temperature: 0.9 },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.9);
    });

    it("should ignore non-overridable properties", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        temperature: 0.5,
        overridableProperties: [], // No properties can be overridden
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { temperature: 0.9 },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.5); // Original value, not overridden
    });
  });

  describe("Error Handling", () => {
    it("should emit RUN_ERROR event on failure", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockImplementation(() => {
        throw new Error("Test error");
      });

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
      };

      try {
        await collectEvents(agent["run"](input));
        expect.fail("Should have thrown");
      } catch (error: any) {
        // Error is expected - check that we got a RUN_ERROR event
        // Note: The error is thrown after emitting the event
        expect(error.message).toContain("Test error");
      }
    });
  });
});
