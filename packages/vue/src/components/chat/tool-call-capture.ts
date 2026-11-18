import { defineComponent, h, ref, watch } from "vue";
import type { PropType, Ref } from "vue";
import type { CopilotKitCore } from "@copilotkit/core";

/**
 * Whether interaction capture is configured on the core. Driven by the
 * learning config, not by the Trajectory, so a wrapper keyed on it does not
 * remount the tool UI on every reconnect.
 * @internal
 */
export function useLearningConfigured(
  copilotkit: Ref<CopilotKitCore>,
): Readonly<Ref<boolean>> {
  const configured = ref(false);
  watch(
    copilotkit,
    (core, _previous, onCleanup) => {
      configured.value = core.ɵlearningConfigured;
      onCleanup(
        core.ɵsubscribeToLearningConfigured(() => {
          configured.value = core.ɵlearningConfigured;
        }),
      );
    },
    { immediate: true },
  );
  return configured;
}

/**
 * Wraps a tool call's UI in `data-tool-call-id` while learning is configured,
 * so interaction capture can attribute clicks to the tool call. The wrapper
 * uses `display: contents`, so it does not change the layout.
 * @internal
 */
export const ToolCallCaptureScope = defineComponent({
  name: "ToolCallCaptureScope",
  props: {
    toolCallId: { type: String, required: true },
    enabled: { type: Boolean as PropType<boolean>, required: true },
  },
  setup(props, { slots }) {
    return () =>
      props.enabled
        ? h(
            "div",
            {
              "data-tool-call-id": props.toolCallId,
              style: { display: "contents" },
            },
            slots.default?.(),
          )
        : slots.default?.();
  },
});
