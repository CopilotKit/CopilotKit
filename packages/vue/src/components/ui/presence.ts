import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { Ref } from "vue";

/**
 * Keeps closing content mounted until its exit animation ends, like Radix's
 * Presence: the content gets `data-state="closed"`, and its CSS animation
 * (for example `cpk-tooltip-exit`) plays before it unmounts.
 * @internal
 */
export function usePresence(
  open: Ref<boolean>,
  element: Ref<HTMLElement | null | undefined>,
) {
  const present = ref(open.value);
  let finish: (() => void) | undefined;

  const stopWaiting = () => {
    finish?.();
    finish = undefined;
  };

  watch(open, async (isOpen) => {
    stopWaiting();
    if (isOpen) {
      present.value = true;
      return;
    }
    // Let `data-state="closed"` reach the DOM, so its animation starts.
    await nextTick();
    if (open.value) return;
    const node = element.value;
    const view = node?.ownerDocument.defaultView;
    const animationName = node && view?.getComputedStyle(node).animationName;
    if (!node || !view || !animationName || animationName === "none") {
      present.value = false;
      return;
    }
    const done = () => {
      stopWaiting();
      if (!open.value) present.value = false;
    };
    // A fallback, in case the animation is cancelled without an end event.
    const timer = view.setTimeout(done, 400);
    node.addEventListener("animationend", done, { once: true });
    finish = () => {
      view.clearTimeout(timer);
      node.removeEventListener("animationend", done);
    };
  });

  onBeforeUnmount(stopWaiting);

  return present;
}
