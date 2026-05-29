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
   * has settled (`finished`). Drives the spinner ⇄ tag cross-fade.
   */
  status: IntelligenceIndicatorStatus;
  /** The visible label, e.g. "Using CopilotKit Intelligence". */
  label: string;
}

/**
 * If the in-progress label is a present participle ("Using …"), swap
 * it to past tense ("Used …") for the finished resting state so the
 * persistent tag reads naturally as scroll-back metadata. Other label
 * shapes pass through unchanged — slot consumers who pass a custom
 * label own its wording.
 */
const toFinishedLabel = (label: string): string =>
  label.replace(/^Using\s+/i, "Used ");

/**
 * The presentational "Using CopilotKit Intelligence" face — the default
 * rendered by the {@link IntelligenceIndicator} brain and the default
 * value for the `intelligenceIndicator` slot.
 *
 * Two modes:
 *  - `in-progress`: a glassmorphism pill with a spinning ring (the
 *    same active visual users see while the intelligence tool runs).
 *  - `finished`: a "stripped pill" — same layout, padding, font, and
 *    purple text as the in-progress pill, but with the background,
 *    border, shadow, and backdrop-blur removed and the spinning ring
 *    swapped for a static checkmark. The frame visibly sheds while
 *    the icon morphs.
 *
 * Both modes coexist in the DOM at the same `grid-area` so they
 * overlap pixel-for-pixel. Status drives a cross-fade: the in-progress
 * pill fades out over 220 ms while the stripped pill fades in over
 * 320 ms with a 120 ms delay — the slight overlap reads as the frame
 * dissolving and the icon transforming rather than two distinct
 * elements being swapped.
 *
 * Customize via the `intelligenceIndicator` slot on `CopilotChat`:
 * pass a className string to restyle the default, a props object to
 * tweak it (e.g. `{ label }`), or a component to replace it entirely.
 */
export function IntelligenceIndicatorView({
  message,
  status,
  label,
  className,
  ...rest
}: IntelligenceIndicatorViewProps): React.ReactElement {
  const isFinished = status === "finished";

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
      {/* In-progress pill — full opacity while spinning, shrunk and
          faded out once status flips to finished. */}
      <span
        className={
          "cpk-intelligence-indicator__pill" +
          (isFinished ? " cpk-intelligence-indicator__pill--hidden" : "")
        }
        aria-hidden={isFinished || undefined}
      >
        <svg
          className="cpk-intelligence-pill__icon"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="cpk-intelligence-pill__ring"
          />
        </svg>
        <span>{label}</span>
      </span>

      {/* Finished "stripped pill" — same layout, text, and color as
          the in-progress pill, but with no background/border/shadow,
          and a static checkmark in place of the spinning ring. */}
      <span
        className={
          "cpk-intelligence-indicator__tag" +
          (isFinished ? " cpk-intelligence-indicator__tag--shown" : "")
        }
        aria-hidden={!isFinished || undefined}
      >
        <svg
          className="cpk-intelligence-tag__icon"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12.5l4 4 10-10" />
        </svg>
        <span>{toFinishedLabel(label)}</span>
      </span>
    </span>
  );
}
