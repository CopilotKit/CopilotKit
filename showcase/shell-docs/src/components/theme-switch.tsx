"use client";

/**
 * `ThemeSwitch` — single-button replacement for Fumadocs's two-icon split.
 *
 * Renders a compact icon button that displays the current resolved theme and
 * swaps between `light` and `dark` on click. The site itself defaults to the
 * user's system preference via RootProvider's `defaultTheme: "system"`; once
 * clicked, this button stores the opposite explicit theme through next-themes.
 *
 * Why not Fumadocs's built-in `ThemeSwitch`?
 *   - The `light-dark` mode renders two `<svg>` buttons side-by-side with a
 *     1px border-left between them, which looks more like a tab pair than a
 *     toggle. Removing the divider on its own still leaves two icons; we
 *     want a single switch instead.
 *
 * Hydration: `next-themes` only resolves the theme client-side, so the first
 * render is unavoidably indeterminate. We render the light-mode current icon
 * until `mounted` flips to true; the first-paint script in layout.tsx already
 * applies the correct html class before this button hydrates.
 */

import * as React from "react";
import { useTheme } from "next-themes";
import { MoonStar, SunMedium } from "lucide-react";

import { cn } from "@/lib/cn";

export function ThemeSwitch({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";
  const nextTheme = isDark ? "light" : "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";
  const Icon = isDark ? MoonStar : SunMedium;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(nextTheme)}
      className={cn(
        "shell-docs-radius-control flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border)] focus-visible:ring-offset-1",
        className,
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
