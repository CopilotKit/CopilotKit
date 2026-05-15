import { describe, it, expect } from "vitest";
import {
  manageSalesTodosImpl,
  getSalesTodosImpl,
  INITIAL_SALES_TODOS,
} from "../sales-todos";

describe("INITIAL_SALES_TODOS", () => {
  it("has 3 items", () => {
    expect(INITIAL_SALES_TODOS).toHaveLength(3);
  });

  it("has fixed IDs", () => {
    expect(INITIAL_SALES_TODOS[0].id).toBe("st-001");
    expect(INITIAL_SALES_TODOS[1].id).toBe("st-002");
    expect(INITIAL_SALES_TODOS[2].id).toBe("st-003");
  });
});

describe("manageSalesTodosImpl", () => {
  it("assigns UUID to todos missing ID", () => {
    const result = manageSalesTodosImpl([{ title: "New deal" }]);
    expect(result[0].id).toBeTruthy();
    expect(result[0].id.length).toBeGreaterThan(0);
  });

  it("preserves existing IDs", () => {
    const result = manageSalesTodosImpl([{ id: "keep-me", title: "Deal" }]);
    expect(result[0].id).toBe("keep-me");
  });

  it("provides defaults for missing fields", () => {
    const result = manageSalesTodosImpl([{ title: "Minimal" }]);
    expect(result[0].stage).toBe("prospect");
    expect(result[0].value).toBe(0);
    expect(result[0].completed).toBe(false);
    expect(result[0].dueDate).toBe("");
    expect(result[0].assignee).toBe("");
  });

  it("preserves provided fields", () => {
    const result = manageSalesTodosImpl([
      {
        id: "x",
        title: "Big Deal",
        stage: "negotiation",
        value: 50000,
        dueDate: "2026-05-01",
        assignee: "Alice",
        completed: true,
      },
    ]);
    expect(result[0].title).toBe("Big Deal");
    expect(result[0].stage).toBe("negotiation");
    expect(result[0].value).toBe(50000);
    expect(result[0].completed).toBe(true);
  });

  it("handles empty array", () => {
    const result = manageSalesTodosImpl([]);
    expect(result).toEqual([]);
  });

  it("handles multiple todos", () => {
    const result = manageSalesTodosImpl([
      { title: "A" },
      { title: "B" },
      { title: "C" },
    ]);
    expect(result).toHaveLength(3);
    // Each should get a unique ID
    const ids = new Set(result.map((r) => r.id));
    expect(ids.size).toBe(3);
  });

  it("replaces empty string id with a generated UUID", () => {
    const result = manageSalesTodosImpl([{ id: "", title: "x" }]);
    expect(result[0].id).toBeTruthy();
    expect(result[0].id).not.toBe("");
    expect(result[0].id.length).toBeGreaterThan(0);
  });
});

describe("getSalesTodosImpl", () => {
  it("returns initial todos when undefined", () => {
    const result = getSalesTodosImpl(undefined);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("st-001");
  });

  it("returns initial todos when null", () => {
    const result = getSalesTodosImpl(null);
    expect(result).toHaveLength(3);
  });

  it("returns empty array when given empty array", () => {
    const result = getSalesTodosImpl([]);
    // empty array means user cleared all todos — return empty, not defaults
    expect(result).toHaveLength(0);
  });

  it("returns provided todos when non-empty", () => {
    const todos = [
      {
        id: "1",
        title: "Test",
        stage: "prospect" as const,
        value: 100,
        dueDate: "",
        assignee: "",
        completed: false,
      },
    ];
    const result = getSalesTodosImpl(todos);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Test");
  });

  it("returns a copy, not the original INITIAL_SALES_TODOS reference", () => {
    const result = getSalesTodosImpl(undefined);
    expect(result).not.toBe(INITIAL_SALES_TODOS);
    expect(result).toEqual(INITIAL_SALES_TODOS);
  });
});
