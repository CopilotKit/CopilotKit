import { describe, expect, it } from "vitest";

import {
  deleteThreadEventSnippet,
  loadThreadEventSnippets,
  parseThreadSnippetEvents,
  upsertThreadEventSnippet,
} from "../thread-event-snippets.js";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    length: 0,
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: () => null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("thread event snippets", () => {
  it("accepts a non-empty array of typed events", () => {
    expect(
      parseThreadSnippetEvents(
        '[{"type":"RUN_STARTED"},{"type":"RUN_FINISHED"}]',
      ),
    ).toHaveLength(2);
  });

  it("rejects empty or malformed event payloads", () => {
    expect(() => parseThreadSnippetEvents("[]")).toThrow(
      "Choose a thread with at least one event.",
    );
    expect(() => parseThreadSnippetEvents('[{"payload":{}}]')).toThrow(
      "Each event must have a string type.",
    );
  });

  it("persists, updates, and removes a local snippet", () => {
    const localStorage = storage();
    const snippet = {
      id: "snippet-1",
      name: "Refund tool failure",
      sourceThreadId: "thread-1",
      sourceThreadName: "Refund request",
      events: [{ type: "RUN_ERROR" }],
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
    };

    expect(upsertThreadEventSnippet(snippet, localStorage)).toEqual([snippet]);
    expect(
      upsertThreadEventSnippet(
        { ...snippet, name: "Refund tool error" },
        localStorage,
      ),
    ).toEqual([{ ...snippet, name: "Refund tool error" }]);
    expect(loadThreadEventSnippets(localStorage)).toHaveLength(1);
    expect(deleteThreadEventSnippet(snippet.id, localStorage)).toEqual([]);
  });
});
