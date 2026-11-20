"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

const CHANGED = "canvas-changed";

/**
 * Briefly outlines what an edit changed on the canvas.
 *
 * The A2UI renderer keeps its DOM between renders and only touches what an
 * operation changed, so a MutationObserver sees exactly the edit: new nodes,
 * new text, a bar's new width, a button turned disabled. Each change lights
 * up the nearest bordered component around it (a card or a tile), or else
 * the nearest block, so a translated title or a finished goal is easy to
 * spot. On the Express path this follows the stream, piece by piece.
 *
 * Off while `enabled` is false: for the first render, where everything is
 * new, and while an older version is on screen.
 */
export function useChangeHighlight(
  root: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const host = root.current;
    if (!host || !enabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const pending = new Set<HTMLElement>();
    let frame = 0;

    const target = (node: Node): HTMLElement | null => {
      let el: HTMLElement | null =
        node instanceof HTMLElement ? node : node.parentElement;
      let block: HTMLElement | null = null;
      while (el && el !== host) {
        if (el.hasAttribute("data-a2ui-std")) {
          const style = getComputedStyle(el);
          if (parseFloat(style.borderTopWidth) > 0) return el;
          if (
            !block &&
            style.display !== "inline" &&
            style.display !== "contents"
          )
            block = el;
        }
        el = el.parentElement;
      }
      return block;
    };

    const flash = () => {
      frame = 0;
      for (const el of pending) {
        el.classList.remove(CHANGED);
        // Restart the animation when the same card changes again.
        void el.offsetWidth;
        el.classList.add(CHANGED);
        el.addEventListener(
          "animationend",
          () => el.classList.remove(CHANGED),
          {
            once: true,
          },
        );
      }
      pending.clear();
    };

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const el = target(record.target);
        if (el) pending.add(el);
      }
      if (pending.size && !frame) frame = requestAnimationFrame(flash);
    });
    observer.observe(host, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "disabled"],
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [root, enabled]);
}
