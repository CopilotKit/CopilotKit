// TODO(copilotkit-2.0): `useCopilotAction` was removed in 2.0. Use `useFrontendTool` from "@copilotkit/react-core" instead. Its API is different: https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
// TODO(copilotkit-2.0): `useCopilotReadable` was removed in 2.0. Use `useAgentContext` from "@copilotkit/react-core" instead. Its API is different: https://docs.copilotkit.ai/reference/v2/hooks/useAgentContext
// TODO(copilotkit-2.0): `useCopilotReadable`: V2 models readable application state as agent context.
import { useCopilotAction, useFrontendTool, useHumanInTheLoop, useRenderTool, useCopilotReadable } from "@copilotkit/react-core";
import { z } from "zod";

export function Tools({ items }: { items: string[] }) {
  useCopilotReadable({ description: "items", value: items });

  // A frontend tool: a handler and parameters of every kind.
  useFrontendTool({
    name: "addItem",
    description: "Add an item to the list",
    parameters: z.object({
      title: z.string().describe("The title"),
      priority: z.enum(["low", "high"]).optional(),
      count: z.number(),
      done: z.boolean().optional(),
      tags: z.array(z.string()),
      owner: z.object({
        id: z.string(),
        email: z.string().optional(),
      }),
      steps: z.array(z.object({
        label: z.string(),
      })).describe("The steps"),
    }),
    handler: async ({ title }) => {
      console.log(title);
    },
  });

  // Human in the loop.
  useHumanInTheLoop({
    name: "confirm",
    parameters: z.object({
      plan: z.string(),
    }),
    render: ({ args, respond }) => (
      <button onClick={() => respond?.("yes")}>{args.plan}</button>
    ),
  });

  // Render only: the agent runs the tool, the app draws it.
  useRenderTool({
    name: "showWeather",
    parameters: z.object({
      city: z.string(),
    }),
    render: ({ parameters: args, status }) => (
      <div>
        {status}: {args.city}
      </div>
    ),
  });

  // Render only, with no parameters, reading the props object.
  useRenderTool({
    name: "spinner",
    parameters: z.record(z.string(), z.any()),
    render: (props) => <span>{props.status}</span>,
  });

  // Render only, with an empty parameter list.
  useRenderTool({
    name: "budget",
    parameters: z.record(z.string(), z.any()),
    render: ({ parameters: args }) => <span>{String(args.total)}</span>,
  });

  // Uses the parsed result.
  // TODO(copilotkit-2.0): `result` is the tool's result as a string in 2.0; v1 parsed it as JSON first. Parse it with `JSON.parse` where you need the object. https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
  useFrontendTool({
    name: "lookup",
    parameters: z.object({
      q: z.string(),
    }),
    handler: ({ q }) => ({ q }),
    render: ({ result }) => <pre>{result?.q}</pre>,
  });

  // Sync handlers: a method, and a reference to a function.
  const save = (args: { id: string }) => console.log(args.id);
  useFrontendTool({
    name: "remove",
    parameters: z.object({
      id: z.string(),
    }),
    handler({ id }) {
      console.log(id);
    },
  });
  useFrontendTool({
    name: "save",
    parameters: z.object({
      id: z.string(),
    }),
    handler: save,
  });

  // `disabled` (deprecated in v1) and the v1 `handler` render prop of HITL.
  const canApprove = items.length > 0;
  useHumanInTheLoop({
    name: "approve",
    available: canApprove,
    parameters: z.object({
      id: z.string(),
    }),
    render: ({ args, respond: handler }) => (
      <button onClick={() => handler?.(args.id)}>Approve</button>
    ),
  });

  // Left for the TODO: a catch-all and parameters that are not a literal.
  useCopilotAction({ name: "*", render: () => <></> });
  const parameters = [{ name: "x", type: "string" }] as const;
  useCopilotAction({ name: "dynamic", parameters, handler: () => {} });
  return null;
}
