"use client";

import React, { useState } from "react";
import { Button } from "./_components/button";
import { Card, CardContent, CardHeader, CardTitle } from "./_components/card";
import { Checkbox } from "./_components/checkbox";
import { Badge } from "./_components/badge";

export interface Step {
  description: string;
  status: "disabled" | "enabled" | "executing";
}

export function StepSelector({
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
                className="flex items-center gap-3 rounded-md p-2 hover:bg-neutral-50 cursor-pointer transition-colors"
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
                      ? "text-sm line-through text-neutral-400"
                      : "text-sm text-neutral-800"
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
