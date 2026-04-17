import { useCopilotAction as useAct } from "@copilotkit/react-core";

export function X() {
  useAct({ name: "aliasedAction", render: () => <div /> });
  return null;
}
