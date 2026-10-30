"use client";

/**
 * Thin React wrapper around the transitions.dev UI generation runtime (src/vendor/transitions).
 *
 * The runtime measures a real element once and plays: dot field, guides, outline, parts, then the
 * scan-line reveal. It has no progress control and cannot extend a run, so for a streaming surface we:
 *  1. hide the surface when its first frame lands (`runKey` set),
 *  2. start once real content (text) is in and the DOM has been quiet for SETTLE ms, or MAX_WAIT ms after
 *     the first frame at the latest, so fixed templates (whole tree at tool pick, data a moment later) are
 *     measured complete and dynamic ones never wait long,
 *  3. let anything that streams in during the run come in with the runtime's own reveal.
 * Total hold on real content is at most MAX_WAIT + the runtime's reveal point (about 0.74 x duration).
 *
 * The runtime puts its overlay on document.body at page coordinates. Our surfaces live in scrollers
 * (chat, landing stage, /watch canvas), so while a run is live we keep the overlay pinned to the element
 * and clipped to the nearest scrolling ancestor. The layer also follows the element's height, so the step
 * line stays under a surface that keeps growing (the wireframe itself is what was measured at the start).
 */
import { useEffect, useRef, useState } from "react";
import {
  generate,
  type GenerateOptions,
  type GenerateRun,
} from "@/vendor/transitions/ui-generation.js";

const SETTLE = 250;
const MAX_WAIT = 900;

type GenEl = HTMLElement & {
  __tGenLayer?: HTMLElement;
  __tGenOpacity?: string;
};

const reduced = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (
    let p = el.parentElement;
    p && p !== document.body;
    p = p.parentElement
  ) {
    // Only a real vertical scroller: overflow-x: auto alone also computes overflow-y to auto.
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1)
      return p;
  }
  return null;
}

export type UseUIGenerationOptions = Omit<GenerateOptions, "onDone"> & {
  /** A new value plays a new run on the element. null = nothing to play yet. */
  runKey: string | null;
  /** false cancels any run and shows the element as it is. */
  enabled?: boolean;
};

export function useUIGeneration(
  ref: React.RefObject<HTMLElement | null>,
  { runKey, enabled = true, ...opts }: UseUIGenerationOptions,
) {
  const [running, setRunning] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const el = ref.current as GenEl | null;
    if (!el || !runKey || !enabled) return;
    let run: GenerateRun | null = null;
    let cancelled = false;
    let raf = 0;
    let settleTimer = 0;
    const first = performance.now();

    // Hidden from the first frame; the runtime restores this opacity at the end of its reveal.
    el.__tGenOpacity = "";
    el.style.opacity = "0";
    setRunning(true);

    const follow = () => {
      const layer = el.__tGenLayer;
      if (layer?.isConnected) {
        const R = el.getBoundingClientRect();
        layer.style.left = `${R.left + window.scrollX}px`;
        layer.style.top = `${R.top + window.scrollY}px`;
        layer.style.height = `${R.height}px`;
        const sc = scrollParent(el);
        if (sc) {
          const S = sc.getBoundingClientRect();
          const l = S.left - R.left,
            t = S.top - R.top,
            r = S.right - R.left,
            b = S.bottom - R.top;
          layer.style.clipPath = `polygon(${l}px ${t}px, ${r}px ${t}px, ${r}px ${b}px, ${l}px ${b}px)`;
        }
      }
      raf = requestAnimationFrame(follow);
    };

    let started = false;
    const start = async () => {
      if (started) return;
      started = true;
      mo.disconnect();
      clearTimeout(settleTimer);
      await document.fonts?.ready;
      if (cancelled) return;
      run = generate(el, { ...optsRef.current });
      raf = requestAnimationFrame(follow);
      await run.finished;
      cancelAnimationFrame(raf);
      if (!cancelled) setRunning(false);
    };

    const arm = () => {
      clearTimeout(settleTimer);
      const left = MAX_WAIT - (performance.now() - first);
      if (left <= 0) return void start();
      // Blueprint slots carry no text: wait for the first real content unless the cap is reached.
      const hasContent = (el.textContent ?? "").trim().length > 0;
      settleTimer = window.setTimeout(
        hasContent ? start : arm,
        Math.min(hasContent ? SETTLE : 100, left),
      );
    };
    const mo = new MutationObserver(arm);
    if (reduced()) start();
    else {
      mo.observe(el, { childList: true, subtree: true, characterData: true });
      arm();
    }

    return () => {
      cancelled = true;
      mo.disconnect();
      clearTimeout(settleTimer);
      cancelAnimationFrame(raf);
      if (run) run.cancel();
      else el.style.opacity = "";
      setRunning(false);
    };
  }, [ref, runKey, enabled]);

  return running;
}
