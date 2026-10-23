import { describe, it, expect } from "vitest";
import { manageTodosImpl } from "../todos";

describe("board todos", () => {
  it("migrates legacy input and keeps descriptions, ids and sales metadata", () => {
    const source = [
      {
        id: "keep",
        name: "Cedar",
        notes: "Follow up Cedar",
        completed: true,
        value: 10,
      },
    ];
    expect(manageTodosImpl(source)).toEqual([
      {
        id: "keep",
        name: "Cedar",
        title: "Cedar",
        notes: "Follow up Cedar",
        description: "Follow up Cedar",
        emoji: "🎯",
        status: "completed",
        value: 10,
      },
    ]);
    expect(source[0].completed).toBe(true);
  });
  it("retains board edits through a JSON round trip", () => {
    let todos = manageTodosImpl([
      { title: "Cedar", description: "Follow up", completed: true },
    ]);
    const id = todos[0].id;
    todos[0].status = "pending";
    todos = manageTodosImpl(JSON.parse(JSON.stringify(todos)));
    expect(todos[0]).toEqual({
      id,
      title: "Cedar",
      description: "Follow up",
      emoji: "🎯",
      status: "pending",
    });
    expect(manageTodosImpl([])).toEqual([]);
  });
  it("rejects statuses the board cannot render", () => {
    expect(() =>
      manageTodosImpl([{ title: "Cedar", status: "unknown" }]),
    ).toThrow("Unsupported todo status");
  });
});
