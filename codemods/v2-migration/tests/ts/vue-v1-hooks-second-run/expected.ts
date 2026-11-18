import { defineComponent, h, ref } from "vue";
// TODO(copilotkit-2.0): `useCopilotAction` was removed in 2.0. Use `useFrontendTool` from "@copilotkit/vue" instead. Its API is different: https://docs.copilotkit.ai/reference/vue/hooks/useFrontendTool
// TODO(copilotkit-2.0): `useCopilotAction`: For `renderAndWaitForResponse`, use `useHumanInTheLoop`. For a render-only action (`available: "frontend"` or `"disabled"`) or a catch-all (`name: "*"`), use `useRenderTool`.
// TODO(copilotkit-2.0): `useCopilotReadable` was removed in 2.0. Use `useAgentContext` from "@copilotkit/vue" instead. Its API is different: https://docs.copilotkit.ai/reference/vue/hooks/useAgentContext
// TODO(copilotkit-2.0): `useCopilotReadable`: `useAgentContext` takes no deps and returns no id. To keep the context current, pass a ref, a getter or a reactive object as `value`.
// TODO(copilotkit-2.0): `useFrontendTool`: The v2 API uses a Zod schema instead of the v1 Parameter[] shape. https://docs.copilotkit.ai/reference/vue/hooks/useFrontendTool
import {
  CopilotKit,
  useCopilotAction, useHumanInTheLoop, useRenderTool,
  useCopilotReadable, useAgentContext,
  useFrontendTool,
} from "@copilotkit/vue";
// TODO(copilotkit-2.0): `FrontendAction` was removed in 2.0. Use `VueFrontendTool` from "@copilotkit/vue" instead. Its API is different: https://docs.copilotkit.ai/reference/vue/hooks/useFrontendTool
import type { FrontendAction } from "@copilotkit/vue";
import { z } from "zod";

export const Shell = defineComponent({
  setup(_, { slots }) {
    return () => h(CopilotKit, { runtimeUrl: "/api/copilotkit" }, slots);
  },
});

export const actions: FrontendAction[] = [];

export function useTodoTools() {
  const todos = ref<string[]>([]);

  useAgentContext({ description: "The todo list", value: todos });

  // A frontend tool: a handler and a Parameter[] list.
  useFrontendTool({
    name: "addTodo",
    description: "Add a todo",
    parameters: z.object({
      title: z.string().describe("The title"),
      done: z.boolean().optional(),
    }),
    handler: ({ title }) => {
      todos.value.push(title);
    },
  });

  // Human in the loop.
  useHumanInTheLoop({
    name: "confirmDelete",
    parameters: z.object({
      title: z.string(),
    }),
    render: ({ args, respond }) =>
      h("button", { onClick: () => respond?.(true) }, `Delete ${args.title}?`),
  });

  // Render only: the agent runs the tool, the app draws it.
  useRenderTool({
    name: "showProgress",
    parameters: z.object({
      percent: z.number(),
    }),
    render: ({ parameters: args, status }) => h("progress", { value: args.percent }, status),
  });

  // A render with no handler: v1 registered a frontend tool.
  // TODO(copilotkit-2.0): `result` is the tool's result as a string in 2.0; v1 parsed it as JSON first. Parse it with `JSON.parse` where you need the object. https://docs.copilotkit.ai/reference/vue/hooks/useFrontendTool
  useFrontendTool({
    name: "lookup",
    parameters: z.object({
      query: z.string(),
    }),
    render: ({ result }) => h("pre", result?.title),
  });

  // "remote": the tool is hidden from the agent. The deps stay.
  useFrontendTool(
    {
      name: "syncTodos",
      available: false,
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
