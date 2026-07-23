"use client";

import { useEffect, useState, useCallback } from "react";

type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "dashboard:theme";

/** Resolve effective theme for the system mode. */
function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Apply the data-theme attribute on <html>. */
function applyTheme(mode: ThemeMode) {
  const html = document.documentElement;
  if (mode === "system") {
    html.setAttribute("data-theme", "system");
  } else {
    html.setAttribute("data-theme", mode);
  }
}

const MODES: ThemeMode[] = ["system", "light", "dark"];

const LABELS: Record<ThemeMode, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

/** Compact SVG icons — 14px, no external deps. */
function MonitorIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

const ICONS: Record<ThemeMode, React.ReactNode> = {
  system: <MonitorIcon />,
  light: <SunIcon />,
  dark: <MoonIcon />,
};

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");

  // On mount, read persisted preference and apply.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    const initial = stored && MODES.includes(stored) ? stored : "system";
    setMode(initial);
    applyTheme(initial);
  }, []);

  // Listen to system preference changes when in system mode.
  useEffect(() => {
    if (mode !== "system") return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [mode]);

  const cycle = useCallback(() => {
    const idx = MODES.indexOf(mode);
    const next = MODES[(idx + 1) % MODES.length];
    setMode(next);
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, [mode]);

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={cycle}
      title={`Theme: ${LABELS[mode]}`}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]
        text-[var(--text-muted)] hover:text-[var(--text-secondary)]
        border border-[var(--border)] hover:border-[var(--border-strong)]
        bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)]
        transition-colors cursor-pointer select-none"
    >
      {ICONS[mode]}
      <span>{LABELS[mode]}</span>
    </button>
  );
}
