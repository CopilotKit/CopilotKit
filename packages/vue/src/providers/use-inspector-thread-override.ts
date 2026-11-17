import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import type { Ref } from "vue";
import { ɵInspectorThreadOverride } from "@copilotkit/core";

/**
 * Apply the Inspector's "view this thread" requests to a chat. Core's
 * `ɵInspectorThreadOverride` owns the state machine; this composable binds it
 * to the component's lifetime and Vue reactivity.
 */
export function useInspectorThreadOverride(args: {
  agentId: Ref<string>;
  baseThreadId: Ref<string>;
}): {
  inspectorThreadId: Ref<string | null>;
  inspectorRequestId: Ref<string | null>;
  failInspectorOverride: (requestId: string) => void;
} {
  const controller = new ɵInspectorThreadOverride({
    agentId: args.agentId.value,
    baseThreadId: args.baseThreadId.value,
  });
  const override = shallowRef(controller.getSnapshot());
  const unsubscribe = controller.subscribe(() => {
    override.value = controller.getSnapshot();
  });

  watch([args.agentId, args.baseThreadId], ([agentId, baseThreadId]) => {
    controller.update({ agentId, baseThreadId });
  });

  onBeforeUnmount(() => {
    unsubscribe();
    controller.dispose();
  });

  return {
    inspectorThreadId: computed(() => override.value?.threadId ?? null),
    inspectorRequestId: computed(() => override.value?.requestId ?? null),
    failInspectorOverride: controller.fail,
  };
}
