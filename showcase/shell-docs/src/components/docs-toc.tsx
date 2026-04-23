"use client";

import { useEffect, useState } from "react";
import type { TocHeading } from "@/lib/toc";

export interface DocsTocProps {
  headings: TocHeading[];
}

// Right-rail TOC. Hidden below xl (1280px) because the main column
// already fills most of the viewport at laptop widths. Above that, it
// sits beside the content with a scrollspy-highlighted active link.
export function DocsToc({ headings }: DocsTocProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(
    headings[0]?.slug ?? null,
  );

  useEffect(() => {
    if (headings.length === 0) return;

    const targets = headings
      .map((h) => document.getElementById(h.slug))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    // Mark a heading active once its top crosses ~20% from the top of
    // the viewport. `-20% 0px -70% 0px` creates a narrow "active band"
    // near the top so a heading activates as it scrolls into reading
    // position, not when it merely enters the viewport from the bottom.
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.filter((e) => e.isIntersecting);
        if (intersecting.length === 0) return;
        intersecting.sort(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
        );
        setActiveSlug(intersecting[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <aside className="hidden xl:block w-[200px] shrink-0 sticky top-0 self-start max-h-screen overflow-y-auto py-8 pl-6 pr-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mb-3">
        On this page
      </div>
      <nav className="flex flex-col gap-1 text-[12px] leading-relaxed">
        {headings.map((h) => {
          const isActive = activeSlug === h.slug;
          return (
            <a
              key={h.slug}
              href={`#${h.slug}`}
              // Sync the highlight immediately on click. The
              // IntersectionObserver can't take over here because the
              // anchor jump lands the target above the active band
              // (which starts ~20% from the top of the viewport), so
              // no intersection fires and the last-active slug would
              // otherwise stay selected.
              onClick={() => setActiveSlug(h.slug)}
              className={`block transition-colors ${
                h.depth === 3 ? "pl-3" : ""
              } ${
                isActive
                  ? "text-[var(--accent)] font-medium"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {h.text}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
