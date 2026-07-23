import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tool, type ToolRuntime } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";

export const TodoSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string(),
  emoji: z.string(),
  status: z.enum(["pending", "completed"]),
});

export type Todo = z.infer<typeof TodoSchema>;

const TodosStateSchema = z.object({
  todos: z.array(TodoSchema),
});

export const manage_todos = tool(
  (input: { todos: Todo[] }, runtime: ToolRuntime<typeof TodosStateSchema>) => {
    const todos = input.todos.map((t) => ({
      ...t,
      id: t.id ?? randomUUID(),
    }));
    return new Command({
      update: {
        todos,
        messages: [
          new ToolMessage({
            content: "Successfully updated todos",
            tool_call_id: runtime.toolCallId,
          }),
        ],
      },
    });
  },
  {
    name: "manage_todos",
    description: "Manage the current todos.",
    schema: z.object({ todos: z.array(TodoSchema) }),
  },
);

export const get_todos = tool(
  (
    _input: Record<string, never>,
    runtime: ToolRuntime<typeof TodosStateSchema>,
  ) => {
    return JSON.stringify(runtime.state.todos ?? []);
  },
  {
    name: "get_todos",
    description: "Get the current todos.",
    schema: z.object({}),
  },
);

export const todo_tools = [manage_todos, get_todos];
