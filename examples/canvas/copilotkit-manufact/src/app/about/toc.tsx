"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface TocItem {
  id: string;
  label: string;
}

export function AboutToc({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    const elements = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Track every observed entry's most-recent state, then pick the
        // top-most intersecting section. Using a single "find highest entry"
        // pass per callback misses sections that left the viewport in this
        // batch but are still the active anchor.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      {
        // Bias toward the section that's anchored near the top of the
        // viewport — fires when a section's heading is roughly in the top
        // third of the screen.
        rootMargin: "-80px 0px -60% 0px",
        threshold: 0,
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  return (
    // `position: sticky` + `align-self: flex-start` on the same element:
    // self-start keeps the aside content-sized (so it fits in the corner),
    // and putting `sticky` directly on the aside (rather than a nested nav)
    // means its containing block is the parent flex row — which is the full
    // article height. That gives sticky room to actually stick as you scroll.
    <aside
      aria-label="On this page"
      className="sticky top-12 hidden w-60 shrink-0 self-start rounded-xl border bg-card p-5 shadow-sm lg:block"
    >
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        On this page
      </p>
      <ul className="space-y-1 border-l">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={cn(
                  "-ml-px block border-l py-1 pl-3 text-sm transition-colors",
                  isActive
                    ? "border-accent font-medium text-accent"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                aria-current={isActive ? "true" : undefined}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
