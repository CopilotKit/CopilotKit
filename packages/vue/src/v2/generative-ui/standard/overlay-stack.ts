import { onScopeDispose, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";

/**
 * The open overlays (Modal dialogs, Lightboxes), newest last. One document
 * listener closes the newest one on Escape, so a Lightbox inside a Modal
 * closes alone, and the Modal only on the next Escape. Separate listeners
 * on `document` cannot do this: `stopPropagation` does not stop the other
 * listeners of the same target.
 */
const overlays: Array<() => void> = [];
let detach: (() => void) | undefined;

function onKeyDown(event: KeyboardEvent) {
  const newest = overlays[overlays.length - 1];
  if (event.key !== "Escape" || !newest) return;
  event.stopPropagation();
  newest();
}

/**
 * Registers `close` as the newest overlay while `isOpen` is true. The
 * overlay closes on Escape only while it is the newest. It is removed when
 * `isOpen` turns false or the component unmounts. On the server it does
 * nothing.
 *
 * @param isOpen - A ref or a getter, for example `() => props.open`.
 * @param close - Closes the overlay.
 *
 * @example
 * ```ts
 * const isOpen = ref(false);
 * useOverlayEscape(isOpen, () => (isOpen.value = false));
 * ```
 */
export function useOverlayEscape(
  isOpen: MaybeRefOrGetter<boolean>,
  close: () => void,
) {
  if (typeof document === "undefined") return;
  let handler: (() => void) | undefined;
  const unregister = () => {
    if (!handler) return;
    const index = overlays.lastIndexOf(handler);
    if (index !== -1) overlays.splice(index, 1);
    handler = undefined;
    if (overlays.length === 0 && detach) {
      detach();
      detach = undefined;
    }
  };
  const register = () => {
    handler = () => close();
    overlays.push(handler);
    if (detach) return;
    document.addEventListener("keydown", onKeyDown);
    detach = () => document.removeEventListener("keydown", onKeyDown);
  };
  watch(
    () => toValue(isOpen),
    (open) => {
      unregister();
      if (open) register();
    },
    { immediate: true },
  );
  onScopeDispose(unregister);
}
