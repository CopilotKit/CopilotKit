"use client";

import { useSkinData } from "@/shell/skin-provider";
import type { AirlineData } from "../data/types";
import {
  DisruptionAlert,
  RebookingOptions,
  BaggageTracker,
} from "../components";

export function DisruptionsPage() {
  const data = useSkinData<AirlineData>();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">
          Disruptions &amp; service
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Delays, rebooking options, and where your bags are.
        </p>
      </div>

      {data.disruption ? (
        <DisruptionAlert disruption={data.disruption} />
      ) : (
        <div className="rounded-2xl border border-dashed border-hairline p-6 text-center text-sm text-ink-muted">
          No active disruptions — your flight is on schedule.
        </div>
      )}
      <RebookingOptions
        options={data.rebookingOptions}
        onSelect={data.chooseRebooking}
      />
      <BaggageTracker baggage={data.baggage} />
    </div>
  );
}
