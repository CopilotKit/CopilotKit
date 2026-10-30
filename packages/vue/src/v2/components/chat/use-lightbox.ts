import { nextTick, ref } from "vue";
import { useCopilotId } from "../ui/use-id";

type DocWithVT = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => {
    finished: Promise<void>;
  };
};

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
    const thumb = thumbnailRef.value;
    const doc =
      typeof document === "undefined" ? undefined : (document as DocWithVT);

    if (doc?.startViewTransition && thumb) {
      thumb.style.viewTransitionName = vtName;
      doc.startViewTransition(async () => {
        thumb.style.viewTransitionName = "";
        open.value = true;
        await nextTick();
      });
    } else {
      open.value = true;
    }
  };

  const closeLightbox = () => {
    const thumb = thumbnailRef.value;
    const doc =
      typeof document === "undefined" ? undefined : (document as DocWithVT);

    if (doc?.startViewTransition && thumb) {
      const transition = doc.startViewTransition(async () => {
        open.value = false;
        await nextTick();
        thumb.style.viewTransitionName = vtName;
      });
      const clear = () => {
        thumb.style.viewTransitionName = "";
      };
      transition.finished.then(clear, clear);
    } else {
      open.value = false;
    }
  };

  return { thumbnailRef, vtName, open, openLightbox, closeLightbox };
}
