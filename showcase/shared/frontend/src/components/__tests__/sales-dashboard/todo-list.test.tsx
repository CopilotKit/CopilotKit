import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TodoList } from "../../sales-dashboard/todo-list";
import type { SalesTodo } from "../../../types";

const activeTodo: SalesTodo = {
  id: "1",
  title: "Follow up with Acme Corp",
  stage: "qualified",
  value: 50000,
  dueDate: "2026-04-20",
  assignee: "Alice",
  completed: false,
};

const completedTodo: SalesTodo = {
  id: "2",
  title: "Close deal with BigCo",
  stage: "closed-won",
  value: 100000,
  dueDate: "2026-04-15",
  assignee: "Bob",
  completed: true,
};

describe("TodoList", () => {
  it("renders active and completed columns", () => {
    const onUpdate = vi.fn();
    render(
      <TodoList
        todos={[activeTodo, completedTodo]}
        onUpdate={onUpdate}
        isAgentRunning={false}
      />,
    );
    expect(screen.getByText("Active Deals")).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("Follow up with Acme Corp")).toBeTruthy();
    expect(screen.getByText("Close deal with BigCo")).toBeTruthy();
  });

  it("can add a new todo", () => {
    const onUpdate = vi.fn();
    render(
      <TodoList
        todos={[activeTodo]}
        onUpdate={onUpdate}
        isAgentRunning={false}
      />,
    );
    const addBtn = screen.getByLabelText("Add new deal");
    fireEvent.click(addBtn);
    expect(onUpdate).toHaveBeenCalledOnce();
    const updatedTodos = onUpdate.mock.calls[0][0] as SalesTodo[];
    expect(updatedTodos.length).toBe(2);
    expect(updatedTodos[1].title).toBe("New Deal");
    expect(updatedTodos[1].stage).toBe("prospect");
  });

  it("empty state shows placeholder", () => {
    const onUpdate = vi.fn();
    render(<TodoList todos={[]} onUpdate={onUpdate} isAgentRunning={false} />);
    expect(screen.getByText("No deals yet")).toBeTruthy();
    expect(
      screen.getByText("Create your first deal to get started"),
    ).toBeTruthy();
  });

  it("empty state has add button", () => {
    const onUpdate = vi.fn();
    render(<TodoList todos={[]} onUpdate={onUpdate} isAgentRunning={false} />);
    const addBtn = screen.getByText("Add a deal");
    expect(addBtn).toBeTruthy();
    fireEvent.click(addBtn);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("disables add button when agent is running", () => {
    const onUpdate = vi.fn();
    render(<TodoList todos={[]} onUpdate={onUpdate} isAgentRunning={true} />);
    const addBtn = screen.getByText("Add a deal") as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });
});
