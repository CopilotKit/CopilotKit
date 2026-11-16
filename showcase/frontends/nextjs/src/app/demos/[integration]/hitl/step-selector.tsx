"use client";

import { useState } from "react";
import { Badge } from "./_components/badge";
import { Button } from "./_components/button";
import { Card, CardContent, CardHeader, CardTitle } from "./_components/card";
import { Checkbox } from "./_components/checkbox";

export interface Step {
  description: string;
  status: "disabled" | "enabled" | "executing";
}

/** A step as an interrupt sends it: a plain string, or a step object. */
export type ProposedStep = { description?: string; status?: string } | string;

function toStep(step: ProposedStep) {
  const isDisabled = typeof step === "object" && step.status === "disabled";
  return {
    description: typeof step === "string" ? step : (step.description ?? ""),
    status: isDisabled ? "disabled" : "enabled",
  } satisfies Step;
}

/**
 * The card for an agent that pauses with an interrupt: the user picks the
 * steps to run, and `onConfirm` receives the enabled ones.
 */
export function StepSelector({
  steps,
  onConfirm,
}: {
  steps: ProposedStep[];
  onConfirm: (steps: Step[]) => void;
}) {
  const [localSteps, setLocalSteps] = useState<Step[]>(() => steps.map(toStep));

  const enabledCount = localSteps.filter((s) => s.status === "enabled").length;

  return (
    <div className="flex w-full justify-center my-2">
      <Card className="w-full max-w-md" data-testid="select-steps">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Select Steps</CardTitle>
            <Badge variant="secondary">
              {enabledCount}/{localSteps.length} selected
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            {localSteps.map((step, i) => (
              <label
                key={i}
                className="flex items-center gap-3 rounded-md p-2 hover:bg-neutral-50 dark:hover:bg-muted cursor-pointer transition-colors"
                data-testid="step-item"
              >
                <Checkbox
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
          <Button
            className="w-full"
            onClick={() =>
              onConfirm(localSteps.filter((s) => s.status === "enabled"))
            }
          >
            Perform Steps ({enabledCount})
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
