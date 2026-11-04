"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "repo-doctor-theme";

/**
 * Runs in <head> before first paint, so the page never flashes the wrong
 * theme. A stored choice wins; otherwise the system preference decides.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);}catch(e){document.documentElement.classList.toggle("dark",window.matchMedia("(prefers-color-scheme: dark)").matches);}})();`;

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function storedChoice(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  // Follow the system only until the user picks a theme.
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = (event: MediaQueryListEvent) => {
    if (!storedChoice()) apply(event.matches ? "dark" : "light");
  };
  media.addEventListener("change", onSystemChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onSystemChange);
  };
}

/** The active theme, read from the <html> class, plus a toggle that remembers it. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  // The server cannot know the theme; the pre-paint script settles it.
  const theme = useSyncExternalStore(
    subscribe,
    current,
    () => "light" as Theme,
  );

  const toggle = useCallback(() => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    apply(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode or blocked storage: the choice lasts for this page only.
    }
  }, []);

  return { theme, toggle };
}
