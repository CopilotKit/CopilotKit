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
 * A tool with the same name and `agentId` as a tool that is already
 * registered (for example a provider `frontendTools` entry) takes its place
 * while this scope is active. When the scope is disposed, the earlier tool is
 * active again.
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
      // webmcp is commonly an object literal, so compare it by value to avoid
      // re-registering on identity churn while still reacting to real changes.
      () => JSON.stringify(tool.webmcp ?? null),
      () => extraDeps.length,
      ...extraDeps,
    ],
    (_newValues, _old, onCleanup) => {
      const core = copilotkit.value;
      const name = tool.name;

      // Registrations stack in core: this one shadows an earlier tool with the
      // same name and agentId (a provider tool, or another component's), and
      // unregistering it brings that tool back.
      const unregister = core.addTool(tool);

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

      onCleanup(unregister);
    },
    { immediate: true },
  );
}
