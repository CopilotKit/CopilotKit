import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { BasicAgent, defineTool } from "../index";
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
  stepCountIs: vi.fn((count: number) => ({ type: "stepCount", count })),
}));

// Mock the SDK clients
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "openai",
  })),
}));

describe("Config Tools Server-Side Execution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Tool Definition with Execute", () => {
    it("should pass execute function to streamText tools", async () => {
      const executeFn = vi.fn().mockResolvedValue({ result: "executed" });

      const weatherTool = defineTool({
        name: "getWeather",
        description: "Get weather for a city",
        parameters: z.object({
          city: z.string().describe("The city name"),
        }),
        execute: executeFn,
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        tools: [weatherTool],
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

      // Verify streamText was called with tools that have execute functions
      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.tools).toHaveProperty("getWeather");
      expect(callArgs.tools.getWeather).toHaveProperty("execute");
      expect(typeof callArgs.tools.getWeather.execute).toBe("function");
    });

    it("should include all tool properties in the Vercel AI SDK tool", async () => {
      const executeFn = vi.fn().mockResolvedValue({ temperature: 72 });

      const weatherTool = defineTool({
        name: "getWeather",
        description: "Get weather for a city",
        parameters: z.object({
          city: z.string(),
          units: z.enum(["celsius", "fahrenheit"]).optional(),
        }),
        execute: executeFn,
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        tools: [weatherTool],
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
      const tool = callArgs.tools.getWeather;

      expect(tool.description).toBe("Get weather for a city");
      expect(tool.inputSchema).toBeDefined();
      expect(tool.execute).toBe(executeFn);
    });

    it("should handle multiple config tools with execute functions", async () => {
      const weatherExecute = vi.fn().mockResolvedValue({ temp: 72 });
      const searchExecute = vi.fn().mockResolvedValue({ results: [] });

      const weatherTool = defineTool({
        name: "getWeather",
        description: "Get weather",
        parameters: z.object({ city: z.string() }),
        execute: weatherExecute,
      });

      const searchTool = defineTool({
        name: "search",
        description: "Search the web",
        parameters: z.object({ query: z.string() }),
        execute: searchExecute,
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        tools: [weatherTool, searchTool],
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

      expect(callArgs.tools.getWeather.execute).toBe(weatherExecute);
      expect(callArgs.tools.search.execute).toBe(searchExecute);
    });
  });

  describe("Config Tools vs Input Tools", () => {
    it("config tools should have execute, input tools should not", async () => {
      const configExecute = vi.fn().mockResolvedValue({ result: "server" });

      const configTool = defineTool({
        name: "serverTool",
        description: "Runs on server",
        parameters: z.object({ data: z.string() }),
        execute: configExecute,
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        tools: [configTool],
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([finish()]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [
          {
            name: "clientTool",
            description: "Runs on client",
            parameters: { type: "object", properties: { input: { type: "string" } } },
          },
        ],
        context: [],
        state: {},
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];

      // Config tool has execute
      expect(callArgs.tools.serverTool.execute).toBe(configExecute);

      // Input tool does NOT have execute (client-side execution)
      expect(callArgs.tools.clientTool.execute).toBeUndefined();
    });
  });

  describe("Execute Function Invocation", () => {
    it("execute function can be called with correct arguments", async () => {
      const executeFn = vi.fn().mockResolvedValue({ weather: "sunny", temp: 72 });

      const weatherTool = defineTool({
        name: "getWeather",
        description: "Get weather",
        parameters: z.object({
          city: z.string(),
          units: z.enum(["celsius", "fahrenheit"]),
        }),
        execute: executeFn,
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        tools: [weatherTool],
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

      // Get the execute function that was passed to streamText
      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      const passedExecute = callArgs.tools.getWeather.execute;

      // Manually invoke it to verify it works correctly
      const result = await passedExecute({ city: "New York", units: "fahrenheit" });

      expect(executeFn).toHaveBeenCalledWith({ city: "New York", units: "fahrenheit" });
      expect(result).toEqual({ weather: "sunny", temp: 72 });
    });

    it("execute function errors are propagated", async () => {
      const executeFn = vi.fn().mockRejectedValue(new Error("API unavailable"));

      const failingTool = defineTool({
        name: "failingTool",
        description: "A tool that fails",
        parameters: z.object({}),
        execute: executeFn,
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        tools: [failingTool],
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
      const passedExecute = callArgs.tools.failingTool.execute;

      await expect(passedExecute({})).rejects.toThrow("API unavailable");
    });
  });

  describe("Built-in State Tools Still Work", () => {
    it("AGUISendStateSnapshot should have execute alongside config tools", async () => {
      const configExecute = vi.fn().mockResolvedValue({});

      const configTool = defineTool({
        name: "myTool",
        description: "My tool",
        parameters: z.object({}),
        execute: configExecute,
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        tools: [configTool],
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
        state: { value: 1 },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];

      // Both config tool and state tools should have execute
      expect(callArgs.tools.myTool.execute).toBe(configExecute);
      expect(callArgs.tools.AGUISendStateSnapshot.execute).toBeDefined();
      expect(callArgs.tools.AGUISendStateDelta.execute).toBeDefined();
    });
  });

  describe("Message ID Generation", () => {
    it("should use messageId from text-start event", async () => {
      const executeFn = vi.fn().mockResolvedValue({ result: "ok" });

      const tool = defineTool({
        name: "myTool",
        description: "My tool",
        parameters: z.object({}),
        execute: executeFn,
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        tools: [tool],
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          { type: "text-start", id: "msg-1" },
          { type: "text-delta", text: "Before " },
          { type: "text-delta", text: "tool" },
          toolCallStreamingStart("call1", "myTool"),
          toolCall("call1", "myTool"),
          toolResult("call1", "myTool", { result: "ok" }),
          { type: "text-start", id: "msg-2" },
          { type: "text-delta", text: "After " },
          { type: "text-delta", text: "tool" },
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

      // First two text chunks should have messageId from first text-start
      expect(textEvents[0].messageId).toBe("msg-1");
      expect(textEvents[1].messageId).toBe("msg-1");

      // After tool result, text chunks should have messageId from second text-start
      expect(textEvents[2].messageId).toBe("msg-2");
      expect(textEvents[3].messageId).toBe("msg-2");
    });
  });

  describe("Multi-Step Execution (maxSteps)", () => {
    it("should pass stopWhen with stepCountIs when maxSteps is configured", async () => {
      const executeFn = vi.fn().mockResolvedValue({ result: "ok" });

      const tool = defineTool({
        name: "myTool",
        description: "My tool",
        parameters: z.object({}),
        execute: executeFn,
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        maxSteps: 5,
        tools: [tool],
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

      // stopWhen should be set with stepCountIs(5)
      expect(callArgs.stopWhen).toEqual({ type: "stepCount", count: 5 });
    });

    it("should not set stopWhen when maxSteps is not configured", async () => {
      const executeFn = vi.fn().mockResolvedValue({ result: "ok" });

      const tool = defineTool({
        name: "myTool",
        description: "My tool",
        parameters: z.object({}),
        execute: executeFn,
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        // maxSteps not set
        tools: [tool],
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

      // stopWhen should be undefined (defaults to stepCountIs(1) in SDK)
      expect(callArgs.stopWhen).toBeUndefined();
    });

    it("should allow high maxSteps for complex tool chains", async () => {
      const executeFn = vi.fn().mockResolvedValue({});

      const tool = defineTool({
        name: "chainTool",
        description: "Tool for chaining",
        parameters: z.object({}),
        execute: executeFn,
      });

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        maxSteps: 10,
        tools: [tool],
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

      expect(callArgs.stopWhen).toEqual({ type: "stepCount", count: 10 });
    });
  });
});
