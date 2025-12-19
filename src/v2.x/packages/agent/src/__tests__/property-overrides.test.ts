import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BasicAgent } from "../index";
import { type RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import { mockStreamTextResponse, finish, collectEvents } from "./test-helpers";

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

describe("Property Overrides - Edge Cases", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Model Override", () => {
    it("should override model when allowed", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        overridableProperties: ["model"],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { model: "anthropic/claude-sonnet-4.5" },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.model.provider).toBe("anthropic");
      expect(callArgs.model.modelId).toBe("claude-sonnet-4.5");
    });

    it("should accept LanguageModel instance for override", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        overridableProperties: ["model"],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const customModel = {
        modelId: "custom-model",
        provider: "custom",
      };

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { model: customModel },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.model).toBe(customModel);
    });

    it("should ignore invalid model override types", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        overridableProperties: ["model"],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { model: 123 }, // Invalid type
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.model.modelId).toBe("gpt-4o"); // Original value
    });
  });

  describe("ToolChoice Override", () => {
    it("should override with 'auto'", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        toolChoice: "required",
        overridableProperties: ["toolChoice"],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { toolChoice: "auto" },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.toolChoice).toBe("auto");
    });

    it("should override with 'required'", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        toolChoice: "auto",
        overridableProperties: ["toolChoice"],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { toolChoice: "required" },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.toolChoice).toBe("required");
    });

    it("should override with 'none'", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        toolChoice: "auto",
        overridableProperties: ["toolChoice"],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { toolChoice: "none" },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.toolChoice).toBe("none");
    });

    it("should override with specific tool selection", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        toolChoice: "auto",
        overridableProperties: ["toolChoice"],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { toolChoice: { type: "tool", toolName: "specificTool" } },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.toolChoice).toEqual({ type: "tool", toolName: "specificTool" });
    });

    it("should ignore invalid toolChoice values", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        toolChoice: "auto",
        overridableProperties: ["toolChoice"],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { toolChoice: "invalid" },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.toolChoice).toBe("auto"); // Original value
    });
  });

  describe("StopSequences Override", () => {
    it("should override stopSequences with valid array", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        stopSequences: ["STOP"],
        overridableProperties: ["stopSequences"],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { stopSequences: ["END", "FINISH"] },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.stopSequences).toEqual(["END", "FINISH"]);
    });

    it("should ignore stopSequences with non-string elements", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        stopSequences: ["STOP"],
        overridableProperties: ["stopSequences"],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { stopSequences: ["STOP", 123, "END"] as any },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.stopSequences).toEqual(["STOP"]); // Original value
    });

    it("should ignore non-array stopSequences", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        stopSequences: ["STOP"],
        overridableProperties: ["stopSequences"],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { stopSequences: "STOP" as any },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.stopSequences).toEqual(["STOP"]); // Original value
    });
  });

  describe("Numeric Property Overrides", () => {
    it("should override all numeric properties when allowed", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        maxOutputTokens: 100,
        temperature: 0.5,
        topP: 0.9,
        topK: 50,
        presencePenalty: 0.0,
        frequencyPenalty: 0.0,
        seed: 123,
        maxRetries: 3,
        overridableProperties: [
          "maxOutputTokens",
          "temperature",
          "topP",
          "topK",
          "presencePenalty",
          "frequencyPenalty",
          "seed",
          "maxRetries",
        ],
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {
          maxOutputTokens: 500,
          temperature: 0.8,
          topP: 0.95,
          topK: 100,
          presencePenalty: 0.5,
          frequencyPenalty: 0.5,
          seed: 456,
          maxRetries: 5,
        },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.maxOutputTokens).toBe(500);
      expect(callArgs.temperature).toBe(0.8);
      expect(callArgs.topP).toBe(0.95);
      expect(callArgs.topK).toBe(100);
      expect(callArgs.presencePenalty).toBe(0.5);
      expect(callArgs.frequencyPenalty).toBe(0.5);
      expect(callArgs.seed).toBe(456);
      expect(callArgs.maxRetries).toBe(5);
    });

    it("should ignore non-numeric values for numeric properties", async () => {
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
        forwardedProps: { temperature: "high" as any },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.5); // Original value
    });
  });

  describe("Multiple Property Overrides", () => {
    it("should only override allowed properties", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        temperature: 0.5,
        topP: 0.9,
        maxOutputTokens: 100,
        overridableProperties: ["temperature"], // Only temperature is overridable
      });

      vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finish()]) as any);

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {
          temperature: 0.9,
          topP: 0.5,
          maxOutputTokens: 500,
        },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.9); // Overridden
      expect(callArgs.topP).toBe(0.9); // Original
      expect(callArgs.maxOutputTokens).toBe(100); // Original
    });

    it("should handle undefined forwardedProps", async () => {
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
        // No forwardedProps
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.5); // Original value
    });

    it("should handle non-object forwardedProps", async () => {
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
        forwardedProps: "not an object" as any,
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.5); // Original value
    });

    it("should handle undefined property values in forwardedProps", async () => {
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
        forwardedProps: { temperature: undefined },
      };

      await collectEvents(agent["run"](input));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.5); // Original value (undefined is ignored)
    });
  });

  describe("canOverride method", () => {
    it("should return true for overridable properties", () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        overridableProperties: ["temperature", "topP"],
      });

      expect(agent.canOverride("temperature")).toBe(true);
      expect(agent.canOverride("topP")).toBe(true);
    });

    it("should return false for non-overridable properties", () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        overridableProperties: ["temperature"],
      });

      expect(agent.canOverride("topP")).toBe(false);
      expect(agent.canOverride("seed")).toBe(false);
    });

    it("should return false when overridableProperties is undefined", () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      expect(agent.canOverride("temperature")).toBe(false);
      expect(agent.canOverride("topP")).toBe(false);
    });

    it("should return false when overridableProperties is empty array", () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        overridableProperties: [],
      });

      expect(agent.canOverride("temperature")).toBe(false);
    });
  });
});
