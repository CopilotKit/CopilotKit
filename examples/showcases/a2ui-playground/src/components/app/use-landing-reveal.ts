"use client";

/**
 * The transitions.dev reveal, one component at a time, for a surface in the conversation that streams.
 *
 * The runtime (use-ui-generation.ts) reveals a whole UI that arrives at once. A streamed surface instead
 * stands as dotted frames (Blueprint) that the model fills one by one, so each component that lands gets
 * the runtime's reveal phase in CSS: `[data-gen-land]` in globals.css, `gen-scan-in` in motion.css.
 *
 * React inserts a component that mounts as one finished subtree, so watching what is added to the surface
 * finds exactly what landed, and only its outermost component is marked: a card that arrives with its
 * children reveals once, not once per child. Nothing is marked while the runtime itself is drawing or
 * holding the surface, or once the run is over (a tab switched later does not replay the reveal).
 */
import { useEffect, useRef } from "react";

const WRAPPER = ".a2-node, .a2-std";
const ATTR = "data-gen-land";
/** Longer than the reveal (828ms), so the mark is gone before anything could move the element and replay it. */
const CLEAR_MS = 1000;

/** The elements that draw a component: its wrapper is `display: contents`, so they are the ones under it. */
function boxes(el: Element): Element[] {
  if (getComputedStyle(el).display !== "contents") return [el];
  return Array.from(el.children).flatMap(boxes);
}

/** The outermost components in a subtree that was just added: the node itself, or the first ones under it. */
function landed(node: Element): Element[] {
  if (node.matches(WRAPPER)) return [node];
  return Array.from(node.querySelectorAll(WRAPPER)).filter((w) => {
    const up = w.parentElement?.closest(WRAPPER);
    return !up || !node.contains(up);
  });
}

export function useLandingReveal(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const on = useRef(enabled);
  on.current = enabled;

  useEffect(() => {
    const host = ref.current;
    // Only the conversation's floors draw the reveal (its CSS is scoped to `.wb-floor`).
    if (
      !host ||
      !host.closest(".wb-floor") ||
      typeof MutationObserver === "undefined"
    )
      return;
    const timers = new Set<number>();
    const mo = new MutationObserver((records) => {
      // The runtime hides the surface (opacity 0) from its first frame until its own reveal.
      if (!on.current || host.style.opacity === "0") return;
      for (const rec of records) {
        for (const node of Array.from(rec.addedNodes)) {
          if (!(node instanceof Element)) continue;
          for (const w of landed(node)) {
            if (w.matches('[data-a2-type="Blueprint"]')) continue;
            for (const el of boxes(w)) {
              if (el.classList.contains("a2-blueprint")) continue;
              el.setAttribute(ATTR, "");
              const t = window.setTimeout(() => {
                timers.delete(t);
                el.removeAttribute(ATTR);
              }, CLEAR_MS);
              timers.add(t);
            }
          }
        }
      }
    });
    mo.observe(host, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      timers.forEach((t) => clearTimeout(t));
      host
        .querySelectorAll(`[${ATTR}]`)
        .forEach((el) => el.removeAttribute(ATTR));
    };
  }, [ref]);
}
