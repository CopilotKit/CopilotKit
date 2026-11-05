import { useEffect } from "react";

/**
 * The open overlays (Modal dialogs, Lightboxes), newest last. One document
 * listener closes the newest one on Escape, so a Lightbox inside a Modal
 * closes alone, and the Modal only on the next Escape. Each overlay used to
 * listen on `document` itself, and `stopPropagation` does not stop the
 * other listeners of the same target.
 */
const overlays: Array<() => void> = [];
let detach: (() => void) | undefined;

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || overlays.length === 0) return;
  event.stopPropagation();
  overlays[overlays.length - 1]();
}

/**
 * Registers `close` as the newest overlay for as long as `isOpen`. The
 * overlay closes on Escape only while it is the newest.
 */
export function useOverlayEscape(isOpen: boolean, close: () => void) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = () => close();
    overlays.push(handler);
    if (!detach) {
      document.addEventListener("keydown", onKeyDown);
      detach = () => document.removeEventListener("keydown", onKeyDown);
    }
    return () => {
      const index = overlays.lastIndexOf(handler);
      if (index !== -1) overlays.splice(index, 1);
      if (overlays.length === 0 && detach) {
        detach();
        detach = undefined;
      }
    };
  }, [isOpen, close]);
}
