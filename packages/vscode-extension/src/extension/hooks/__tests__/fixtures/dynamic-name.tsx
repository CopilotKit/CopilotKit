import { useCopilotAction } from "@copilotkit/react-core";

export function D() {
  const actionName = "dyn";
  useCopilotAction({ name: actionName, render: () => <div /> });
  return null;
}
