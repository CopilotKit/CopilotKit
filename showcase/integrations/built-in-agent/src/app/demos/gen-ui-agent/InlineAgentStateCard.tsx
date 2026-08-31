"use client";

import React from "react";

/**
 * Step shape matches the `Step` TypedDict emitted by the Python deep agent's
 * custom `set_steps` tool (see `src/agents/gen_ui_agent.py`).
 * Status transitions: pending -> in_progress -> completed.
 */
export type Step = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
};

/**
 * Derive what the card says from the STEP DATA, never from `status` alone.
 *
 * `status === "complete"` only means the run ended — it does not mean the agent
 * finished its plan. Treating the two as equivalent made the card announce
 * "All 3 steps complete" over a list whose last step still rendered as pending,
 * which is how a truncated agent run (the loop budget cutting the walk short)
 * read as a UI glitch rather than as the agent stopping early.
 *
 * Exported as a pure function so the wording is unit-testable without a DOM.
 */
export function describeProgress(
  steps: Step[],
  status: "inProgress" | "complete",
): { headline: string; allDone: boolean; stalled: boolean } {
  const total = steps.length;
  const done = steps.filter((s) => s.status === "completed").length;
  const allDone = total > 0 && done === total;
  // Run over, plan unfinished — its own state, distinct from both "running" and
  // "done". An empty plan is never "complete".
  const stalled = status === "complete" && !allDone;
  const headline =
    total === 0
      ? "Planning…"
      : allDone
        ? `All ${total} steps complete`
        : stalled
          ? `Stopped at step ${Math.min(done + 1, total)} of ${total}`
          : `Step ${Math.min(done + 1, total)} of ${total}`;
  return { headline, allDone, stalled };
}

export function InlineAgentStateCard({
  steps,
  status,
}: {
  steps: Step[];
  status: "inProgress" | "complete";
}) {
  const { headline, allDone, stalled } = describeProgress(steps, status);

  return (
    <div
      data-testid="agent-state-card"
      data-complete={allDone ? "true" : "false"}
      data-stalled={stalled ? "true" : "false"}
      className="my-3 mx-4 rounded-2xl border border-[#DBDBE5] bg-white p-4 shadow-sm"
    >
      <div className="flex items-center gap-2">
        {/* A check mark asserts completion, so it is gated on the data too. A
            stalled run gets neither icon: it is not running, and it is not
            done. */}
        {allDone ? <CheckIcon /> : stalled ? null : <SpinnerIcon />}
        <span className="text-sm font-semibold text-[#010507]">{headline}</span>
      </div>

      {steps.length > 0 && (
        <ol className="mt-3 space-y-2">
          {steps.map((step, idx) => (
            <li
              key={step.id ?? idx}
              data-testid="agent-step"
              data-status={step.status}
              className="flex items-start gap-3"
            >
              <StepMarker status={step.status} index={idx} />
              <span
                className={
                  "text-xs leading-5 " +
                  (step.status === "completed"
                    ? "text-[#838389] line-through"
                    : step.status === "in_progress"
                      ? "text-[#010507] font-medium"
                      : "text-[#57575B]")
                }
              >
                {step.title}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function StepMarker({
  status,
  index,
}: {
  status: Step["status"];
  index: number;
}) {
  if (status === "completed") {
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#85ECCE] text-[#010507]">
        <svg
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            d="M5 13l4 4L19 7"
          />
        </svg>
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#BEC2FF] text-[#010507]">
        <svg
          className="h-3 w-3 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-30"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-90"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border border-[#DBDBE5] bg-white text-[10px] font-semibold text-[#838389]">
      {index + 1}
    </span>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="w-4 h-4 animate-spin text-[#010507]"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4 text-[#189370]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={3}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}
