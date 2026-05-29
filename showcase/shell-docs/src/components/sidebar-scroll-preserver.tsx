// SidebarScrollPreserver — restores the sidebar's scroll position
// across navigations.
//
// The sidebar is rendered per-page inside `ShellDocsLayout`, so each
// click on a sidebar link unmounts and remounts the whole tree. Without
// intervention the Radix ScrollAreaViewport snaps back to 0, which
// makes every navigation in a long sidebar (scroll down, click a
// section deep in the list) jarring — the item you just clicked
// disappears from view.
//
// This component:
//   1. Reads the saved scrollTop from sessionStorage on layout-effect
//      (runs synchronously before paint, so there's no flicker).
//   2. Applies it to the sidebar's `[data-radix-scroll-area-viewport]`.
//   3. Registers a passive scroll listener that writes the latest
//      scrollTop back to sessionStorage on every frame.
//
// Why sessionStorage: persists for the tab session (long enough that
// reload preserves position) but isolates per-tab so two tabs don't
// fight over a shared key.
//
// Mounted once, inside `ShellDocsLayout`. The component renders nothing
// itself — it just attaches the listener.

"use client";

import { useLayoutEffect } from "react";

const STORAGE_KEY = "shell-docs:sidebar-scroll-top";

export function SidebarScrollPreserver() {
  useLayoutEffect(() => {
    const viewport = document.querySelector<HTMLElement>(
      "aside.shell-docs-sidebar [data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;

    // Restore saved scroll position. Doing this in useLayoutEffect
    // means the assignment happens BEFORE the browser paints, so the
    // user never sees the sidebar at 0 first.
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      const top = Number.parseInt(saved, 10);
      if (Number.isFinite(top) && top > 0) {
        viewport.scrollTop = top;
      }
    }

    // Persist scroll on every change. `requestAnimationFrame`-coalesce
    // so a continuous drag/scroll-wheel doesn't pound sessionStorage.
    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        sessionStorage.setItem(STORAGE_KEY, String(viewport.scrollTop));
        rafId = null;
      });
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return null;
}
