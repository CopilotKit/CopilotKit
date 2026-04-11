"use client";

import React, { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useHumanInTheLoop,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { DemoErrorBoundary } from "../error-boundary";

interface Step {
  description: string;
  status: "disabled" | "enabled" | "executing";
}

export default function HitlDemo() {
  return (
    <DemoErrorBoundary demoName="Human in the Loop">
      <CopilotKit runtimeUrl="/api/copilotkit" agent="human_in_the_loop">
        <DemoContent />
      </CopilotKit>
    </DemoErrorBoundary>
  );
}

function DemoContent() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Research plan",
        message: "Please plan a research project about AI agents in 5 steps.",
      },
      {
        title: "Report plan",
        message: "Please plan a technical report about LLMs in 8 steps.",
      },
    ],
    available: "always",
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
    <div className="flex justify-center items-center h-full w-full">
      <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg px-6">
        <CopilotChat
          agentId="human_in_the_loop"
          className="h-full rounded-2xl max-w-6xl mx-auto"
        />
      </div>
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
      data-testid="select-steps"
      style={{
        borderRadius: "16px",
        border: "1px solid #e5e5e0",
        background: "#fff",
        padding: "32px",
        boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
        width: "520px",
      }}
    >
      <div
        style={{
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h3
          style={{
            fontSize: "18px",
            fontWeight: 700,
            color: "#1f2937",
            margin: 0,
          }}
        >
          Review Steps
        </h3>
        <span style={{ fontSize: "14px", color: "#6b7280" }}>
          {enabledCount}/{steps.length} selected
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          marginBottom: "24px",
        }}
      >
        {steps.map((step: any, i: number) => (
          <label
            key={i}
            data-testid="step-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "10px 16px",
              borderRadius: "8px",
              cursor: "pointer",
            }}
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
              style={{ width: "16px", height: "16px", borderRadius: "4px" }}
            />
            <span
              style={{
                color: step.status !== "enabled" ? "#9ca3af" : "#1f2937",
                textDecoration:
                  step.status !== "enabled" ? "line-through" : "none",
              }}
              data-testid="step-text"
            >
              {step.description}
            </span>
          </label>
        ))}
      </div>
      {decided === null && (
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            disabled={status !== "executing"}
            onClick={() => {
              setDecided(false);
              respond?.({ accepted: false });
            }}
            style={{
              flex: 1,
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              padding: "8px 16px",
              fontWeight: 500,
              cursor: "pointer",
              opacity: status !== "executing" ? 0.5 : 1,
              background: "white",
            }}
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
            style={{
              flex: 1,
              borderRadius: "8px",
              background: "#16a34a",
              padding: "8px 16px",
              color: "white",
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
              opacity: status !== "executing" ? 0.5 : 1,
            }}
          >
            Confirm ({enabledCount})
          </button>
        </div>
      )}
      {decided !== null && (
        <div
          style={{
            textAlign: "center",
            padding: "8px",
            borderRadius: "8px",
            fontWeight: 500,
            background: decided ? "#f0fdf4" : "#fef2f2",
            color: decided ? "#15803d" : "#b91c1c",
          }}
        >
          {decided ? "Accepted" : "Rejected"}
        </div>
      )}
    </div>
  );
}
