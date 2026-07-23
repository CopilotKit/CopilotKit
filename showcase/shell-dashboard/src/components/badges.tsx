"use client";
import { useEffect, useRef, useState } from "react";
import type { BadgeTone } from "@/lib/live-status";

export const TONE_CLASS: Record<BadgeTone, string> = {
  green: "text-[var(--ok)]",
  amber: "text-[var(--amber)]",
  red: "text-[var(--danger)]",
  gray: "text-[var(--text-muted)]",
  blue: "text-[var(--accent)]",
  error: "text-[var(--text-muted)]",
};

export const DOT_BG: Record<BadgeTone, string> = {
  green: "bg-[var(--ok)]",
  amber: "bg-[var(--amber)]",
  red: "bg-[var(--danger)]",
  gray: "bg-[var(--text-muted)]",
  blue: "bg-[var(--accent)]",
  error: "bg-[var(--text-muted)]",
};

export function Badge({
  name,
  state,
  href,
  title,
  onTooltipOpen,
}: {
  name: string;
  state: { label: string; tone: BadgeTone };
  href?: string;
  title?: string;
  /** Called the first time the badge receives mouseenter/focus — drives lazy fetch. */
  onTooltipOpen?: () => void;
}) {
  const openedRef = useRef(false);
  const handleOpen = (): void => {
    if (openedRef.current) return;
    openedRef.current = true;
    onTooltipOpen?.();
  };
  // When the label is "?" (no probe data), hide the badge entirely —
  // don't show tests that don't exist.
  const isUnavailable = state.label === "?";
  if (isUnavailable) return null;

  const inner = (
    <span
      className="whitespace-nowrap"
      title={title}
      onMouseEnter={handleOpen}
      onFocus={handleOpen}
    >
      <span className="text-[var(--text-muted)]">{name}</span>{" "}
      <span className={`tabular-nums ${TONE_CLASS[state.tone]}`}>
        {state.label}
      </span>
    </span>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline"
    >
      {inner}
    </a>
  ) : (
    inner
  );
}

// Tiny square chip used in strip / grid views.
export function ToneChip({
  tone,
  title,
  label,
}: {
  tone: BadgeTone;
  title?: string;
  label?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center w-4 h-4 rounded-sm text-[9px] font-semibold text-white ${DOT_BG[tone]}`}
      title={title}
    >
      {label ?? ""}
    </span>
  );
}

/**
 * Flash wrapper — toggles `data-flash` for 150ms whenever `tone`
 * transitions (ignoring initial `gray → <tone>` settle). Background is
 * driven by CSS selector `[data-flash="1"]` in globals.css.
 */
export function FlashOnChange({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: React.ReactNode;
}) {
  const [flash, setFlash] = useState(false);
  const prevRef = useRef<BadgeTone | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = tone;
    // Ignore initial mount and the `gray → <tone>` settle transition
    // (spec §5.7 — "not a real flip").
    if (prev === null) return;
    if (prev === "gray" && tone !== "gray") return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 150);
    return () => clearTimeout(t);
  }, [tone]);

  return (
    <span
      data-flash={flash ? "1" : "0"}
      className="transition-colors duration-150 ease-out"
      style={
        flash
          ? { backgroundColor: "var(--bg-flash, rgba(255, 200, 80, 0.25))" }
          : undefined
      }
    >
      {children}
    </span>
  );
}
