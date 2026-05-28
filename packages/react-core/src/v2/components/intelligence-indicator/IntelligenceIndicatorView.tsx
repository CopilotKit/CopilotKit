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
 * The presentational "Using CopilotKit Intelligence" face — the default
 * rendered by the {@link IntelligenceIndicator} brain and the default
 * value for the `intelligenceIndicator` slot.
 *
 * Two modes:
 *  - `in-progress`: a glassmorphism pill with a spinning ring (the
 *    same active visual users see while the intelligence tool runs).
 *  - `finished`: a compact icon + text tag — visibly demoted so it
 *    sits quietly in chat history per turn without competing with the
 *    agent's answer. The tag's checkmark icon is the completion cue.
 *
 * Both modes coexist in the DOM; status drives an opacity cross-fade
 * so the swap reads as one smooth transition rather than two distinct
 * mounts. The wrapper is `position: relative` and the tag is
 * positioned absolutely over the pill's slot so the layout doesn't
 * jump between two differently-sized elements.
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
      {/* In-progress pill — full opacity while spinning, faded out
          once status flips to finished. */}
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

      {/* Finished tag — compact icon + text, faded in once work
          completes. The checkmark is the completion cue. */}
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
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12.5l4 4 10-10" />
        </svg>
        <span>{label}</span>
      </span>
    </span>
  );
}
