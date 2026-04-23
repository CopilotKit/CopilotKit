import { useCopilotAction } from "@copilotkit/react-core";

// Legal in source but nonsensical at runtime — used to exercise the
// "hook-outside-component" warning path.
useCopilotAction({ name: "orphan", handler: () => {} });

export function OK() {
  useCopilotAction({ name: "fine", handler: () => {} });
  return <div />;
}
