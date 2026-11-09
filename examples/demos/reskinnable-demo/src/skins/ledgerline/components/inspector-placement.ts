"use client";

import { useEffect } from "react";

/**
 * Ledgerline docks the chat on the right, which is exactly where the
 * CopilotKit Inspector launcher sits by default (top-right of the viewport):
 * it would cover the chat header's swap and close controls. While this skin is
 * mounted, an Inspector launcher the presenter has not dragged is moved into
 * the sidebar's empty lower stretch, just above its Reset controls, clear of
 * the chat and of the page content.
 *
 * The launcher's position lives in one localStorage record shared by every
 * skin, so leaving Ledgerline puts the default (top-right) back. A position
 * the presenter chose by dragging is never touched.
 *
 * This reaches into the launcher's element state (`contextState`,
 * `hasCustomPosition`, `applyAnchorPosition`) because the Inspector has no
 * public placement option yet. If those ever change shape, this does nothing.
 */

const TAG = "cpk-web-inspector";
const STORAGE_KEY = "cpk:inspector:state";
const EDGE = 16;

interface Placement {
  anchor: { horizontal: "left" | "right"; vertical: "top" | "bottom" };
  anchorOffset: { x: number; y: number };
}

interface InspectorElement extends HTMLElement {
  updateComplete?: Promise<unknown>;
  hasCustomPosition?: { button?: boolean };
  contextState?: { button?: Placement };
  applyAnchorPosition?: (context: "button") => void;
}

const DEFAULT: Placement = {
  anchor: { horizontal: "right", vertical: "top" },
  anchorOffset: { x: EDGE, y: EDGE },
};

function place(el: InspectorElement, placement: Placement): boolean {
  const button = el.contextState?.button;
  if (!button || typeof el.applyAnchorPosition !== "function") return false;
  if (el.hasCustomPosition?.button) return true; // the presenter's choice wins
  button.anchor = { ...placement.anchor };
  button.anchorOffset = { ...placement.anchorOffset };
  el.applyAnchorPosition("button");
  return true;
}

/** Puts the shared stored launcher position back to the default, unless dragged. */
function restoreStoredDefault(): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw) as {
      button?: Placement & { hasCustomPosition?: boolean };
    };
    if (!state.button || state.button.hasCustomPosition) return;
    state.button = { ...state.button, ...DEFAULT };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked or unreadable: the launcher keeps whatever it had.
  }
}

export function useInspectorClearOfChat(): void {
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let found: InspectorElement | null = null;

    // In the sidebar's empty stretch, just above its Reset footer.
    const placement = (): Placement => {
      const nav = document.querySelector("[data-ledgerline-nav]");
      const footer = nav?.lastElementChild;
      const x = nav ? Math.round(nav.getBoundingClientRect().left) + 12 : EDGE;
      const y = footer
        ? Math.round(window.innerHeight - footer.getBoundingClientRect().top) +
          12
        : EDGE;
      return {
        anchor: { horizontal: "left", vertical: "bottom" },
        anchorOffset: { x, y },
      };
    };

    const attempt = async () => {
      if (cancelled) return;
      const el = document.querySelector<InspectorElement>(TAG);
      if (el) {
        await el.updateComplete;
        if (cancelled) return;
        if (place(el, placement())) {
          found = el;
          return;
        }
      }
      // The Inspector mounts with the runtime; give it up to ten seconds.
      if (++tries < 40) window.setTimeout(() => void attempt(), 250);
    };
    void attempt();
    // A tab closed on Ledgerline must not leave the shared record moved for
    // the next skin opened. Reloading Ledgerline simply moves it again.
    window.addEventListener("pagehide", restoreStoredDefault);

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", restoreStoredDefault);
      if (found?.isConnected) place(found, DEFAULT);
      restoreStoredDefault();
    };
  }, []);
}
