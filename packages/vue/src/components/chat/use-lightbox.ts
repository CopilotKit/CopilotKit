import { nextTick, ref } from "vue";
import { ɵmorphViewTransition } from "@copilotkit/core";
import { useCopilotId } from "../ui/use-id";

/**
 * Opens and closes a lightbox, using the View Transition API to morph the
 * thumbnail into the full-screen content, as React's `useLightbox`.
 *
 * `view-transition-name` must be on exactly one element at a time: on the
 * thumbnail in the old state, and on the lightbox content (bind `vtName` to
 * it) in the new one. The transition callback waits for Vue to render the
 * change, so the API can snapshot old and new correctly.
 * @internal
 */
export function useLightbox() {
  const thumbnailRef = ref<HTMLElement | null>(null);
  const open = ref(false);
  // A custom ident: Vue's ids can hold characters CSS does not allow there.
  const vtName = useCopilotId("cpk-lightbox").replace(/[^\w-]/g, "-");

  const openLightbox = () => {
    ɵmorphViewTransition(
      thumbnailRef.value,
      vtName,
      async () => {
        open.value = true;
        await nextTick();
      },
      "open",
    );
  };

  const closeLightbox = () => {
    ɵmorphViewTransition(
      thumbnailRef.value,
      vtName,
      async () => {
        open.value = false;
        await nextTick();
      },
      "close",
    );
  };

  return { thumbnailRef, vtName, open, openLightbox, closeLightbox };
}
