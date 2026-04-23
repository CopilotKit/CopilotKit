import {
  useCopilotAction,
  useCopilotAuthenticatedAction_c,
  useLangGraphInterrupt,
} from "@copilotkit/react-core";

export function Actions() {
  // V1 render: register a todo-creation action
  useCopilotAction({
    name: "addTodo",
    description: "Add a new todo item to the board",
    parameters: [{ name: "title", type: "string" }],
    handler: async () => {},
  });

  // V1 render: authenticated action that deletes a user account
  // @ts-expect-error – test-workspace only, exact signature may vary
  useCopilotAuthenticatedAction_c({
    name: "deleteUser",
    description: "Delete a user account (requires auth)",
    parameters: [],
    handler: async () => {},
  });

  // V1 render: interrupt hook for LangGraph human-in-the-loop flows
  // @ts-expect-error – test-workspace only, exact signature may vary
  useLangGraphInterrupt({
    enabled: true,
    render: ({
      event,
      resolve,
    }: {
      event: unknown;
      resolve: (v: unknown) => void;
    }) => <div>Interrupt: approve action?</div>,
  });

  return <div>v1 actions</div>;
}
