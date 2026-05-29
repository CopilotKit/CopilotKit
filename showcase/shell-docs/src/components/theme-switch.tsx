"use client";

/**
 * `ThemeSwitch` — single-toggle replacement for Fumadocs's two-icon split.
 *
 * Renders a small horizontal switch (track + sliding thumb) that swaps the
 * theme between `light` and `dark` on click. The thumb itself carries the
 * currently-active icon (sun for light, moon for dark) so the control reads
 * as "current state" rather than "two equally weighted options" — same
 * affordance as the iOS-style toggle pattern.
 *
 * Why not Fumadocs's built-in `ThemeSwitch`?
 *   - The `light-dark` mode renders two `<svg>` buttons side-by-side with a
 *     1px border-left between them, which looks more like a tab pair than a
 *     toggle. Removing the divider on its own still leaves two icons; we
 *     want a single switch instead.
 *
 * Hydration: `next-themes` only resolves the theme client-side, so the
 * first render is unavoidably "indeterminate". We render the track in a
 * neutral state until `mounted` flips to true to avoid an aria/visual
 * flicker between server (no theme) and client (resolved theme).
 */

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/cn";

export function ThemeSwitch({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Before mount we don't know which theme is active, so we render the
  // track in its un-checked (light) position. `aria-checked` is intentionally
  // left as `false` here — a screen reader hitting the page mid-mount sees
  // a benign "switch, off" rather than a misleading state.
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        // Track: neutral pill (no accent tint) sized to feel like a real
        // control. Border + bg pull from the project's neutral tokens so
        // the switch reads as chrome rather than a CTA. 28px tall × 50px
        // wide leaves enough room for a comfortably-sized thumb without
        // dominating the footer row.
        "relative inline-flex h-7 w-[50px] shrink-0 cursor-pointer items-center rounded-full border border-[var(--border)] bg-[var(--bg-elevated,var(--bg-surface))] transition-colors",
        "hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border)] focus-visible:ring-offset-1",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          // Thumb: 22×22 circle that slides between the two ends. Light-
          // state: white surface with the muted-foreground icon. Dark
          // state: same neutral surface — color tracks the theme so the
          // thumb keeps reading against the track. Travel = track 50px -
          // thumb 22px - 2*3px gutters = 22px.
          "pointer-events-none flex h-[22px] w-[22px] translate-x-[3px] items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--text-secondary)] shadow-sm ring-1 ring-[var(--border)] transition-transform duration-150 ease-out",
          isDark && "translate-x-[25px]",
        )}
      >
        {isDark ? (
          <Moon className="h-[12px] w-[12px]" strokeWidth={2} />
        ) : (
          <Sun className="h-[12px] w-[12px]" strokeWidth={2} />
        )}
      </span>
    </button>
  );
}
