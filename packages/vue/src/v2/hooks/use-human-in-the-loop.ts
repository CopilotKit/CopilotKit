import { onScopeDispose, ref } from "vue";
import type { WatchSource } from "vue";
import { h } from "vue";
import { ToolCallStatus } from "@copilotkit/core";
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
  const rejectPromiseRef = ref<((error: unknown) => void) | null>(null);
  const cleanupAbortRef = ref<(() => void) | null>(null);

  const respond = async (result: unknown) => {
    if (resolvePromiseRef.value) {
      cleanupAbortRef.value?.();
      cleanupAbortRef.value = null;
      resolvePromiseRef.value(result);
      resolvePromiseRef.value = null;
      rejectPromiseRef.value = null;
    }
  };

  const handler = async (_args: T, context?: { signal?: AbortSignal }) => {
    const signal = context?.signal;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Human-in-the-loop interaction aborted"));
        return;
      }

      resolvePromiseRef.value = resolve;
      rejectPromiseRef.value = reject;

      if (signal) {
        const onAbort = () => {
          cleanupAbortRef.value = null;
          resolvePromiseRef.value = null;
          const rejectPending = rejectPromiseRef.value;
          rejectPromiseRef.value = null;
          rejectPending?.(new Error("Human-in-the-loop interaction aborted"));
        };

        signal.addEventListener("abort", onAbort, { once: true });
        cleanupAbortRef.value = () => {
          signal.removeEventListener("abort", onAbort);
        };
      }
    });
  };

  const RenderComponent: VueToolCallRenderer<T>["render"] = (
    props: VueToolCallRendererRenderProps<T>,
  ) => {
    const ToolComponent = tool.render;
    if (props.status === ToolCallStatus.InProgress) {
      return h(ToolComponent as Parameters<typeof h>[0], {
        ...props,
        name: tool.name,
        description: tool.description || "",
        agentId: tool.agentId,
        respond: undefined,
      });
    }
    if (props.status === ToolCallStatus.Executing) {
      return h(ToolComponent as Parameters<typeof h>[0], {
        ...props,
        name: tool.name,
        description: tool.description || "",
        agentId: tool.agentId,
        respond,
      });
    }
    if (props.status === ToolCallStatus.Complete) {
      return h(ToolComponent as Parameters<typeof h>[0], {
        ...props,
        name: tool.name,
        description: tool.description || "",
        agentId: tool.agentId,
        respond: undefined,
      });
    }

    const exhaustiveCheck: never = props;
    return exhaustiveCheck;
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
