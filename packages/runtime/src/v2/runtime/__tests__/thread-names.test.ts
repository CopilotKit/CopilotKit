import { describe, expect, it, vi } from "vitest";
import type { AbstractAgent, Message, RunAgentInput } from "@ag-ui/client";

import {
  ɵnormalizeGeneratedTitle as normalizeGeneratedTitle,
  ɵselectGeneratedTitleFromMessages as selectGeneratedTitleFromMessages,
  ɵbuildThreadTitlePrompt as buildThreadTitlePrompt,
  ɵhasThreadName as hasThreadName,
  ɵderiveFallbackTitleFromMessages as deriveFallbackTitleFromMessages,
} from "../handlers/intelligence/thread-names";
import { generateThreadNameForNewThread } from "../handlers/intelligence/thread-names";
import type { CopilotIntelligenceRuntimeLike } from "../core/runtime";

const MAX_TITLE_LENGTH = 80;
const MAX_TITLE_WORDS = 8;

// The mock LLM's catch-all reply — long enough to normalize to null because it
// exceeds the title word limit, which is exactly why mock-mode threads used to
// fall through to the generic "Untitled".
const MOCK_CATCH_ALL_REPLY =
  "👋 This is the demo's local mock LLM and I do not have a real model wired up, " +
  "so I am replying with this canned message instead of answering your question.";

const userMessage = (content: string): Message =>
  ({ id: "msg-user", role: "user", content }) as Message;

const systemMessage = (content: string): Message =>
  ({ id: "msg-system", role: "system", content }) as Message;

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
// selectGeneratedTitleFromMessages
// ---------------------------------------------------------------------------

describe("selectGeneratedTitleFromMessages", () => {
  const msg = (role: string, content: unknown): Message =>
    ({ id: `msg-${role}`, role, content }) as Message;

  it("uses the latest valid assistant title before a tool result", () => {
    const result = selectGeneratedTitleFromMessages([
      msg("assistant", '{"title":"Weather request"}'),
      msg("tool", '{"timezone":"UTC","iso":"2026-06-01T00:00:00Z"}'),
    ]);

    expect(result).toBe("Weather request");
  });

  it("ignores malformed assistant JSON and falls back to an earlier valid title", () => {
    const result = selectGeneratedTitleFromMessages([
      msg("assistant", '{"title":"Order refund"}'),
      msg("assistant", '{"timezone":"UTC"}'),
    ]);

    expect(result).toBe("Order refund");
  });

  it("returns null when no assistant text response has a valid title", () => {
    const result = selectGeneratedTitleFromMessages([
      msg("tool", '{"title":"Tool payload"}'),
      msg("assistant", { title: "Object payload" }),
      msg("assistant", '{"title":42}'),
    ]);

    expect(result).toBeNull();
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

// ---------------------------------------------------------------------------
// deriveFallbackTitleFromMessages
// ---------------------------------------------------------------------------

describe("deriveFallbackTitleFromMessages", () => {
  it("derives a short cleaned title from the first user message", () => {
    const result = deriveFallbackTitleFromMessages([
      userMessage("Hello, can you help me plan a trip to Japan?"),
    ]);

    expect(result).not.toBe("Untitled");
    expect(result.split(/\s+/).length).toBeLessThanOrEqual(MAX_TITLE_WORDS);
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    // Bounded to 8 words (dropping the trailing "to Japan?"); the mid-title
    // comma is preserved since only trailing punctuation is stripped.
    expect(result).toBe("Hello, can you help me plan a trip");
  });

  it("returns Untitled when there is no user message", () => {
    expect(
      deriveFallbackTitleFromMessages([systemMessage("You are helpful.")]),
    ).toBe("Untitled");
  });

  it("returns Untitled for undefined or empty messages", () => {
    expect(deriveFallbackTitleFromMessages(undefined)).toBe("Untitled");
    expect(deriveFallbackTitleFromMessages([])).toBe("Untitled");
  });

  it("returns Untitled when the user message has only empty content", () => {
    expect(deriveFallbackTitleFromMessages([userMessage("   ")])).toBe(
      "Untitled",
    );
  });

  it("uses the FIRST user message, not later ones", () => {
    const result = deriveFallbackTitleFromMessages([
      systemMessage("You are helpful."),
      userMessage("Track my fitness goals"),
      userMessage("Something else entirely"),
    ]);

    expect(result).toBe("Track my fitness goals");
  });

  it("strips markdown and collapses whitespace", () => {
    const result = deriveFallbackTitleFromMessages([
      userMessage("**Budget**   _review_ please"),
    ]);

    expect(result).toBe("Budget review please");
  });

  it("bounds a long single-word message to the character limit", () => {
    const result = deriveFallbackTitleFromMessages([
      userMessage("A".repeat(120)),
    ]);

    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
  });
});

// ---------------------------------------------------------------------------
// generateThreadNameForNewThread — fallback wiring
// ---------------------------------------------------------------------------

interface ThreadNameSetup {
  updateThread: ReturnType<typeof vi.fn>;
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
}

/**
 * Builds a minimal runtime + agent stub for `generateThreadNameForNewThread`.
 * `assistantReply` is the single assistant message the stubbed agent run
 * returns; pass `null` to simulate an agent that produces no usable reply
 * (forcing all attempts to yield no valid title).
 */
function setup(assistantReply: string | null): ThreadNameSetup {
  const updateThread = vi.fn().mockResolvedValue({ id: "thread-1" });

  const makeAgentStub = (): AbstractAgent => {
    const stub: Record<string, unknown> = {
      setMessages: vi.fn(),
      setState: vi.fn(),
      threadId: undefined,
      headers: {},
      runAgent: vi.fn().mockResolvedValue({
        newMessages:
          assistantReply === null
            ? []
            : [{ id: "reply", role: "assistant", content: assistantReply }],
      }),
    };
    stub.clone = vi.fn(() => makeAgentStub());
    return stub as unknown as AbstractAgent;
  };

  const runtime = {
    agents: { "my-agent": makeAgentStub() },
    a2ui: undefined,
    mcpApps: undefined,
    openGenerativeUI: undefined,
    mode: "intelligence",
    generateThreadNames: true,
    intelligence: { updateThread },
  } as unknown as CopilotIntelligenceRuntimeLike;

  const request = new Request("https://example.com/agent/my-agent/run", {
    method: "POST",
  });

  return { updateThread, runtime, request };
}

const runWith = async (
  s: ThreadNameSetup,
  messages: Message[],
): Promise<string> => {
  await generateThreadNameForNewThread({
    runtime: s.runtime,
    request: s.request,
    agentId: "my-agent",
    sourceInput: { messages } as unknown as RunAgentInput,
    thread: { id: "thread-1", name: null } as never,
    userId: "user-1",
  });

  expect(s.updateThread).toHaveBeenCalledTimes(1);
  return s.updateThread.mock.calls[0][0].updates.name as string;
};

describe("generateThreadNameForNewThread — fallback title", () => {
  it("derives the name from the first user message when generation never yields a valid title", async () => {
    const s = setup(null);

    const name = await runWith(s, [
      userMessage("Hello, can you help me plan a trip to Japan?"),
    ]);

    expect(name).not.toBe("Untitled");
    expect(name.split(/\s+/).length).toBeLessThanOrEqual(MAX_TITLE_WORDS);
    expect(name.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(name).toBe("Hello, can you help me plan a trip");
  });

  it("falls back to Untitled when there is no user message", async () => {
    const s = setup(null);

    const name = await runWith(s, [systemMessage("You are helpful.")]);

    expect(name).toBe("Untitled");
  });

  it("treats the mock catch-all reply as invalid and derives from the user message", async () => {
    const s = setup(MOCK_CATCH_ALL_REPLY);

    const name = await runWith(s, [
      userMessage("Hello, can you help me plan a trip to Japan?"),
    ]);

    expect(name).not.toBe("Untitled");
    expect(name).not.toContain("mock LLM");
    expect(name).toBe("Hello, can you help me plan a trip");
  });

  it("uses a valid generated title when generation succeeds (regression)", async () => {
    const s = setup('{"title":"Trip to Japan"}');

    const name = await runWith(s, [
      userMessage("Hello, can you help me plan a trip to Japan?"),
    ]);

    expect(name).toBe("Trip to Japan");
  });
});
