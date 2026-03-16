import { ref, watch } from "vue";
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

  watch(
    [() => copilotkit.value, () => tool.name, () => tool.agentId],
    (_newValues, _old, onCleanup) => {
      const core = copilotkit.value;
      const keyOf = (rc: VueToolCallRenderer<unknown>) =>
        `${rc.agentId ?? ""}:${rc.name}`;
      const key = keyOf({
        name: tool.name,
        agentId: tool.agentId,
      } as VueToolCallRenderer<unknown>);

      onCleanup(() => {
        const current = core.renderToolCalls as VueToolCallRenderer<unknown>[];
        const filtered = current.filter((rc) => keyOf(rc) !== key);
        core.setRenderToolCalls(filtered);
      });
    },
    { immediate: true },
  );
}
