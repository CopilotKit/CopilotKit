"use client";

import { useEffect } from "react";

const TRIGGER = "[data-base-ui-navigation-menu-trigger]";
// Base UI's PATIENT_CLICK_THRESHOLD: a click this soon after a hover opened
// the menu is taken as "open it", not "close it".
const PATIENT_CLICK_MS = 500;

/**
 * Keeps a navbar menu open when a reader moves from one open menu to another
 * and clicks it.
 *
 * With one menu open, hovering another trigger switches the popup to it.
 * Base UI 1.9 then forgets that hover opened it, so the click that follows
 * closes the menu the reader just reached. Base UI already ignores such a
 * click after a hover opens a closed menu; this gives a hover switch the
 * same grace. The listener runs in the capture phase on the navbar, so it
 * stops the click before React's handlers at the root see it.
 */
export function useMenuSwitchClick() {
  useEffect(() => {
    const nav = document.getElementById("nd-nav");
    if (!nav) return;
    let switched: { trigger: Element; at: number } | null = null;

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const trigger = (event.target as Element).closest(TRIGGER);
      if (!trigger || trigger.getAttribute("aria-expanded") === "true") return;
      if (switched?.trigger === trigger) return;
      const otherOpen = nav.querySelector(`${TRIGGER}[aria-expanded="true"]`);
      switched = otherOpen ? { trigger, at: performance.now() } : null;
    };
    const onClick = (event: MouseEvent) => {
      const trigger = (event.target as Element).closest(TRIGGER);
      if (
        trigger &&
        switched?.trigger === trigger &&
        trigger.getAttribute("aria-expanded") === "true" &&
        performance.now() - switched.at < PATIENT_CLICK_MS
      ) {
        event.stopPropagation();
      }
      switched = null;
    };

    nav.addEventListener("pointerover", onPointerOver, true);
    nav.addEventListener("click", onClick, true);
    return () => {
      nav.removeEventListener("pointerover", onPointerOver, true);
      nav.removeEventListener("click", onClick, true);
    };
  }, []);
}
