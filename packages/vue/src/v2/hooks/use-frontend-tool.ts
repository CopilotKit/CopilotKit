import { watch } from "vue";
import type { WatchSource } from "vue";
import { useCopilotKit } from "../providers/useCopilotKit";
import type { VueFrontendTool } from "../types";
import type { VueToolCallRenderer } from "../types";

const EMPTY_DEPS: WatchSource<unknown>[] = [];

/**
 * Registers a frontend tool and optional renderer with CopilotKit core.
 *
 * The tool registration is reactive to provided dependencies and is cleaned up
 * automatically when the current scope is disposed.
 *
 * @example
 * ```ts
 * useFrontendTool({
 *   name: "sayHello",
 *   parameters: z.object({ name: z.string() }),
 *   handler: async ({ name }) => `Hello ${name}`,
 * });
 * ```
 */
export function useFrontendTool<T extends Record<string, unknown>>(
  tool: VueFrontendTool<T>,
  deps?: WatchSource<unknown>[],
) {
  const { copilotkit } = useCopilotKit();
  const extraDeps = deps ?? EMPTY_DEPS;

  watch(
    [
      () => tool.name,
      () => tool.available,
      () => extraDeps.length,
      ...extraDeps,
    ],
    (_newValues, _old, onCleanup) => {
      const core = copilotkit.value;
      const name = tool.name;

      if (core.getTool({ toolName: name, agentId: tool.agentId })) {
        console.warn(
          `Tool '${name}' already exists for agent '${tool.agentId || "global"}'. Overriding with latest registration.`,
        );
        core.removeTool(name, tool.agentId);
      }
      core.addTool(tool);

      // The render function is registered even when tool.parameters is
      // undefined — tools like HITL confirm dialogs have no parameters
      // but still need their UI rendered in the chat.
      if (tool.render) {
        core.addHookRenderToolCall({
          name,
          args: tool.parameters,
          agentId: tool.agentId,
          render: tool.render,
        } as VueToolCallRenderer<unknown>);
      }

      onCleanup(() => {
        core.removeTool(name, tool.agentId);
      });
    },
    { immediate: true },
  );
}
