import { useCopilotAction } from "@copilotkit/react-core";

export function TodoActions() {
  useCopilotAction({
    name: "addTodo",
    description: "Add a todo item",
    parameters: [{ name: "text", type: "string", required: true }],
    available: "frontend",
    render: ({ args, status }) => (
      <div data-testid="add-todo-render">
        Add: {args?.text} ({status})
      </div>
    ),
  });
  useCopilotAction({
    name: "removeTodo",
    description: "Remove a todo",
    parameters: [{ name: "id", type: "string", required: true }],
    available: "frontend",
    render: ({ args }) => (
      <div data-testid="remove-todo-render">Remove: {args?.id}</div>
    ),
  });
  return null;
}

export default TodoActions;
