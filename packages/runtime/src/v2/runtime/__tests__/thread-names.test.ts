import { describe, expect, it, vi } from "vitest";
import type { Message, RunAgentInput } from "@ag-ui/client";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";

import {
  generateThreadNameForNewThread,
  ɵnormalizeGeneratedTitle as normalizeGeneratedTitle,
  ɵbuildThreadTitlePrompt as buildThreadTitlePrompt,
  ɵhasThreadName as hasThreadName,
} from "../handlers/intelligence/thread-names";
import type { CopilotIntelligenceRuntimeLike } from "../core/runtime";

// ---------------------------------------------------------------------------
// normalizeGeneratedTitle
// ---------------------------------------------------------------------------

describe("normalizeGeneratedTitle", () => {
  it("extracts title from valid JSON response", () => {
    expect(normalizeGeneratedTitle('{"title":"Budget Review"}')).toBe(
      "Budget Review",
    );
  });

  it("extracts title from JSON wrapped in code fences", () => {
    expect(
      normalizeGeneratedTitle('```json\n{"title":"Budget Review"}\n```'),
    ).toBe("Budget Review");
  });

  it("strips surrounding quotes from plain text", () => {
    expect(normalizeGeneratedTitle('"Budget Review"')).toBe("Budget Review");
    expect(normalizeGeneratedTitle("'Budget Review'")).toBe("Budget Review");
    expect(normalizeGeneratedTitle("`Budget Review`")).toBe("Budget Review");
  });

  it("strips markdown characters", () => {
    expect(normalizeGeneratedTitle("**Budget** _Review_")).toBe(
      "Budget Review",
    );
    expect(normalizeGeneratedTitle("# Budget Review")).toBe("Budget Review");
    expect(normalizeGeneratedTitle("[Budget](Review)")).toBe("BudgetReview");
  });

  it("strips trailing punctuation", () => {
    expect(normalizeGeneratedTitle("Budget Review.")).toBe("Budget Review");
    expect(normalizeGeneratedTitle("Budget Review!")).toBe("Budget Review");
    expect(normalizeGeneratedTitle("Budget Review?")).toBe("Budget Review");
    expect(normalizeGeneratedTitle("Budget Review;")).toBe("Budget Review");
  });

  it("collapses whitespace", () => {
    expect(normalizeGeneratedTitle("Budget   Review")).toBe("Budget Review");
    expect(normalizeGeneratedTitle("  Budget  Review  ")).toBe("Budget Review");
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(normalizeGeneratedTitle("")).toBeNull();
    expect(normalizeGeneratedTitle("   ")).toBeNull();
  });

  it("returns null when all content is stripped", () => {
    expect(normalizeGeneratedTitle("***")).toBeNull();
    expect(normalizeGeneratedTitle("[]()")).toBeNull();
  });

  it("truncates titles longer than 80 characters", () => {
    const long = "A".repeat(100);
    const result = normalizeGeneratedTitle(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(80);
  });

  it("returns null when title has more than 8 words", () => {
    expect(
      normalizeGeneratedTitle("one two three four five six seven eight nine"),
    ).toBeNull();
  });

  it("accepts title with exactly 8 words", () => {
    expect(
      normalizeGeneratedTitle("one two three four five six seven eight"),
    ).toBe("one two three four five six seven eight");
  });

  it("handles JSON with non-string title gracefully", () => {
    expect(normalizeGeneratedTitle('{"title":42}')).toBeNull();
  });

  it("rejects JSON without a string title", () => {
    expect(
      normalizeGeneratedTitle(
        '{"timezone":"UTC","iso":"2026-06-01T00:00:00Z"}',
      ),
    ).toBeNull();
  });

  it("handles malformed JSON gracefully", () => {
    expect(normalizeGeneratedTitle("{not json}")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// generateThreadNameForNewThread
// ---------------------------------------------------------------------------

describe("generateThreadNameForNewThread", () => {
  const USER_TEXT = "Draft a follow-up email to contact c11 about the renewal";

  function textModel(text: string) {
    return new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: {
            total: 1,
            noCache: 1,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    });
  }

  // `agents` throws on access: thread naming must never touch the app's agent.
  function createRuntime(
    generateThreadNames: CopilotIntelligenceRuntimeLike["generateThreadNames"],
  ) {
    const updateThread = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      generateThreadNames,
      intelligence: { updateThread },
      get agents(): never {
        throw new Error("thread naming must not resolve the app's agent");
      },
    } as unknown as CopilotIntelligenceRuntimeLike;
    return { runtime, updateThread };
  }

  const IMAGE_PART = {
    type: "image",
    source: {
      type: "data",
      value: "iVBORw0KGgoAAAANSUhEUgAA",
      mimeType: "image/png",
    },
  };

  async function nameThread(
    runtime: CopilotIntelligenceRuntimeLike,
    messages: Message[] = [{ id: "user-1", role: "user", content: USER_TEXT }],
  ) {
    await generateThreadNameForNewThread({
      runtime,
      agentId: "my-agent",
      sourceInput: {
        threadId: "thread-1",
        runId: "run-1",
        state: {},
        messages,
        tools: [],
        context: [],
        forwardedProps: {},
      } as RunAgentInput,
      thread: { id: "thread-1", name: null } as never,
      userId: "user-1",
    });
  }

  const expectName = (updateThread: ReturnType<typeof vi.fn>, name: string) =>
    expect(updateThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      userId: "user-1",
      agentId: "my-agent",
      updates: { name },
    });

  it("uses the first user message when no model is configured", async () => {
    const { runtime, updateThread } = createRuntime(true);
    await nameThread(runtime);
    expectName(updateThread, "Draft a follow-up email to contact c11 about");
  });

  it("calls the configured model once, with no tools", async () => {
    const model = textModel('{"title":"Renewal follow-up email"}');
    const { runtime, updateThread } = createRuntime({ model });
    await nameThread(runtime);

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].tools ?? []).toEqual([]);
    // A small output cap leaves a reasoning model no tokens for the title.
    expect(model.doGenerateCalls[0].maxOutputTokens).toBeUndefined();
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain(
      USER_TEXT,
    );
    expectName(updateThread, "Renewal follow-up email");
  });

  it("uses the first user message when the model call fails", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("provider down");
      },
    });
    const { runtime, updateThread } = createRuntime({ model });
    await nameThread(runtime);
    expectName(updateThread, "Draft a follow-up email to contact c11 about");
  });

  it("uses the first user message when the model answers instead of naming", async () => {
    const model = textModel(
      "Here is a draft email for contact c11. Hi there, I wanted to follow up on the renewal.",
    );
    const { runtime, updateThread } = createRuntime({ model });
    await nameThread(runtime);
    expect(model.doGenerateCalls).toHaveLength(1);
    expectName(updateThread, "Draft a follow-up email to contact c11 about");
  });

  it("names a message with an attachment from its text parts only", async () => {
    const { runtime, updateThread } = createRuntime(true);
    await nameThread(runtime, [
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: USER_TEXT }, IMAGE_PART],
      } as Message,
    ]);
    expectName(updateThread, "Draft a follow-up email to contact c11 about");
  });

  it("does not name a thread whose first message has no text", async () => {
    const { runtime, updateThread } = createRuntime(true);
    await nameThread(runtime, [
      { id: "user-1", role: "user", content: [IMAGE_PART] } as Message,
    ]);
    expect(updateThread).not.toHaveBeenCalled();
  });

  it("sends only text parts to the model", async () => {
    const model = textModel('{"title":"Renewal follow-up email"}');
    const { runtime } = createRuntime({ model });
    await nameThread(runtime, [
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: USER_TEXT }, IMAGE_PART],
      } as Message,
    ]);
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain(USER_TEXT);
    expect(prompt).not.toContain(IMAGE_PART.source.value);
    expect(prompt).not.toContain('\\"type\\"');
  });

  it("does not retry a failed model call", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new APICallError({
          message: "rate limited",
          url: "https://example.com",
          requestBodyValues: {},
          statusCode: 429,
          isRetryable: true,
        });
      },
    });
    const { runtime, updateThread } = createRuntime({ model });
    await nameThread(runtime);
    expect(model.doGenerateCalls).toHaveLength(1);
    expectName(updateThread, "Draft a follow-up email to contact c11 about");
  });

  it("does nothing when naming is off", async () => {
    const { runtime, updateThread } = createRuntime(false);
    await nameThread(runtime);
    expect(updateThread).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildThreadTitlePrompt
// ---------------------------------------------------------------------------

describe("buildThreadTitlePrompt", () => {
  const msg = (role: string, content: string): Message =>
    ({ id: `msg-${role}`, role, content }) as Message;

  it("returns null for empty messages", () => {
    expect(buildThreadTitlePrompt([])).toBeNull();
    expect(
      buildThreadTitlePrompt(undefined as unknown as Message[]),
    ).toBeNull();
  });

  it("builds a prompt from user and assistant messages", () => {
    const messages = [
      msg("user", "What is the weather?"),
      msg("assistant", "It is sunny today."),
    ];

    const result = buildThreadTitlePrompt(messages);
    expect(result).toContain("Generate a short title");
    expect(result).toContain("user: What is the weather?");
    expect(result).toContain("assistant: It is sunny today.");
  });

  it("places the title task after the transcript", () => {
    const result = buildThreadTitlePrompt([
      msg("user", "Explain gravity in one short sentence."),
    ])!;

    expect(result.indexOf("user: Explain gravity")).toBeLessThan(
      result.indexOf("Generate a short title"),
    );
    expect(result).toContain("Do not answer the conversation");
  });

  it("filters out tool role messages", () => {
    const messages = [
      msg("user", "Search for cats"),
      msg("tool", '{"results": []}'),
      msg("assistant", "Found some cats."),
    ];

    const result = buildThreadTitlePrompt(messages);
    expect(result).not.toContain("tool:");
    expect(result).toContain("user: Search for cats");
    expect(result).toContain("assistant: Found some cats.");
  });

  it("includes system and developer messages", () => {
    const messages = [
      msg("system", "You are helpful."),
      msg("developer", "Be concise."),
      msg("user", "Hello"),
    ];

    const result = buildThreadTitlePrompt(messages);
    expect(result).toContain("system: You are helpful.");
    expect(result).toContain("developer: Be concise.");
  });

  it("takes only the last 8 messages", () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      msg("user", `Message ${i}`),
    );

    const result = buildThreadTitlePrompt(messages)!;
    // Should contain messages 4-11 (last 8) but not 0-3
    expect(result).not.toContain("Message 3");
    expect(result).toContain("Message 4");
    expect(result).toContain("Message 11");
  });

  it("skips messages with empty content", () => {
    const messages = [msg("user", ""), msg("assistant", "Hello")];

    const result = buildThreadTitlePrompt(messages);
    expect(result).not.toContain("user:");
    expect(result).toContain("assistant: Hello");
  });

  it("returns null when all messages have empty content", () => {
    const messages = [msg("user", ""), msg("assistant", "")];
    expect(buildThreadTitlePrompt(messages)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hasThreadName
// ---------------------------------------------------------------------------

describe("hasThreadName", () => {
  it("returns true for non-empty strings", () => {
    expect(hasThreadName("Budget Review")).toBe(true);
  });

  it("returns false for null and undefined", () => {
    expect(hasThreadName(null)).toBe(false);
    expect(hasThreadName(undefined)).toBe(false);
  });

  it("returns false for empty or whitespace-only strings", () => {
    expect(hasThreadName("")).toBe(false);
    expect(hasThreadName("   ")).toBe(false);
  });
});
