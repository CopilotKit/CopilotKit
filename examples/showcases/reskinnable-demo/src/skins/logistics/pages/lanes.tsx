"use client";

import { useAgentContext } from "@copilotkit/react-core/v2";
import { useLogistics } from "../actions";
import { LaneTable } from "../components";

export function LanesPage() {
  const { lanes } = useLogistics();

  // BEAT 3b — `lanes` is the exact array <LaneTable> maps over below, and the
  // columns emitted here are the columns it renders. Same expression, never a
  // second slice of the same source.
  useAgentContext({
    description:
      "What is on the Lanes screen right now: the lane rows the planner can " +
      "actually see, with the columns the table shows.",
    value: JSON.stringify({
      page: "Lanes",
      visible: lanes.length,
      rows: lanes.map((l) => ({
        lane: `${l.origin} → ${l.destination}`,
        mode: l.mode,
        transit_days: l.transitDays,
        on_time_pct: Math.round(l.reliability * 100),
        cost_per_kg: l.costPerKg,
        status: l.status,
        note: l.note ?? null,
      })),
    }),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Lanes
        </h1>
        <p className="mt-1 text-sm text-ink-muted">Network health by lane.</p>
      </header>
      <LaneTable lanes={lanes} />
    </div>
  );
}

export default LanesPage;
