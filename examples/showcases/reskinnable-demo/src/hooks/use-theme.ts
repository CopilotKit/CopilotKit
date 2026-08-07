"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

type Theme = "dark" | "light" | "system";

function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

function applyTheme(theme: Theme) {
  const root = window.document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(resolveTheme(theme));
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem("theme") as Theme | null) ?? "system";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setThemeValue = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
  };

  return { theme, setTheme: setThemeValue };
}

/**
 * Reconcile the global `.dark` signal on <html> with the ACTIVE skin's declared
 * dark capability, so a light-only skin never inherits a dark theme left behind
 * by a dark-capable one.
 *
 * The theme toggle persists the user's choice to localStorage and toggles
 * `.dark` on <html>; that class is GLOBAL, but only skins that ship a dark
 * palette react to it in their own tokens. A light-only skin (no
 * `.dark .theme-<id>` block) keeps its own light tokens, yet the SHARED chat
 * chrome — scoped to the `.dark` ancestor — would still flip to dark, so the
 * app renders half-dark after e.g. toggling dark on banking then switching to
 * airline (a client-side nav that never clears the class).
 *
 * A skin declares dark capability with `--nw-dark-capable: 1` on its theme root
 * (see the skin's theme.css). This hook reads that inherited property from a
 * node INSIDE the theme root and:
 *   - capable  → honor the stored preference (restores the user's dark choice);
 *   - not      → force light, WITHOUT touching localStorage, so switching back
 *                to a dark-capable skin restores the choice.
 *
 * Declaring capability is opt-IN for the special case (dark support); a
 * light-only skin needs no defensive code — omitting the property is enough, so
 * future skins are not forced to guard against this defensively. Runs in a
 * layout effect so the reconciliation lands before paint (no flash of
 * mismatched dark chrome after a client-side skin switch).
 *
 * A dark-ONLY skin (no light palette at all) additionally sets
 * `--nw-theme-lock: dark` alongside `--nw-dark-capable: 1`, which forces dark
 * regardless of the stored preference — see the branch below for why that is a
 * lock rather than a default.
 */
export function useSkinThemeReconcile(
  themeRootRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const el = themeRootRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const capable = style.getPropertyValue("--nw-dark-capable").trim() === "1";
    if (!capable) {
      applyTheme("light");
      return;
    }
    // A dark-ONLY skin declares `--nw-theme-lock: dark`: it ships a dark palette
    // and no light one, so honouring a stored `light` here would put `.light` on
    // <html>, take the shared chat chrome light, and leave the skin's app card
    // dark — the same half-dark mismatch the force-light branch above prevents
    // from the other direction. Like that branch, this does NOT touch
    // localStorage, so the user's choice survives for dual-palette skins.
    if (style.getPropertyValue("--nw-theme-lock").trim() === "dark") {
      applyTheme("dark");
      return;
    }
    applyTheme(readStoredTheme());
    // themeRootRef identity is stable; this intentionally runs once per skin
    // mount (SkinRuntime remounts keyed by skin id, so this reconciles on every
    // skin switch and on direct navigation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
