import React from "react";
import { twMerge } from "tailwind-merge";
import type { Message } from "@ag-ui/core";

/** Lifecycle state the brain hands the face. */
export type IntelligenceIndicatorStatus = "in-progress" | "finished";

export interface IntelligenceIndicatorViewProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The assistant message this indicator is attached to. */
  message: Message;
  /**
   * Whether the intelligence work is still running (`in-progress`) or
   * has settled (`finished`). Drives the icon morph and chrome
   * fade-out via the `data-status` attribute on the wrapper.
   */
  status: IntelligenceIndicatorStatus;
  /** The visible label, e.g. "Using CopilotKit Intelligence". */
  label: string;
}

/**
 * The presentational "Using CopilotKit Intelligence" face — the default
 * rendered by the {@link IntelligenceIndicator} brain and the default
 * value for the `intelligenceIndicator` slot.
 *
 * Single-element three-stage design:
 *  1. **In-progress.** Glassmorphism pill chrome around a 270° arc icon
 *     and the label. The arc's stroke is dashed and its dashoffset is
 *     animated continuously — "marching ants" creates the loading
 *     sensation without rotating the SVG, which is what lets the
 *     d-attribute morph land cleanly later (no rotation to snap back
 *     to zero).
 *  2. **Icon morph (~250 ms).** On status flip the single icon path
 *     interpolates from the arc to a checkmark via CSS `d:` and the
 *     dashed stroke transitions to solid. Chrome and text stay at
 *     full opacity — the indicator visibly "commits" to done before
 *     anything else moves.
 *  3. **Settle (~400 ms, starts at +250 ms).** Chrome (background,
 *     border, shadow, backdrop-blur) fades to zero opacity. The label
 *     and icon stroke color alpha drops from 0.92 to 0.55. The text
 *     stays put — only its alpha changes — so there is no "bump"
 *     where the brand text disappears and reappears.
 *
 * Hard sequence: stage 3 has a 250 ms transition-delay so it waits
 * for stage 2 to finish. Total settle time ~650 ms in production.
 *
 * Both shapes are 3-segment cubic Bézier paths with matched command
 * structure (one `M` plus three `C`s), which is what makes the d
 * morph interpolate as a continuous shape change rather than snapping.
 * The arc is drawn at the SVG's natural orientation — no `transform`
 * is used anywhere on the icon, so there is no rotation state to
 * reset when the marching-ants animation is removed.
 *
 * The label is identical in both states (e.g. "Using CopilotKit
 * Intelligence"). An earlier draft swapped "Using…" → "Used…" on
 * finished, which caused the brand text to drift ~1 character to
 * the left during the morph because the leading verb was shorter.
 * The static check icon already carries the "done" semantic.
 *
 * Customize via the `intelligenceIndicator` slot on `CopilotChat`:
 * a className string restyles the wrapper, a props object tweaks
 * the default (`{ label }`), and a component replaces it entirely
 * with full control over visuals and timing.
 */
export function IntelligenceIndicatorView({
  message,
  status,
  label,
  className,
  ...rest
}: IntelligenceIndicatorViewProps): React.ReactElement {
  return (
    <span
      className={twMerge("cpk-intelligence-indicator", className)}
      role="status"
      aria-live="polite"
      data-testid={`cpk-intelligence-indicator-${message.id}`}
      data-status={status}
      title={label}
      {...rest}
    >
      {/* Chrome layer — bg, border, shadow, backdrop-blur. Sits behind
          the content via `position: absolute; inset: 0`. Fades to zero
          opacity once the icon morph completes. */}
      <span className="cpk-intelligence-indicator__chrome" aria-hidden="true" />

      {/* Content layer — icon + label. Stays put across the whole
          transition; only its color alpha drops on settle. */}
      <span className="cpk-intelligence-indicator__content">
        <svg
          className="cpk-intelligence-indicator__icon"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
        >
          {/* Single path element whose `d` attribute morphs from the
              arc to the checkmark via CSS `d:` interpolation. Both
              shapes are 3-segment cubic Béziers; the arc is a 270°
              quarter-by-quarter approximation of a circle, the
              checkmark is a 2-stroke polyline split into 3 cubics
              with collinear controls (so the segments render as
              straight lines). */}
          <path className="cpk-intelligence-indicator__icon-path" />
        </svg>
        <span>{label}</span>
      </span>
    </span>
  );
}
