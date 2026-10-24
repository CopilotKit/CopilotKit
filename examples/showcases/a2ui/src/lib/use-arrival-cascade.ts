import { useEffect } from "react";
import type { RefObject } from "react";

/** The gap between two components entering. */
const STAGGER_MS = 90;
/** The most a component waits, so a big burst never lags the stream. */
const MAX_WAIT_MS = 720;

/**
 * While `active` (the agent is writing the view), gives each component that
 * mounts inside `root` an entrance in turn. The model often sends several
 * lines in one chunk; queued 90 ms apart, they still assemble one by one.
 * Only the outermost new components animate; their children come with them.
 */
export function useArrivalCascade(
  root: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    const element = root.current;
    if (!active || !element) return;
    let nextSlot = 0;
    const observer = new MutationObserver((records) => {
      const added: HTMLElement[] = [];
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches("[data-a2ui-std]")) added.push(node);
          added.push(...node.querySelectorAll<HTMLElement>("[data-a2ui-std]"));
        }
      }
      const outermost = added.filter(
        (candidate) =>
          !added.some(
            (other) => other !== candidate && other.contains(candidate),
          ),
      );
      const now = performance.now();
      for (const component of outermost) {
        const wait = Math.min(MAX_WAIT_MS, Math.max(0, nextSlot - now));
        nextSlot = now + wait + STAGGER_MS;
        component.style.setProperty("--arrive-delay", `${Math.round(wait)}ms`);
        component.setAttribute("data-arrive", "");
      }
    });
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root, active]);
}
