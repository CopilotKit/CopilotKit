import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";

export function MyPage() {
  useCopilotAction({ name: "addTodo", handler: () => {} });
  useCopilotReadable({ description: "todos", value: [] });
  return <div />;
}

export function Sidebar() {
  useCopilotAction({ name: "removeTodo", handler: () => {} });
  return <aside />;
}
