"use client";

// Progress bar for client navigations. Docs pages render on request (no
// `generateStaticParams`, no `loading.tsx`), so without it a click shows no
// feedback until the next page's payload and chunks arrive.
//
// Fumadocs ships no navigation indicator, so this uses bprogress at its
// default spot: a 2px bar fixed along the top of the viewport, outside the
// Fumadocs layouts, so none of their styles change. The color is the theme's
// primary token (lilac ink; dark: lilac), so it follows light and dark mode.
// `delay` keeps fast navigations from flashing the bar. bprogress starts on
// link clicks at the document level, so it doesn't need to wrap the page.

import { ProgressProvider } from "@bprogress/next/app";

export function NavigationProgress() {
  return (
    <ProgressProvider
      color="var(--color-fd-primary)"
      height="2px"
      delay={150}
      options={{ showSpinner: false }}
      shallowRouting
    />
  );
}
