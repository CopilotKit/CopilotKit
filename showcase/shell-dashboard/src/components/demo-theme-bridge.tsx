"use client";

import { useEffect } from "react";
import { installThemeBridge } from "../../../integrations/_shared/ts/theme";
import type { ThemeSource } from "../../../integrations/_shared/ts/theme";

/**
 * The dashboard's resolved theme. `data-theme` on <html> is "light", "dark",
 * or "system" (see theme-toggle.tsx); "system" follows the OS preference, so
 * a change to either can change the theme.
 */
function dataThemeSource(): ThemeSource {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  return {
    get: () => {
      const mode = document.documentElement.getAttribute("data-theme");
      if (mode === "light" || mode === "dark") return mode;
      return media.matches ? "dark" : "light";
    },
    subscribe: (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      media.addEventListener("change", onChange);
      return () => {
        observer.disconnect();
        media.removeEventListener("change", onChange);
      };
    },
  };
}

/**
 * Keeps embedded demos (link previews) on the dashboard's theme, with the
 * same protocol as the other shells
 * (`showcase/integrations/_shared/ts/theme.ts`).
 */
export function DemoThemeBridge() {
  useEffect(() => installThemeBridge(window, dataThemeSource()), []);
  return null;
}
