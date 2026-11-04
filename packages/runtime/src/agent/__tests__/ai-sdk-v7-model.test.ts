import { EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuiltInAgent, resolveModel } from "../index";
import { collectEvents } from "./test-helpers";

/**
 * BuiltInAgent bundles AI SDK 6 (`ai@6`), whose `streamText` only runs models
 * with `specificationVersion` "v2" or "v3". AI SDK 7 providers build "v4"
 * models. Classic mode must refuse those up front with an error that names the
 * fix (factory mode), and factory mode must carry an `ai@7` stream, usage
 * included.
 */

/** The shape `@ai-sdk/openai@4` (AI SDK 7) builds. */
function aiSdk7Model() {
  return {
    specificationVersion: "v4" as const,
    provider: "openai.responses",
    modelId: "gpt-5",
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  };
}

function createInput(): RunAgentInput {
  return {
    threadId: "thread-ai-sdk-7",
    runId: "run-ai-sdk-7",
    messages: [{ id: "message-1", role: "user", content: "Hi" }],
    tools: [],
    context: [],
    state: {},
  };
}

describe("classic mode with an AI SDK 7 model object", () => {
  it("refuses it when the agent is built, naming AI SDK 6 and factory mode", () => {
    const build = () =>
      // The `ai@6` LanguageModel type rejects a "v4" model, so an app on
      // `ai@7` has to cast to get here.
      new BuiltInAgent({ model: aiSdk7Model() as never });

    expect(build).toThrow(/specificationVersion "v4"/);
    expect(build).toThrow(/AI SDK 6/);
    expect(build).toThrow(/type: "aisdk"/);
  });

  it("refuses it in resolveModel, which also serves the per-run model override", () => {
    expect(() => resolveModel(aiSdk7Model() as never)).toThrow(
      /"gpt-5" from provider "openai\.responses".*AI SDK 6/s,
    );
  });

  it.each(["v2", "v3"] as const)(
    "still passes a %s model object through unchanged",
    (specificationVersion) => {
      const model = { ...aiSdk7Model(), specificationVersion };

      expect(resolveModel(model as never)).toBe(model);
      expect(() => new BuiltInAgent({ model: model as never })).not.toThrow();
    },
  );
});

describe("factory mode with an AI SDK 7 streamText result", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** fullStream parts as `ai@7.0.156` emits them, including its new part types. */
  function aiSdk7FullStream() {
    return (async function* () {
      yield { type: "start" };
      yield { type: "start-step", request: {}, warnings: [] };
      yield { type: "custom", kind: "openai.compaction" };
      yield { type: "reasoning-file", file: {} };
      yield { type: "text-start", id: "text-1" };
      yield { type: "text-delta", id: "text-1", text: "Hello" };
      yield { type: "text-end", id: "text-1" };
      yield {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "lookup",
        input: { q: "x" },
      };
      yield {
        type: "tool-approval-response",
        approvalId: "approval-1",
        approved: true,
      };
      yield {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "lookup",
        input: { q: "x" },
        output: { ok: true },
      };
      yield {
        type: "finish",
        finishReason: "stop",
        rawFinishReason: "stop",
        // AI SDK 7 dropped the top-level reasoningTokens/cachedInputTokens.
        totalUsage: {
          inputTokens: 12,
          inputTokenDetails: {
            noCacheTokens: 9,
            cacheReadTokens: 3,
            cacheWriteTokens: undefined,
          },
          outputTokens: 8,
          outputTokenDetails: { textTokens: 6, reasoningTokens: 2 },
          totalTokens: 20,
        },
      };
    })();
  }

  it("streams text and tool events and keeps every usage count", async () => {
    const agent = new BuiltInAgent({
      type: "aisdk",
      factory: () => ({ fullStream: aiSdk7FullStream() }),
    });

    const events = await collectEvents(agent.run(createInput()));

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_CHUNK,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.RUN_FINISHED,
    ]);
    expect(events.at(-1)).toMatchObject({
      usage: [
        {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
          reasoningTokens: 2,
          cachedInputTokens: 3,
        },
      ],
    });
    expect(console.warn).not.toHaveBeenCalled();
  });
});
