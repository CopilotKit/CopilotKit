"use client";

import React from "react";

/**
 * Step shape matches the `Step` TypedDict emitted by the Python agent.
 * Status transitions: pending -> running -> completed.
 */
export type Step = {
  description: string;
  status: "pending" | "running" | "completed";
};

export function InlineAgentStateCard({
  steps,
  status,
}: {
  steps: Step[];
  status: "inProgress" | "complete";
}) {
  const total = steps.length;
  const done = steps.filter((s) => s.status === "completed").length;
  const headline =
    status === "complete" || (total > 0 && done === total)
      ? `All ${total} steps complete`
      : total > 0
        ? `Step ${Math.min(done + 1, total)} of ${total}`
        : "Planning…";

  return (
    <div
      data-testid="agent-state-card"
      className="my-3 mx-4 rounded-xl border border-gray-200 bg-gradient-to-br from-indigo-50 via-white to-fuchsia-50 p-4 shadow-sm"
    >
      <div className="flex items-center gap-2">
        {status === "inProgress" && done < total ? (
          <SpinnerIcon />
        ) : (
          <CheckIcon />
        )}
        <span className="text-sm font-semibold text-gray-800">{headline}</span>
      </div>

      {steps.length > 0 && (
        <ol className="mt-3 space-y-2">
          {steps.map((step, idx) => (
            <li
              key={idx}
              data-testid="agent-step"
              data-status={step.status}
              className="flex items-start gap-3"
            >
              <StepMarker status={step.status} index={idx} />
              <span
                className={
                  "text-xs leading-5 " +
                  (step.status === "completed"
                    ? "text-gray-500 line-through"
                    : step.status === "running"
                      ? "text-indigo-700 font-medium"
                      : "text-gray-700")
                }
              >
                {step.description}
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
      <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-emerald-500 text-white">
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
  if (status === "running") {
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-indigo-500 text-white">
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
    <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border border-gray-300 bg-white text-[10px] font-semibold text-gray-500">
      {index + 1}
    </span>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="w-4 h-4 animate-spin text-indigo-600"
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
      className="w-4 h-4 text-emerald-600"
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
