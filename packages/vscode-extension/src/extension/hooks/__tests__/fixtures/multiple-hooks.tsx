import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";

export function M() {
  useCopilotAction({ name: "a", render: () => <div /> });
  useCopilotAction({ name: "b", render: () => <div /> });
  useCopilotReadable({ description: "ctx", value: 1 });
  return null;
}
