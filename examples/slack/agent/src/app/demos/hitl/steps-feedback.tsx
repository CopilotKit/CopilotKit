"use client";

import React, { useState } from "react";
import { Button } from "./_components/button";
import { Card, CardContent, CardHeader, CardTitle } from "./_components/card";
import { Checkbox } from "./_components/checkbox";
import { Badge } from "./_components/badge";
import type { Step } from "./step-selector";

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
            {steps.map((step: any, i: number) => (
              <label
                key={i}
                className="flex items-center gap-3 rounded-md p-2 hover:bg-neutral-50 cursor-pointer transition-colors"
                data-testid="step-item"
              >
                <Checkbox
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
          {decided === null && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={status !== "executing"}
                onClick={() => {
                  setDecided(false);
                  respond?.({ accepted: false });
                }}
              >
                Reject
              </Button>
              <Button
                variant="success"
                className="flex-1"
                disabled={status !== "executing"}
                onClick={() => {
                  setDecided(true);
                  respond?.({
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
