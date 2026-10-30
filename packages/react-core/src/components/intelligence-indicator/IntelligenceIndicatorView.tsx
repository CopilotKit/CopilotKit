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
 * The presentational "CopilotKit Intelligence" face — the default
 * rendered by the {@link IntelligenceIndicator} brain and the default
 * value for the `intelligenceIndicator` slot.
 *
 * Layout: a glassmorphism pill (the `__chrome` layer) wrapping an icon
 * and a label. The icon is two overlaid SVG paths — a spinner arc and a
 * checkmark — whose geometry lives in each path's `d` ATTRIBUTE so it
 * renders in every browser (the CSS `d:` property is Chrome-only).
 *
 * Two states, driven by the `data-status` attribute (see globals.css
 * for the exact timing):
 *  1. **In-progress.** The arc spins (CSS rotation) inside the pill and
 *     the checkmark is hidden. Label + icon are a saturated purple.
 *  2. **Finished.** The arc fades out mid-spin while the checkmark draws
 *     itself in upright (animated `stroke-dashoffset`); the pill chrome
 *     fades away; and the label + icon settle from purple to a neutral
 *     gray, with the label slanting slightly (a `transform: skewX`
 *     faux-italic, so it interpolates with the color instead of snapping
 *     and never reflows). The result reads as quiet "history metadata"
 *     rather than an active spinner. The label text itself never changes
 *     — the static check plus the color/slant shift carry the "done"
 *     meaning, so no wording change is needed.
 *
 * All motion is gated behind `prefers-reduced-motion` (globals.css):
 * when reduced motion is requested the arc does not spin and the two
 * states swap instantly, without transitions.
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
          {/* Two overlaid paths whose geometry lives in the `d`
              ATTRIBUTE (works in every browser — the CSS `d:` property
              is Blink-only, so a stylesheet-driven `d` renders nothing
              in Safari/Firefox). Both paths set `pathLength={1}` so the
              stylesheet can express dashes as plain fractions of the
              shape. The arc is a full circle shown as a partial ring by
              its dash pattern; it spins while in-progress (CSS) and on
              the status flip fades out mid-spin while the checkmark
              draws itself in (see globals.css). */}
          <path
            className="cpk-intelligence-indicator__icon-arc"
            pathLength={1}
            d="M 12 3 C 17 3 21 7 21 12 C 21 17 17 21 12 21 C 7 21 3 17 3 12 C 3 7 7 3 12 3"
          />
          <path
            className="cpk-intelligence-indicator__icon-check"
            pathLength={1}
            d="M 5 12.5 L 9 16.5 L 19 6.5"
          />
        </svg>
        <span className="cpk-intelligence-indicator__label">{label}</span>
      </span>
    </span>
  );
}
