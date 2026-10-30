import { useEffect, useRef } from "react";
import type { RefObject } from "react";

type VisibleEvent = (args: Record<string, never>) => Promise<unknown>;

/**
 * Sends `onVisible` once, the first time the element scrolls into view,
 * like the standard containers. No observer is made when it is not bound.
 */
export function useVisibleOnce(
  ref: RefObject<HTMLElement | null>,
  onVisible: VisibleEvent | undefined,
) {
  const hasFired = useRef(false);
  useEffect(() => {
    const element = ref.current;
    if (!onVisible || !element || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver((entries) => {
      if (hasFired.current) return;
      if (entries.some((entry) => entry.isIntersecting)) {
        hasFired.current = true;
        void onVisible({});
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, onVisible]);
}
