/**
 * Sales todos tool implementation.
 *
 * TypeScript equivalent of showcase/shared/python/tools/sales_todos.py.
 */

import { SalesTodo } from "./types";

export const INITIAL_SALES_TODOS: SalesTodo[] = [
  {
    id: "st-001",
    title: "Follow up with Acme Corp on enterprise proposal",
    stage: "proposal",
    value: 85000,
    dueDate: "2026-04-15",
    assignee: "Sarah Chen",
    completed: false,
  },
  {
    id: "st-002",
    title: "Qualify lead from TechFlow demo request",
    stage: "prospect",
    value: 42000,
    dueDate: "2026-04-18",
    assignee: "Mike Johnson",
    completed: false,
  },
  {
    id: "st-003",
    title: "Send contract to DataViz Inc for final review",
    stage: "negotiation",
    value: 120000,
    dueDate: "2026-04-20",
    assignee: "Sarah Chen",
    completed: false,
  },
];

/**
 * Assign crypto.randomUUID() to any todos missing an ID, then return
 * the updated list.
 */
export function manageSalesTodosImpl(todos: Partial<SalesTodo>[]): SalesTodo[] {
  return todos.map((todo) => ({
    id: todo.id || crypto.randomUUID(),
    title: todo.title ?? "",
    stage: todo.stage ?? "prospect",
    value: todo.value ?? 0,
    dueDate: todo.dueDate ?? "",
    assignee: todo.assignee ?? "",
    completed: todo.completed ?? false,
  }));
}

/**
 * Return current todos or initial defaults if none provided.
 */
export function getSalesTodosImpl(
  currentTodos?: Partial<SalesTodo>[] | null,
): SalesTodo[] {
  if (currentTodos != null) {
    return currentTodos.length > 0 ? manageSalesTodosImpl(currentTodos) : [];
  }
  return [...INITIAL_SALES_TODOS];
}
