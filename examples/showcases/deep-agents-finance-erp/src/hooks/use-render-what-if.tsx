"use client";

import { useRenderTool, useCopilotKit, useAgent } from "@copilotkit/react-core/v2";
import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

// Rendered INSIDE the sidebar React tree — can call hooks freely.
// Captures `agent` and `copilotkit` from ITS OWN hook calls so it always
// uses the same thread the sidebar is running on.
function WhatIfSlider({
  label,
  currentValue,
  minVal,
  maxVal,
  step,
}: {
  label: string;
  currentValue: number;
  minVal: number;
  maxVal: number;
  step: number;
}) {
  const { agent } = useAgent({ agentId: "finance_erp_agent" });
  const { copilotkit } = useCopilotKit();
  const [val, setVal] = useState(currentValue || 0);

  const handleCommit = async () => {
    try {
      // If the original run that spawned the slider is still active, abort it
      // so the thread lock is cleared before we send the follow-up message.
      if (agent.isRunning) {
        copilotkit.stopAgent({ agent });
        // Give the server time to unset store.isRunning before the new run.
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: `I have adjusted the ${label} to ${formatCurrency(val)}. Please recalculate the projections based on this new value.`,
      });

      void copilotkit.runAgent({ agent });
    } catch (err) {
      if ((err as any)?.name !== "AbortError") {
        console.error("WhatIfSlider: failed to send update:", err);
      }
    }
  };

  return (
    <Card className="w-full mb-4 border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col space-y-4">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">{formatCurrency(minVal || 0)}</span>
            <span className="font-bold text-primary text-lg">{formatCurrency(val)}</span>
            <span className="text-muted-foreground">{formatCurrency(maxVal || 100000)}</span>
          </div>
          <Slider
            min={minVal}
            max={maxVal}
            step={step}
            value={[val]}
            onValueChange={(v) => setVal(v[0])}
            onValueCommit={handleCommit}
          />
          <p className="text-xs text-muted-foreground text-center">
            Drag to adjust. Release to recalculate projections.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function useRenderWhatIfSlider() {
  useRenderTool(
    {
      name: "render_what_if_slider",
      render: ({ args, status }: any) => {
        if (!args?.label) {
          return (
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 animate-pulse text-sm text-muted-foreground">
              Preparing slider...
            </div>
          );
        }
        return (
          <WhatIfSlider
            label={args.label}
            currentValue={args.currentValue}
            minVal={args.minVal}
            maxVal={args.maxVal}
            step={args.step}
          />
        );
      },
    } as any,
    [],
  );
}
