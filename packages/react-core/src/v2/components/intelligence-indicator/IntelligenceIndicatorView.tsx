import React from "react";
import { twMerge } from "tailwind-merge";
import type { Message } from "@ag-ui/core";

/** Lifecycle state the brain hands the face. */
export type IntelligenceIndicatorStatus = "in-progress" | "finished";

export interface IntelligenceIndicatorViewProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The assistant message this indicator is attached to. */
  message: Message;
  /**
   * Whether the intelligence work is still running (`in-progress`) or has
   * settled (`finished`). Drives the spinner→checkmark transition and the
   * persistent subdued resting style.
   */
  status: IntelligenceIndicatorStatus;
  /** The visible label, e.g. "Using CopilotKit Intelligence". */
  label: string;
}

/**
 * The presentational "Using CopilotKit Intelligence" pill — the default
 * face rendered by the {@link IntelligenceIndicator} brain and the default
 * for the `intelligenceIndicator` slot.
 *
 * It is purely visual: it renders from `status` and `label` alone and holds
 * no run state. In `in-progress` the ring spins; in `finished` the ring
 * completes, the checkmark draws in, and the pill settles into a subdued
 * resting style (it does not unmount).
 *
 * Customize it through the `intelligenceIndicator` slot on `CopilotChat`:
 * pass a className string to restyle it, a props object to tweak it (e.g.
 * `{ label }`), or a component to replace it entirely.
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
      className={twMerge(
        "cpk-intelligence-pill",
        isFinished && "cpk-intelligence-pill--finished",
        className,
      )}
      role="status"
      aria-live="polite"
      data-testid={`cpk-intelligence-pill-${message.id}`}
      data-status={status}
      title={label}
      {...rest}
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
          className={
            "cpk-intelligence-pill__ring" +
            (isFinished ? " cpk-intelligence-pill__ring--done" : "")
          }
        />
        <path
          d="M8 12.5l3 3 5-6"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={
            "cpk-intelligence-pill__check" +
            (isFinished ? " cpk-intelligence-pill__check--shown" : "")
          }
        />
      </svg>
      <span>{label}</span>
    </span>
  );
}
