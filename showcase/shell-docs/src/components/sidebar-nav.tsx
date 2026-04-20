"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Client wrapper for server-rendered sidebar content.
 * On mount and on every route change, scrolls the active nav item
 * into view so the user never loses their place in the navigation
 * hierarchy.
 *
 * We key the effect on `pathname` rather than running on every
 * render — the latter hijacks the user's own sidebar scroll on any
 * unrelated re-render (state updates, context flips, etc.).
 */
export function SidebarNav({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const active = ref.current?.querySelector('[data-active="true"]');
    if (!active) return;
    try {
      // "auto" is the spec-compliant value for "no smooth animation";
      // "instant" is a Chromium non-standard extension that other
      // engines silently ignore.
      active.scrollIntoView({ block: "nearest", behavior: "auto" });
    } catch (err) {
      // scrollIntoView can throw on detached nodes or in obscure
      // iframe/security contexts. Never let sidebar scroll restoration
      // take down the route.
      console.warn("[sidebar-nav] scrollIntoView failed", err);
    }
  }, [pathname]);

  return (
    <aside ref={ref} className={className}>
      {children}
    </aside>
  );
}
