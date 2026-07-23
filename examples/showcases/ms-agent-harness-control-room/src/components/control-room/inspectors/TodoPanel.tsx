"use client";

/**
 * Inspector panel for the agent's todo list. Native Harness primitive — no
 * wrapper badge.
 */

import { useControlRoomAgentState } from "@/hooks/use-control-room-state";
import type { ControlRoomTodo } from "@/lib/control-room-types";

export function TodoPanel() {
  const agentState = useControlRoomAgentState();
  const todos = Array.isArray(agentState.todos) ? agentState.todos : [];

  return (
    <div className="cr-card">
      <h3 className="cr-heading mb-2">Todos</h3>
      {todos.length === 0 ? (
        <p
          className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          Empty · agent will populate as it plans
        </p>
      ) : (
        <ul className="space-y-1.5">
          {todos.map((todo) => (
            <TodoRow key={todo.id} todo={todo} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TodoRow({ todo }: { todo: ControlRoomTodo }) {
  const tone =
    todo.status === "completed"
      ? "emerald"
      : todo.status === "in_progress"
        ? "amber"
        : undefined;
  const label =
    todo.status === "completed"
      ? "done"
      : todo.status === "in_progress"
        ? "running"
        : "queued";
  return (
    <li className="flex items-start gap-2 text-[11.5px] leading-snug">
      <span className="cr-chip" data-tone={tone}>
        {label}
      </span>
      <span
        className={
          todo.status === "completed"
            ? "text-[var(--cr-muted)] line-through"
            : "text-[var(--cr-fg)]"
        }
      >
        {todo.label}
      </span>
    </li>
  );
}
