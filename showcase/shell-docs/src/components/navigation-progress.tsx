"use client";

// Progress bar for client navigations. Docs pages render on request (no
// `generateStaticParams`, no `loading.tsx`), so without it a click shows no
// feedback until the next page's payload and chunks arrive.
//
// Fumadocs ships no navigation indicator, so this uses bprogress at its
// default spot: a 2px bar fixed along the top of the viewport, outside the
// Fumadocs layouts, so none of their styles change. The color is the theme's
// primary token (lilac ink; dark: lilac), so it follows light and dark mode.
// bprogress stops the bar when the pathname changes.
//
// Link clicks start the bar here rather than through bprogress, whose
// `delay` can leave it running: each start() replaces the pending timer
// without clearing it, so a double-click on a link that loads within the
// delay starts the bar after the navigation has already stopped it. Here a
// click replaces any pending start, and any route commit (including Back and
// Forward) cancels it, so the delay (fast navigations don't flash the bar)
// stays without that.

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useProgress } from "@bprogress/next";
import { ProgressProvider } from "@bprogress/next/app";

const START_DELAY_MS = 150;

function StartOnLinkClick() {
  const { start } = useProgress();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // A route committed: whatever the pending start was for has landed.
  useEffect(() => clearTimeout(timer.current), [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, location.href);
      // Other sites, and same-page links (#anchors, query-only changes).
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname) return;
      const from = location.pathname;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        // The URL changes at commit, just before the effect above runs.
        if (location.pathname === from) start();
      }, START_DELAY_MS);
    };
    // Capture phase, like bprogress: sees clicks a component stops bubbling.
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimeout(timer.current);
    };
  }, [start]);

  return null;
}

export function NavigationProgress() {
  return (
    <ProgressProvider
      color="var(--color-fd-primary)"
      height="2px"
      options={{ showSpinner: false }}
      shallowRouting
      disableAnchorClick
    >
      <StartOnLinkClick />
    </ProgressProvider>
  );
}
