import { defineComponent, onBeforeUnmount, onMounted } from "vue";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import type {
  CopilotThreadsDrawerProps,
  ModalThreadsDrawerProp,
} from "./types";

/**
 * Resolves a {@link ModalThreadsDrawerProp} to the drawer props to render, or
 * `null` when the drawer is off. A `threads-drawer` slot turns it on.
 */
export function resolveModalThreadsDrawerProps(
  threadsDrawer: ModalThreadsDrawerProp | undefined,
  hasDrawerSlot = false,
): CopilotThreadsDrawerProps | null {
  if (threadsDrawer && threadsDrawer !== true) return threadsDrawer;
  return threadsDrawer || hasDrawerSlot ? {} : null;
}

/**
 * Wraps the drawer a modal hosts. The header shows its launcher once a drawer
 * registers; registering here gives a `threads-drawer` slot the launcher
 * without registering itself.
 */
export const ModalThreadsDrawerHost = defineComponent({
  name: "ModalThreadsDrawerHost",
  setup(_, { slots }) {
    const config = useCopilotChatConfiguration();
    let unregister: (() => void) | undefined;
    onMounted(() => {
      unregister = config.value?.registerDrawer?.();
    });
    onBeforeUnmount(() => unregister?.());
    return () => slots.default?.();
  },
});
