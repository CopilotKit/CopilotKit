import { describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/client";

import {
  ɵnormalizeGeneratedTitle as normalizeGeneratedTitle,
  ɵselectGeneratedTitleFromMessages as selectGeneratedTitleFromMessages,
  ɵbuildThreadTitlePrompt as buildThreadTitlePrompt,
  ɵhasThreadName as hasThreadName,
} from "../handlers/intelligence/thread-names";

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
