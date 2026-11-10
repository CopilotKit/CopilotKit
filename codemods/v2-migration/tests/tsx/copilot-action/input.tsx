import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";

export function Tools({ items }: { items: string[] }) {
  useCopilotReadable({ description: "items", value: items });

  // A frontend tool: a handler and parameters of every kind.
  useCopilotAction({
    name: "addItem",
    description: "Add an item to the list",
    parameters: [
      { name: "title", type: "string", description: "The title" },
      { name: "priority", type: "string", enum: ["low", "high"], required: false },
      { name: "count", type: "number" },
      { name: "done", type: "boolean", required: false },
      { name: "tags", type: "string[]" },
      {
        name: "owner",
        type: "object",
        attributes: [
          { name: "id", type: "string" },
          { name: "email", required: false },
        ],
      },
      {
        name: "steps",
        type: "object[]",
        description: "The steps",
        attributes: [{ name: "label", type: "string" }],
      },
    ],
    handler: async ({ title }) => {
      console.log(title);
    },
  });

  // Human in the loop.
  useCopilotAction({
    name: "confirm",
    parameters: [{ name: "plan", type: "string" }],
    renderAndWaitForResponse: ({ args, respond }) => (
      <button onClick={() => respond?.("yes")}>{args.plan}</button>
    ),
  });

  // Render only: the agent runs the tool, the app draws it.
  useCopilotAction({
    name: "showWeather",
    description: "Weather card",
    available: "disabled",
    parameters: [{ name: "city", type: "string" }],
    render: ({ args, status }) => (
      <div>
        {status}: {args.city}
      </div>
    ),
  });

  // Render only, with no parameters, reading the props object.
  useCopilotAction({
    name: "spinner",
    render: (props) => <span>{props.status}</span>,
  });

  // Render only, with an empty parameter list.
  useCopilotAction({
    name: "budget",
    parameters: [],
    render: ({ args }) => <span>{String(args.total)}</span>,
  });

  // Uses the parsed result.
  useCopilotAction({
    name: "lookup",
    parameters: [{ name: "q", type: "string" }],
    handler: ({ q }) => ({ q }),
    render: ({ result }) => <pre>{result?.q}</pre>,
  });

  // Sync handlers: a method, and a reference to a function.
  const save = (args: { id: string }) => console.log(args.id);
  useCopilotAction({
    name: "remove",
    parameters: [{ name: "id", type: "string" }],
    handler({ id }) {
      console.log(id);
    },
  });
  useCopilotAction({
    name: "save",
    parameters: [{ name: "id", type: "string" }],
    handler: save,
  });

  // `disabled` (deprecated in v1) and the v1 `handler` render prop of HITL.
  const canApprove = items.length > 0;
  useCopilotAction({
    name: "approve",
    disabled: !canApprove,
    parameters: [{ name: "id", type: "string" }],
    renderAndWait: ({ args, handler }) => (
      <button onClick={() => handler?.(args.id)}>Approve</button>
    ),
  });

  // Left for the TODO: a catch-all and parameters that are not a literal.
  useCopilotAction({ name: "*", render: () => <></> });
  const parameters = [{ name: "x", type: "string" }] as const;
  useCopilotAction({ name: "dynamic", parameters, handler: () => {} });
  return null;
}
