// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadSnippets,
  saveSnippet,
  deleteSnippet,
  updateSnippet,
} from "../snippets.js";
import type { DevtoolsSnippet } from "../types.js";

const STORAGE_KEY = "cpk:inspector:snippets";

function makeSnippet(
  overrides: Partial<DevtoolsSnippet> = {},
): DevtoolsSnippet {
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

  it("saveSnippet returns false on localStorage write error", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

    const result = saveSnippet(makeSnippet());
    expect(result).toBe(false);

    spy.mockRestore();
  });

  it("deleteSnippet returns false on localStorage write error", () => {
    saveSnippet(makeSnippet({ id: "s1" }));

    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

    const result = deleteSnippet("s1");
    expect(result).toBe(false);

    spy.mockRestore();
  });

  it("saveSnippet returns true on success", () => {
    expect(saveSnippet(makeSnippet())).toBe(true);
  });

  it("updates an existing snippet", () => {
    const s1 = makeSnippet({ id: "s1", name: "Original" });
    saveSnippet(s1);
    const updated = makeSnippet({ id: "s1", name: "Updated" });
    expect(updateSnippet(updated)).toBe(true);
    const loaded = loadSnippets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.name).toBe("Updated");
  });

  it("updateSnippet returns false when snippet not found", () => {
    const s1 = makeSnippet({ id: "s1" });
    saveSnippet(s1);
    expect(updateSnippet(makeSnippet({ id: "non-existent" }))).toBe(false);
  });

  it("updateSnippet returns false on localStorage write error", () => {
    saveSnippet(makeSnippet({ id: "s1" }));
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });
    expect(updateSnippet(makeSnippet({ id: "s1", name: "Updated" }))).toBe(
      false,
    );
    spy.mockRestore();
  });

  it("deleteSnippet returns false for nonexistent ID", () => {
    saveSnippet(makeSnippet({ id: "s1" }));
    expect(deleteSnippet("nonexistent")).toBe(false);
    expect(loadSnippets()).toHaveLength(1);
  });

  it("loadSnippets repairs corrupt localStorage by removing invalid entries", () => {
    const valid = makeSnippet({ id: "s1" });
    const corrupt = [valid, null, { id: 123 }, { id: "s2" }, "garbage"];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(corrupt));

    const loaded = loadSnippets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("s1");

    // Verify localStorage was repaired
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = JSON.parse(raw!);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("s1");
  });
});
