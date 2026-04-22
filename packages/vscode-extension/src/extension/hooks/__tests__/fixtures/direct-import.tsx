import { useCopilotAction } from "@copilotkit/react-core";

export function Todos() {
  useCopilotAction({
    name: "addTodo",
    description: "Add a todo",
    parameters: [{ name: "text", type: "string", required: true }],
    render: ({ args }) => <div>{args.text}</div>,
  });
  return null;
}
