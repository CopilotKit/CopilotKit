// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadSnippets, saveSnippet, deleteSnippet } from "../snippets.js";
import type { DevtoolsSnippet } from "../types.js";

const STORAGE_KEY = "cpk:inspector:snippets";

function makeSnippet(overrides: Partial<DevtoolsSnippet> = {}): DevtoolsSnippet {
  return {
    id: "snippet-1",
    name: "Test Snippet",
    eventType: "tool-call",
    payload: { toolName: "search", args: { q: "hello" }, result: "done" },
    createdAt: 1000,
    ...overrides,
  };
}

describe("snippets", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("returns empty array when no snippets saved", () => {
    expect(loadSnippets()).toEqual([]);
  });

  it("saves and loads a snippet", () => {
    const snippet = makeSnippet();
    saveSnippet(snippet);

    const loaded = loadSnippets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(snippet);
  });

  it("saves multiple snippets", () => {
    const s1 = makeSnippet({ id: "s1", name: "First" });
    const s2 = makeSnippet({ id: "s2", name: "Second" });
    saveSnippet(s1);
    saveSnippet(s2);

    const loaded = loadSnippets();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.id).toBe("s1");
    expect(loaded[1]!.id).toBe("s2");
  });

  it("deletes a snippet by id", () => {
    const s1 = makeSnippet({ id: "s1" });
    const s2 = makeSnippet({ id: "s2" });
    saveSnippet(s1);
    saveSnippet(s2);

    deleteSnippet("s1");

    const loaded = loadSnippets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("s2");
  });

  it("handles corrupt localStorage gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    expect(loadSnippets()).toEqual([]);
  });

  it("deleting non-existent snippet is a no-op", () => {
    const s1 = makeSnippet({ id: "s1" });
    saveSnippet(s1);

    deleteSnippet("non-existent");

    expect(loadSnippets()).toHaveLength(1);
  });
});
