"use client";

// Progress bar for client navigations. Docs routes render on demand
// (`force-dynamic`), so without it a click shows no feedback until the next
// page's payload and chunks arrive.
//
// Rendered right after <BrandNav />: the bar mounts into the zero-height anchor
// below and is drawn along the nav's bottom edge (see globals.css), not at the
// top of the viewport, where it would sit on the purple announcement banner.
// The color is the theme's primary token, so it follows light and dark mode
// (`.dark` swaps `--primary`, which `--color-fd-primary` resolves through).
// `delay` keeps fast navigations from flashing the bar. bprogress starts on
// link clicks at the document level, so it doesn't need to wrap the page.

import { ProgressProvider } from "@bprogress/next/app";

const ANCHOR_ID = "shell-docs-nav-progress";

export function NavigationProgress() {
  return (
    <>
      <div
        id={ANCHOR_ID}
        aria-hidden="true"
        className="relative h-0 w-full shrink-0"
      />
      <ProgressProvider
        color="var(--color-fd-primary)"
        height="2px"
        delay={150}
        options={{ showSpinner: false, parent: `#${ANCHOR_ID}` }}
        shallowRouting
      />
    </>
  );
}
