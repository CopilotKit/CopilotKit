import { onScopeDispose } from "vue";
import type { WatchSource } from "vue";
import { h } from "vue";
import { ɵbuildHumanInTheLoopTool, ɵhitlRenderProps } from "@copilotkit/core";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useFrontendTool } from "./use-frontend-tool";
import type {
  VueFrontendTool,
  VueHumanInTheLoop,
  VueToolCallRenderer,
  VueToolCallRendererRenderProps,
} from "../types";

/**
 * Registers a human-in-the-loop frontend tool.
 *
 * The tool pauses execution until `respond` is called from the rendered
 * component during the `executing` phase. Each call waits on its own
 * `respond`, so parallel calls of one tool stay independent.
 *
 * @example
 * ```ts
 * useHumanInTheLoop({
 *   name: "approveAction",
 *   parameters: z.object({ reason: z.string() }),
 *   render: ApprovalCard,
 * });
 * ```
 */
export function useHumanInTheLoop<T extends Record<string, unknown>>(
  tool: VueHumanInTheLoop<T>,
  deps?: WatchSource<unknown>[],
) {
  const { copilotkit } = useCopilotKit();
  const registry = () => copilotkit.value.ɵhumanInTheLoop;

  const RenderComponent: VueToolCallRenderer<T>["render"] = (
    props: VueToolCallRendererRenderProps<T>,
  ) =>
    h(
      tool.render as Parameters<typeof h>[0],
      ɵhitlRenderProps<T, typeof props>(props, tool, registry()),
    );

  const frontendTool: VueFrontendTool<T> = {
    ...ɵbuildHumanInTheLoopTool<T>(tool, registry),
    render: RenderComponent,
  };

  useFrontendTool(frontendTool, deps);

  onScopeDispose(() => {
    copilotkit.value.removeHookRenderToolCall(tool.name, tool.agentId);
  });
}
