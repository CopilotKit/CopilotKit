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
//   4. Marks the scroll frame when more content exists above or below,
//      allowing CSS to render subtle edge shadows as scroll affordances.
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
    const scrollFrame = viewport.parentElement;
    if (scrollFrame) {
      scrollFrame.dataset.shellDocsScrollFrame = "";
    }

    const updateScrollEdges = () => {
      if (!scrollFrame) return;
      const hasContentAbove = viewport.scrollTop > 1;
      const hasContentBelow =
        viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;
      scrollFrame.toggleAttribute(
        "data-shell-docs-scroll-shadow-top",
        hasContentAbove,
      );
      scrollFrame.toggleAttribute(
        "data-shell-docs-scroll-shadow-bottom",
        hasContentBelow,
      );
    };

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
    updateScrollEdges();

    // Persist scroll on every change. `requestAnimationFrame`-coalesce
    // so a continuous drag/scroll-wheel doesn't pound sessionStorage.
    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        sessionStorage.setItem(STORAGE_KEY, String(viewport.scrollTop));
        updateScrollEdges();
        rafId = null;
      });
    };
    const content = viewport.firstElementChild;
    const resizeObserver = new ResizeObserver(updateScrollEdges);
    resizeObserver.observe(viewport);
    if (content) resizeObserver.observe(content);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (scrollFrame) {
        delete scrollFrame.dataset.shellDocsScrollFrame;
        scrollFrame.removeAttribute("data-shell-docs-scroll-shadow-top");
        scrollFrame.removeAttribute("data-shell-docs-scroll-shadow-bottom");
      }
    };
  }, []);

  return null;
}
