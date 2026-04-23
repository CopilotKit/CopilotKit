import { useCopilotAction } from "@copilotkit/react-core";

export function MyPage() {
  useCopilotAction({ name: "addTodo", handler: () => {} });
  return <div />;
}
