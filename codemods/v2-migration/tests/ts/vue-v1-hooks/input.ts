import { defineComponent, h, ref } from "vue";
import {
  CopilotKit,
  useCopilotAction,
  useCopilotReadable,
  useFrontendTool,
} from "@copilotkit/vue";
import type { FrontendAction } from "@copilotkit/vue";

export const Shell = defineComponent({
  setup(_, { slots }) {
    return () => h(CopilotKit, { runtimeUrl: "/api/copilotkit" }, slots);
  },
});

export const actions: FrontendAction[] = [];

export function useTodoTools() {
  const todos = ref<string[]>([]);

  useCopilotReadable({ description: "The todo list", value: todos });

  // A frontend tool: a handler and a Parameter[] list.
  useCopilotAction({
    name: "addTodo",
    description: "Add a todo",
    parameters: [
      { name: "title", type: "string", description: "The title" },
      { name: "done", type: "boolean", required: false },
    ],
    handler: ({ title }) => {
      todos.value.push(title);
    },
  });

  // Human in the loop.
  useCopilotAction({
    name: "confirmDelete",
    parameters: [{ name: "title", type: "string" }],
    renderAndWaitForResponse: ({ args, respond }) =>
      h("button", { onClick: () => respond?.(true) }, `Delete ${args.title}?`),
  });

  // Render only: the agent runs the tool, the app draws it.
  useCopilotAction({
    name: "showProgress",
    available: "frontend",
    parameters: [{ name: "percent", type: "number" }],
    render: ({ args, status }) => h("progress", { value: args.percent }, status),
  });

  // A render with no handler: v1 registered a frontend tool.
  useCopilotAction({
    name: "lookup",
    parameters: [{ name: "query", type: "string" }],
    render: ({ result }) => h("pre", result?.title),
  });

  // "remote": the tool is hidden from the agent. The deps stay.
  useCopilotAction(
    {
      name: "syncTodos",
      available: "remote",
      agentId: "planner",
      handler: () => todos.value.length,
    },
    [todos],
  );

  // The v1 shape of useFrontendTool: a Parameter[] list.
  useFrontendTool({
    name: "clearTodos",
    parameters: [{ name: "confirm", type: "boolean" }],
    handler: () => {
      todos.value = [];
    },
  });

  // Left for the TODO: v1 ignored `followUp` on a wait, drew nothing with no
  // parameters, and registered the context again when the deps changed.
  useCopilotAction({
    name: "approve",
    followUp: false,
    renderAndWaitForResponse: ({ respond }) =>
      h("button", { onClick: () => respond?.("ok") }, "Approve"),
  });
  useCopilotAction({
    name: "showStatus",
    available: "disabled",
    render: ({ status }) => h("span", status),
  });
  useCopilotReadable({ description: "Todo count", value: todos.value.length }, [todos]);
}
