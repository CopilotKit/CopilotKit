import { watch } from "vue";
import { ɵregisterFrontendTools } from "@copilotkit/core";
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
 * while this scope is active, with a console warning. When the scope is
 * disposed, the earlier tool is active again.
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
      // Registrations stack in core: this one shadows an earlier tool with the
      // same name and agentId (a provider tool, or another component's), and
      // unregistering it brings that tool back. The renderer stays registered
      // so past calls still render in the chat history.
      onCleanup(
        ɵregisterFrontendTools(core, [tool], (renderer) =>
          core.addHookRenderToolCall(renderer as VueToolCallRenderer),
        ),
      );
    },
    { immediate: true },
  );
}
