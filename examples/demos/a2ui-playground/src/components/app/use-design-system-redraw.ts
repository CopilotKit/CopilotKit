"use client";

/**
 * The run key for `useUIGeneration` that redraws a surface when the visitor switches design system.
 *
 * Without it a switch swaps the look in one frame. With it, a surface on screen plays the same
 * transitions.dev drawing a generated UI arrives with, over the surface as it now is: nothing remounts
 * (the design systems swap leaf components only), so an input keeps what was typed. The surface is hidden
 * before the new look paints, so it never flashes ahead of the drawing.
 *
 * A surface scrolled out of view, one still streaming (`enabled` false) and every surface under reduced
 * motion just take the new look.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { useDesignSystem } from "@/design-systems/context";
import { scrollParent } from "./use-ui-generation";

const reduced = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Whether any of the element shows in the window and in the scroller it sits in. */
function onScreen(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const v = scrollParent(el)?.getBoundingClientRect() ?? {
    top: 0,
    bottom: window.innerHeight,
  };
  return (
    r.bottom > Math.max(0, v.top) &&
    r.top < Math.min(window.innerHeight, v.bottom)
  );
}

/**
 * `base` is the key the surface plays without a switch (its first drawing, or null for none); it is
 * returned until a switch redraws the surface, and again once `base` itself changes (a replay restarted).
 */
export function useDesignSystemRedraw(
  host: React.RefObject<HTMLElement | null>,
  { base, enabled }: { base: string | null; enabled: boolean },
): string | null {
  const ds = useDesignSystem().id;
  const shown = useRef(ds);
  const count = useRef(0);
  const [redraw, setRedraw] = useState<{ base: string | null; key: string }>();

  // Before paint: the switch has just re-rendered the surface in the new design system.
  useLayoutEffect(() => {
    if (shown.current === ds) return;
    shown.current = ds;
    const el = host.current;
    if (!enabled || !el || reduced() || !onScreen(el)) return;
    // useUIGeneration keeps it hidden from its first frame and restores it at the end of its reveal.
    el.style.opacity = "0";
    setRedraw({ base, key: `${base ?? "surface"}~${ds}~${++count.current}` });
  }, [ds, enabled, host, base]);

  return redraw && redraw.base === base ? redraw.key : base;
}
