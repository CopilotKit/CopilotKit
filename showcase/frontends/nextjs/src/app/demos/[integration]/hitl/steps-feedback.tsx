"use client";

import { useEffect, useState } from "react";
import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { Badge } from "./_components/badge";
import { Button } from "./_components/button";
import { Card, CardContent, CardHeader, CardTitle } from "./_components/card";
import { Checkbox } from "./_components/checkbox";
import type { Step } from "./step-selector";

interface StepsFeedbackProps {
  /** The `generate_task_steps` arguments. They stream in, so `steps` may be missing. */
  args: { steps?: Step[] };
  /** Answers the tool call. It is set only while the call waits for the user. */
  respond?: (result: unknown) => Promise<void>;
  status: ToolCallStatus;
}

/**
 * The card for an agent that calls the `generate_task_steps` frontend tool:
 * the user reviews the steps, then confirms or rejects them, and the answer
 * goes back to the agent as the tool result.
 */
export function StepsFeedback({ args, respond, status }: StepsFeedbackProps) {
  const [localSteps, setLocalSteps] = useState<Step[]>([]);
  const [decided, setDecided] = useState<boolean | null>(null);
  const isExecuting = status === ToolCallStatus.Executing;

  useEffect(() => {
    const proposedSteps = args.steps ?? [];
    if (isExecuting && localSteps.length === 0 && proposedSteps.length > 0) {
      setLocalSteps(proposedSteps);
    }
  }, [isExecuting, args.steps, localSteps.length]);

  if (!args.steps?.length) return null;

  const steps = localSteps.length > 0 ? localSteps : args.steps;
  const enabledCount = steps.filter((s) => s.status === "enabled").length;

  return (
    <div className="flex w-full justify-center my-2">
      <Card className="w-full max-w-md" data-testid="select-steps">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Review Steps</CardTitle>
            <Badge variant="secondary">
              {enabledCount}/{steps.length} selected
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            {steps.map((step, i) => (
              <label
                key={i}
                className="flex items-center gap-3 rounded-md p-2 hover:bg-neutral-50 dark:hover:bg-muted cursor-pointer transition-colors"
                data-testid="step-item"
              >
                <Checkbox
                  checked={step.status === "enabled"}
                  disabled={!isExecuting}
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
                      ? "text-sm line-through text-neutral-400 dark:text-muted-foreground"
                      : "text-sm text-neutral-800 dark:text-foreground"
                  }
                  data-testid="step-text"
                >
                  {step.description}
                </span>
              </label>
            ))}
          </div>
          {decided === null && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={!isExecuting}
                onClick={() => {
                  setDecided(false);
                  void respond?.({ accepted: false });
                }}
              >
                Reject
              </Button>
              <Button
                variant="success"
                className="flex-1"
                disabled={!isExecuting}
                onClick={() => {
                  setDecided(true);
                  void respond?.({
                    accepted: true,
                    steps: localSteps.filter((s) => s.status === "enabled"),
                  });
                }}
              >
                Confirm ({enabledCount})
              </Button>
            </div>
          )}
          {decided !== null && (
            <div className="flex justify-center">
              <Badge
                variant={decided ? "success" : "destructive"}
                className="px-3 py-1 text-sm"
              >
                {decided ? "Accepted" : "Rejected"}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
