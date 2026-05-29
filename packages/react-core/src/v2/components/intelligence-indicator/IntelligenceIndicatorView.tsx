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
 *  - `finished`: a tiny italic-gray "metadata line" — icon + past-tense
 *    label, no border, no background. Reads as a footnote attached to
 *    the assistant message rather than a status chip, so it disappears
 *    into the chrome for someone scrolling and surfaces for someone
 *    looking.
 *
 * Both modes coexist in the DOM; status drives a "shrink-and-settle"
 * transition where the pill scales down (1 → 0.7) from its center as
 * it fades out, and the tag scales up from the same center (0.7 → 1)
 * with a 120 ms delay — the overlap reads as one element morphing
 * rather than two elements being swapped. Total transition ~440 ms.
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

      {/* Finished metadata line — italic gray text + small checkmark,
          no border or background. The checkmark itself is the cue. */}
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
          width="10"
          height="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
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
