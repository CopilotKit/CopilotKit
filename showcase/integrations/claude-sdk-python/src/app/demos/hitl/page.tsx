"use client";

import React, { useState } from "react";
import { CopilotKit, useLangGraphInterrupt } from "@copilotkit/react-core";
import {
  CopilotChat,
  useHumanInTheLoop,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

interface Step {
  description: string;
  status: "disabled" | "enabled" | "executing";
}

export default function HitlDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="human_in_the_loop">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Simple plan",
        message: "Please plan a trip to mars in 5 steps.",
      },
      {
        title: "Complex plan",
        message: "Please plan a pasta dish in 10 steps.",
      },
    ],
    available: "always",
  });

  useLangGraphInterrupt({
    render: ({ event, resolve }) => (
      <StepSelector
        steps={event.value?.steps || []}
        onConfirm={(selectedSteps) => {
          resolve(
            "The user selected the following steps: " +
              selectedSteps.map((s) => s.description).join(", "),
          );
        }}
      />
    ),
  });

  useHumanInTheLoop({
    agentId: "human_in_the_loop",
    name: "generate_task_steps",
    description: "Generates a list of steps for the user to perform",
    parameters: z.object({
      steps: z.array(
        z.object({
          description: z.string(),
          status: z.enum(["enabled", "disabled", "executing"]),
        }),
      ),
    }),
    render: ({ args, respond, status }: any) => (
      <StepsFeedback args={args} respond={respond} status={status} />
    ),
  });

  return (
    <div className="flex justify-center items-center h-screen w-full">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat
          agentId="human_in_the_loop"
          className="h-full rounded-2xl"
        />
      </div>
    </div>
  );
}

function StepSelector({
  steps,
  onConfirm,
}: {
  steps: Array<{ description?: string; status?: string } | string>;
  onConfirm: (steps: Step[]) => void;
}) {
  const [localSteps, setLocalSteps] = useState<Step[]>(() =>
    steps.map((s) => ({
      description: typeof s === "string" ? s : s.description || "",
      status: (typeof s === "object" && s.status === "disabled"
        ? "disabled"
        : "enabled") as Step["status"],
    })),
  );

  const enabledCount = localSteps.filter((s) => s.status === "enabled").length;

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-lg w-[500px]"
      data-testid="select-steps"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-800">Select Steps</h3>
        <span className="text-sm text-gray-500">
          {enabledCount}/{localSteps.length} selected
        </span>
      </div>
      <div className="space-y-2 mb-4">
        {localSteps.map((step, i) => (
          <label
            key={i}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
            data-testid="step-item"
          >
            <input
              type="checkbox"
              checked={step.status === "enabled"}
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
              className="w-4 h-4 rounded"
            />
            <span
              className={
                step.status !== "enabled"
                  ? "line-through text-gray-400"
                  : "text-gray-800"
              }
              data-testid="step-text"
            >
              {step.description}
            </span>
          </label>
        ))}
      </div>
      <button
        onClick={() =>
          onConfirm(localSteps.filter((s) => s.status === "enabled"))
        }
        className="w-full rounded-lg bg-purple-600 px-4 py-2 text-white font-medium hover:bg-purple-700"
      >
        Perform Steps ({enabledCount})
      </button>
    </div>
  );
}

function StepsFeedback({
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

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-lg w-[500px]"
      data-testid="select-steps"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-800">Review Steps</h3>
        <span className="text-sm text-gray-500">
          {enabledCount}/{steps.length} selected
        </span>
      </div>
      <div className="space-y-2 mb-4">
        {steps.map((step: any, i: number) => (
          <label
            key={i}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
            data-testid="step-item"
          >
            <input
              type="checkbox"
              checked={step.status === "enabled"}
              disabled={status !== "executing"}
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
              className="w-4 h-4 rounded"
            />
            <span
              className={
                step.status !== "enabled"
                  ? "line-through text-gray-400"
                  : "text-gray-800"
              }
              data-testid="step-text"
            >
              {step.description}
            </span>
          </label>
        ))}
      </div>
      {decided === null && (
        <div className="flex gap-3">
          <button
            disabled={status !== "executing"}
            onClick={() => {
              setDecided(false);
              respond?.({ accepted: false });
            }}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            disabled={status !== "executing"}
            onClick={() => {
              setDecided(true);
              respond?.({
                accepted: true,
                steps: localSteps.filter((s) => s.status === "enabled"),
              });
            }}
            className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-white font-medium hover:bg-green-700 disabled:opacity-50"
          >
            Confirm ({enabledCount})
          </button>
        </div>
      )}
      {decided !== null && (
        <div
          className={`text-center py-2 rounded-lg font-medium ${decided ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
        >
          {decided ? "Accepted" : "Rejected"}
        </div>
      )}
    </div>
  );
}
