"use client";
import { useEffect, useRef, useState } from "react";
import type { BadgeTone } from "@/lib/live-status";
import { glyphForMark, glyphTitle } from "@/lib/glyphs";
import type { GlyphBorder, GlyphTone } from "@/lib/glyphs";

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

/* ------------------------------------------------------------------ */
/*  The ONLY two ways a vocabulary glyph reaches the DOM               */
/* ------------------------------------------------------------------ */

/**
 * Text colour per palette role. Green/amber/red are VERDICT-only; slate is the
 * only absence colour; indigo is the only fault colour — see `glyphs.ts`.
 */
const GLYPH_TEXT: Record<GlyphTone, string> = {
  ok: "text-[var(--ok)]",
  amber: "text-[var(--amber)]",
  danger: "text-[var(--danger)]",
  slate: "text-[var(--text-muted)]",
  indigo: "text-indigo-500 dark:text-indigo-300",
};

/** Border colour for the HOLLOW chip form (same role palette, 60% alpha). */
const GLYPH_BORDER_COLOR: Record<GlyphTone, string> = {
  ok: "border-[var(--ok)]/60",
  amber: "border-[var(--amber)]/60",
  danger: "border-[var(--danger)]/60",
  slate: "border-[var(--text-muted)]/60",
  indigo: "border-indigo-500/60 dark:border-indigo-300/60",
};

const GLYPH_BORDER_STYLE: Record<GlyphBorder, string> = {
  solid: "border-solid",
  dashed: "border-dashed",
  dotted: "border-dotted",
};

/** Background fill for the SOLID (verdict) chip form. */
const GLYPH_BG: Record<GlyphTone, string> = {
  ok: "bg-[var(--ok)]",
  amber: "bg-[var(--amber)]",
  danger: "bg-[var(--danger)]",
  slate: "bg-[var(--text-muted)]",
  indigo: "bg-indigo-500",
};

/**
 * The hairline dotted underline that separates an absence mark from a verdict
 * mark WITHOUT colour — the one cue a greyscale or colour-blind reader has on a
 * bare mark, where there is no border to style.
 */
export const ABSENCE_UNDERLINE =
  "underline decoration-dotted decoration-1 underline-offset-2";

/**
 * A vocabulary glyph in CHIP form — the cell's one filled-or-hollow object.
 *
 * FILLED when a verdict exists (`✓ ~ ✗`): tone in the background, glyph forced
 * white, so the chip makes exactly one colour claim. HOLLOW when nothing was
 * judged (`∅ · ? — ! ⟳`): transparent background, tone in the glyph AND in a
 * 1px border whose STYLE is the colour-free second cut.
 *
 * Marks outside the vocabulary (the level strip's `U`/`W`/`C`/`T` letters) fall
 * back to the legacy `tone`-driven filled chip.
 */
export function StatusChip({
  label,
  tone,
  title,
  size = "sm",
  testId,
  dataAttrs,
}: {
  label?: string;
  /** Legacy tone, used only for marks outside the glyph vocabulary. */
  tone: BadgeTone;
  title?: string;
  /** `sm` = the 16x16 grid chip; `md` = the 32x20 depth-chip footprint. */
  size?: "sm" | "md";
  testId?: string;
  /** Extra `data-*` attributes threaded onto the chip (e.g. `data-status`). */
  dataAttrs?: Record<string, string>;
}) {
  const box =
    size === "sm"
      ? "w-4 h-4 rounded-sm text-[10px]"
      : "min-w-[32px] h-5 px-1.5 rounded text-[10px] tabular-nums";
  const common = `inline-flex items-center justify-center leading-none font-semibold border ${box}`;
  const spec = label ? glyphForMark(label) : undefined;

  if (spec && spec.glyphClass === "absence") {
    return (
      <span
        data-testid={testId}
        {...dataAttrs}
        data-glyph={spec.id}
        data-glyph-form="hollow"
        className={`${common} bg-transparent ${GLYPH_BORDER_STYLE[spec.border]} ${GLYPH_BORDER_COLOR[spec.tone]} ${GLYPH_TEXT[spec.tone]}`}
        title={title}
      >
        {spec.mark}
      </span>
    );
  }

  const fill = spec ? GLYPH_BG[spec.tone] : DOT_BG[tone];
  return (
    <span
      data-testid={testId}
      {...dataAttrs}
      {...(spec ? { "data-glyph": spec.id } : {})}
      data-glyph-form="solid"
      className={`${common} border-transparent text-white ${fill}`}
      title={title}
    >
      {label ?? ""}
    </span>
  );
}

/**
 * A vocabulary glyph in BARE-MARK form — a rung's detail under the cell's
 * headline. No box, no fill, no border at any time; the tone lives in the
 * glyph, and an absence mark additionally carries the dotted underline.
 */
export function GlyphMark({
  label,
  tone,
  className = "",
  title,
}: {
  label: string;
  /** Legacy tone, used only for marks outside the glyph vocabulary. */
  tone: BadgeTone;
  className?: string;
  /** Hover text. Vocabulary marks default to their own legend line. */
  title?: string;
}) {
  const spec = glyphForMark(label);
  if (!spec) {
    return (
      <span
        className={`tabular-nums ${TONE_CLASS[tone]} ${className}`}
        title={title}
      >
        {label}
      </span>
    );
  }
  const absence = spec.glyphClass === "absence";
  return (
    <span
      data-glyph={spec.id}
      data-glyph-form="bare"
      className={`tabular-nums font-semibold ${GLYPH_TEXT[spec.tone]} ${absence ? ABSENCE_UNDERLINE : ""} ${className}`}
      title={title ?? glyphTitle(spec.mark)}
    >
      {spec.mark}
    </span>
  );
}

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
  // NOTE: the no-data "?" is NO LONGER suppressed. It used to return `null`
  // here, which made the main grid compute a state it never painted — the
  // legend documented a `?` that half the dashboard never drew, and a blank
  // rung was indistinguishable from "never configured", "never reported" and
  // "the dashboard dropped it". A rung that does not EXIST still renders
  // nothing; that check lives in `TestBadge` (`!level.exists`), not here.

  const inner = (
    <span
      className="whitespace-nowrap"
      title={title}
      onMouseEnter={handleOpen}
      onFocus={handleOpen}
    >
      <span
        className="text-[var(--text-muted)]"
        title={glyphTitle(state.label)}
      >
        {name}
      </span>{" "}
      <GlyphMark label={state.label} tone={state.tone} />
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

/**
 * Tiny square chip used in strip / grid views. Kept as the historical name;
 * every status glyph now resolves its form through `StatusChip`, so a starter
 * cell and a feature cell render the SAME state identically.
 */
export function ToneChip({
  tone,
  title,
  label,
}: {
  tone: BadgeTone;
  title?: string;
  label?: string;
}) {
  return <StatusChip tone={tone} title={title} label={label} />;
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
