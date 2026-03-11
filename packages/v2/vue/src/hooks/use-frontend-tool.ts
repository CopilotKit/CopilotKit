import { watch } from "vue";
import type { WatchSource } from "vue";
import { useCopilotKit } from "../providers/useCopilotKit";
import type { VueFrontendTool } from "../types";
import type { VueToolCallRenderer } from "../types";

const EMPTY_DEPS: WatchSource<unknown>[] = [];

export function useFrontendTool<T extends Record<string, unknown>>(
  tool: VueFrontendTool<T>,
  deps?: WatchSource<unknown>[],
) {
  const { copilotkit } = useCopilotKit();
  const extraDeps = deps ?? EMPTY_DEPS;

  watch(
    [
      () => copilotkit.value,
      () => tool.name,
      () => tool.agentId,
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

      if (tool.render) {
        const keyOf = (rc: VueToolCallRenderer<unknown>) =>
          `${rc.agentId ?? ""}:${rc.name}`;
        const currentRenderToolCalls =
          core.renderToolCalls as VueToolCallRenderer<unknown>[];
        const mergedMap = new Map<string, VueToolCallRenderer<unknown>>();
        for (const rc of currentRenderToolCalls) {
          mergedMap.set(keyOf(rc), rc);
        }
        const newEntry = {
          name,
          args: tool.parameters,
          agentId: tool.agentId,
          render: tool.render,
        } as VueToolCallRenderer<unknown>;
        mergedMap.set(keyOf(newEntry), newEntry);
        core.setRenderToolCalls(Array.from(mergedMap.values()));
      }

      onCleanup(() => {
        core.removeTool(name, tool.agentId);
      });
    },
    { immediate: true },
  );
}
