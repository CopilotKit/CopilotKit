"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Returns true for ~2s whenever `id` newly enters `highlightedLeadIds`. The
 * pulse signal is purely temporal — separate from the persistent "currently
 * highlighted" pill style on `LeadCard`.
 *
 * Mounting a card while the id is already in the list does NOT trigger a
 * pulse; only freshly added ids pulse. This lets the agent batch-highlight
 * ten cards and have all ten pulse together when the prop changes, without
 * pulsing every time the user scrolls or re-renders.
 */
export function usePulse(id: string, highlightedLeadIds: string[]): boolean {
  const [pulsing, setPulsing] = useState(false);
  const wasHighlighted = useRef<boolean>(highlightedLeadIds.includes(id));

  useEffect(() => {
    const isNow = highlightedLeadIds.includes(id);
    if (isNow && !wasHighlighted.current) {
      setPulsing(true);
      const t = window.setTimeout(() => setPulsing(false), 2000);
      wasHighlighted.current = true;
      return () => window.clearTimeout(t);
    }
    wasHighlighted.current = isNow;
    return undefined;
  }, [id, highlightedLeadIds]);

  return pulsing;
}

/**
 * Smooth integer count-up to `value` over `durationMs`. Used by metrics
 * tiles so numbers animate when the agent mutates state instead of
 * snapping to the new value.
 */
export function useCountUp(value: number, durationMs = 300): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startedRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (display === value) return;
    fromRef.current = display;
    startedRef.current = null;

    const step = (ts: number) => {
      if (startedRef.current == null) startedRef.current = ts;
      const elapsed = ts - startedRef.current;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out cubic — finishes feeling "settled" not "abrupt"
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(fromRef.current + (value - fromRef.current) * eased);
      setDisplay(next);
      if (t < 1) {
        rafRef.current = window.requestAnimationFrame(step);
      } else {
        setDisplay(value);
      }
    };

    rafRef.current = window.requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
    // We deliberately omit `display` from deps so we don't re-trigger the
    // animation while it's mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return display;
}
