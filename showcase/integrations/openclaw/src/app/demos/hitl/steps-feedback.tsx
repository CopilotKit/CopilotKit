"use client";

import React, { useState } from "react";

export interface Step {
  description: string;
  status: "disabled" | "enabled" | "executing";
}

/**
 * Human-in-the-loop review surface rendered inline in the chat. The agent
 * proposes a list of steps via the `generate_task_steps` tool; the user tweaks
 * the selection and Confirms or Rejects. That resolution is forwarded back to
 * the agent through the `respond` callback wired up by `useHumanInTheLoop`.
 *
 * Self-contained: styling is inlined with Tailwind (no shared UI kit).
 */
export function StepsFeedback({
  args,
  respond,
  status,
}: {
  args: any;
  respond: any;
  status: any;
}) {
  const [localSteps, setLocalSteps] = useState<Step[]>([]);
  const [decided, setDecided] = useState<boolean | null>(null);

  React.useEffect(() => {
    if (
      status === "executing" &&
      localSteps.length === 0 &&
      args?.steps?.length > 0
    ) {
      setLocalSteps(args.steps);
    }
  }, [status, args?.steps, localSteps.length]);

  if (!args?.steps?.length) return null;

  const steps = localSteps.length > 0 ? localSteps : args.steps;
  const enabledCount = steps.filter((s: any) => s.status === "enabled").length;
  const interactive = status === "executing";

  return (
    <div className="flex w-full justify-center my-2">
      <div
        className="w-full max-w-md rounded-2xl border border-[#DBDBE5] bg-white p-5 shadow-sm"
        data-testid="select-steps"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[#010507]">
            Review Steps
          </h3>
          <span className="inline-flex items-center rounded-full border border-[#DBDBE5] bg-[#F7F7F9] px-2.5 py-0.5 text-xs font-medium text-[#57575B]">
            {enabledCount}/{steps.length} selected
          </span>
        </div>

        <div className="space-y-1">
          {steps.map((step: any, i: number) => (
            <label
              key={i}
              className="flex items-center gap-3 rounded-md p-2 hover:bg-[#FAFAFC] cursor-pointer transition-colors"
              data-testid="step-item"
            >
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 rounded-sm border border-[#DBDBE5] accent-[#010507] disabled:cursor-not-allowed disabled:opacity-50"
                checked={step.status === "enabled"}
                disabled={!interactive}
                onChange={() =>
                  setLocalSteps((prev) =>
                    prev.map((s, j) =>
                      j === i
                        ? {
                            ...s,
                            status:
                              s.status === "enabled" ? "disabled" : "enabled",
                          }
                        : s,
                    ),
                  )
                }
              />
              <span
                className={
                  step.status !== "enabled"
                    ? "text-sm line-through text-[#A0A0A6]"
                    : "text-sm text-[#010507]"
                }
                data-testid="step-text"
              >
                {step.description}
              </span>
            </label>
          ))}
        </div>

        {decided === null && (
          <div className="flex gap-2 mt-4">
            <button
              className="flex-1 rounded-xl border border-[#DBDBE5] bg-white px-3 py-2 text-sm font-medium text-[#010507] hover:bg-[#FAFAFC] disabled:opacity-50 transition-colors"
              disabled={!interactive}
              data-testid="reject-steps"
              onClick={() => {
                setDecided(false);
                respond?.({ accepted: false });
              }}
            >
              Reject
            </button>
            <button
              className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600/90 disabled:opacity-50 transition-colors"
              disabled={!interactive}
              data-testid="confirm-steps"
              onClick={() => {
                setDecided(true);
                respond?.({
                  accepted: true,
                  steps: localSteps.filter((s) => s.status === "enabled"),
                });
              }}
            >
              Confirm ({enabledCount})
            </button>
          </div>
        )}
        {decided !== null && (
          <div className="flex justify-center mt-4">
            <span
              className={
                "inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium " +
                (decided
                  ? "border-transparent bg-emerald-100 text-emerald-700"
                  : "border-transparent bg-red-100 text-red-700")
              }
              data-testid="steps-decision"
            >
              {decided ? "Accepted" : "Rejected"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
