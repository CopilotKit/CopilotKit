import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TodoCard } from "../../sales-dashboard/todo-card";
import type { SalesTodo } from "../../../types";

const baseTodo: SalesTodo = {
  id: "1",
  title: "Follow up with Acme Corp",
  stage: "qualified",
  value: 50000,
  dueDate: "2026-04-20",
  assignee: "Alice",
  completed: false,
};

const noopHandlers = {
  onToggleCompleted: vi.fn(),
  onDelete: vi.fn(),
  onUpdateTitle: vi.fn(),
  onUpdateStage: vi.fn(),
  onUpdateValue: vi.fn(),
};

describe("TodoCard", () => {
  it("renders todo title", () => {
    render(<TodoCard todo={baseTodo} {...noopHandlers} />);
    expect(screen.getByText("Follow up with Acme Corp")).toBeTruthy();
  });

  it("shows stage badge", () => {
    render(<TodoCard todo={baseTodo} {...noopHandlers} />);
    expect(screen.getByText("qualified")).toBeTruthy();
  });

  it("shows stage badge with correct color class for prospect", () => {
    const prospectTodo = { ...baseTodo, stage: "prospect" as const };
    const { container } = render(
      <TodoCard todo={prospectTodo} {...noopHandlers} />,
    );
    const badge = container.querySelector(".bg-blue-100");
    expect(badge).toBeTruthy();
  });

  it("shows stage badge with correct color class for closed-won", () => {
    const wonTodo = { ...baseTodo, stage: "closed-won" as const };
    const { container } = render(<TodoCard todo={wonTodo} {...noopHandlers} />);
    const badge = container.querySelector(".bg-green-100");
    expect(badge).toBeTruthy();
  });

  it("shows formatted currency value", () => {
    render(<TodoCard todo={baseTodo} {...noopHandlers} />);
    expect(screen.getByText("$50,000")).toBeTruthy();
  });

  it("shows assignee", () => {
    render(<TodoCard todo={baseTodo} {...noopHandlers} />);
    expect(screen.getByText("Alice")).toBeTruthy();
  });

  it("shows due date", () => {
    render(<TodoCard todo={baseTodo} {...noopHandlers} />);
    expect(screen.getByText("Due 2026-04-20")).toBeTruthy();
  });

  it("checkbox toggles completion", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <TodoCard
        todo={baseTodo}
        {...noopHandlers}
        onToggleCompleted={onToggle}
      />,
    );
    // The checkbox is the first button (before the delete button)
    const buttons = container.querySelectorAll("button");
    // Delete button has aria-label, checkbox does not
    const checkbox = Array.from(buttons).find(
      (btn) => !btn.getAttribute("aria-label"),
    );
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox!);
    expect(onToggle).toHaveBeenCalledWith(baseTodo);
  });

  it("delete button calls handler", () => {
    const onDelete = vi.fn();
    render(<TodoCard todo={baseTodo} {...noopHandlers} onDelete={onDelete} />);
    const deleteBtn = screen.getByLabelText("Delete deal");
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith(baseTodo);
  });

  it("applies reduced opacity when completed", () => {
    const completedTodo = { ...baseTodo, completed: true };
    const { container } = render(
      <TodoCard todo={completedTodo} {...noopHandlers} />,
    );
    expect(container.firstChild).toBeTruthy();
    expect((container.firstChild as HTMLElement).className).toContain(
      "opacity-60",
    );
  });

  describe("inline title editing", () => {
    let onUpdateTitle: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      onUpdateTitle = vi.fn();
    });

    it("clicking title text enters edit mode with an input", () => {
      render(
        <TodoCard
          todo={baseTodo}
          {...noopHandlers}
          onUpdateTitle={onUpdateTitle}
        />,
      );
      const titleDiv = screen.getByText("Follow up with Acme Corp");
      fireEvent.click(titleDiv);
      const input = screen.getByDisplayValue("Follow up with Acme Corp");
      expect(input.tagName).toBe("INPUT");
    });

    it("typing new title and pressing Enter calls onUpdateTitle", () => {
      render(
        <TodoCard
          todo={baseTodo}
          {...noopHandlers}
          onUpdateTitle={onUpdateTitle}
        />,
      );
      fireEvent.click(screen.getByText("Follow up with Acme Corp"));
      const input = screen.getByDisplayValue("Follow up with Acme Corp");
      fireEvent.change(input, { target: { value: "New Deal Title" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onUpdateTitle).toHaveBeenCalledWith("1", "New Deal Title");
    });

    it("pressing Escape cancels editing without calling onUpdateTitle", () => {
      render(
        <TodoCard
          todo={baseTodo}
          {...noopHandlers}
          onUpdateTitle={onUpdateTitle}
        />,
      );
      fireEvent.click(screen.getByText("Follow up with Acme Corp"));
      const input = screen.getByDisplayValue("Follow up with Acme Corp");
      fireEvent.change(input, { target: { value: "Changed" } });
      fireEvent.keyDown(input, { key: "Escape" });
      // Should revert to original title text (not input)
      expect(screen.getByText("Follow up with Acme Corp")).toBeTruthy();
      expect(onUpdateTitle).not.toHaveBeenCalled();
    });

    it("blur saves the title", () => {
      render(
        <TodoCard
          todo={baseTodo}
          {...noopHandlers}
          onUpdateTitle={onUpdateTitle}
        />,
      );
      fireEvent.click(screen.getByText("Follow up with Acme Corp"));
      const input = screen.getByDisplayValue("Follow up with Acme Corp");
      fireEvent.change(input, { target: { value: "Blur Save Title" } });
      fireEvent.blur(input);
      expect(onUpdateTitle).toHaveBeenCalledWith("1", "Blur Save Title");
    });

    it("empty title after trim does not save", () => {
      render(
        <TodoCard
          todo={baseTodo}
          {...noopHandlers}
          onUpdateTitle={onUpdateTitle}
        />,
      );
      fireEvent.click(screen.getByText("Follow up with Acme Corp"));
      const input = screen.getByDisplayValue("Follow up with Acme Corp");
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onUpdateTitle).not.toHaveBeenCalled();
    });
  });
});
