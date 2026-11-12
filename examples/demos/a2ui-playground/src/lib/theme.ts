"use client";

/**
 * Light or dark. The site is light unless the visitor picked dark with the header's toggle, or the page was
 * opened with `?theme=dark` (how a dark page embeds it). Dark is the `dark` class on <html>, which is also
 * what switches the standard components to their theme's `dark` values.
 */
import { useSyncExternalStore } from "react";
import { THEME_KEY } from "./theme-script";

export type Theme = "light" | "dark";

const read = (): Theme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

const subscribe = (fn: () => void) => {
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => mo.disconnect();
};

export const useTheme = (): Theme =>
  useSyncExternalStore(subscribe, read, () => "light");

/** The toggle's pick, remembered for the next visit. An embed's `?theme=` is never stored. */
export function setTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked (a private window, a sandboxed embed): the pick lasts until the page reloads.
  }
}
