"use client";

import { useEffect, useRef } from "react";

/**
 * Client wrapper for server-rendered sidebar content.
 * On mount (and on every re-render triggered by route change),
 * scrolls the active nav item into view so the user never loses
 * their place in the navigation hierarchy.
 */
export function SidebarNav({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const active = ref.current?.querySelector('[data-active="true"]');
    if (active) {
      active.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  });

  return (
    <aside ref={ref} className={className}>
      {children}
    </aside>
  );
}
