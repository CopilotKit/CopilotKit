"use client";

import { useSyncExternalStore } from "react";

/**
 * Light/dark toggle for the top nav. The inline theme script in
 * `app/theme-script.ts` sets `class="dark"` on <html> before paint (from
 * this toggle's stored choice, an embedding page, or the system
 * preference); this button reads that class and flips it, storing the
 * explicit choice in `localStorage.theme`.
 *
 * Hydration: the server can't know the theme, so the first render shows
 * the light icon and switches once hydrated.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

const isDarkNow = () => document.documentElement.classList.contains("dark");

export function ThemeSwitch() {
  const isDark = useSyncExternalStore(subscribe, isDarkNow, () => false);
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = isDark ? "light" : "dark";
        try {
          localStorage.setItem("theme", next);
        } catch {
          // Storage blocked — the choice still applies to this page view.
        }
        document.documentElement.classList.toggle("dark", next === "dark");
      }}
      className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
    >
      {/* Lucide `moon-star` / `sun-medium`, inlined like the nav's other icons. */}
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {isDark ? (
          <>
            <path d="M18 5h4" />
            <path d="M20 3v4" />
            <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 3v1" />
            <path d="M12 20v1" />
            <path d="M3 12h1" />
            <path d="M20 12h1" />
            <path d="m18.364 5.636-.707.707" />
            <path d="m6.343 17.657-.707.707" />
            <path d="m5.636 5.636.707.707" />
            <path d="m17.657 17.657.707.707" />
          </>
        )}
      </svg>
    </button>
  );
}
