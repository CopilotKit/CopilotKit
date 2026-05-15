import { onScopeDispose, ref } from "vue";
import type { WatchSource } from "vue";
import { h } from "vue";
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
 * component during the `executing` phase.
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
  const resolvePromiseRef = ref<((result: unknown) => void) | null>(null);

  const respond = async (result: unknown) => {
    if (resolvePromiseRef.value) {
      resolvePromiseRef.value(result);
      resolvePromiseRef.value = null;
    }
  };

  const handler = async () => {
    return new Promise((resolve) => {
      resolvePromiseRef.value = resolve;
    });
  };

  const RenderComponent: VueToolCallRenderer<T>["render"] = (
    props: VueToolCallRendererRenderProps<T>,
  ) => {
    const ToolComponent = tool.render;
    if (props.status === "inProgress") {
      return h(ToolComponent as Parameters<typeof h>[0], {
        ...props,
        name: tool.name,
        description: tool.description || "",
        respond: undefined,
      });
    }
    if (props.status === "executing") {
      return h(ToolComponent as Parameters<typeof h>[0], {
        ...props,
        name: tool.name,
        description: tool.description || "",
        respond,
      });
    }
    if (props.status === "complete") {
      return h(ToolComponent as Parameters<typeof h>[0], {
        ...props,
        name: tool.name,
        description: tool.description || "",
        respond: undefined,
      });
    }
    return h(ToolComponent as Parameters<typeof h>[0], props);
  };

  const frontendTool: VueFrontendTool<T> = {
    ...tool,
    handler,
    render: RenderComponent,
  };

  useFrontendTool(frontendTool, deps);

  onScopeDispose(() => {
    copilotkit.value.removeHookRenderToolCall(tool.name, tool.agentId);
  });
}
