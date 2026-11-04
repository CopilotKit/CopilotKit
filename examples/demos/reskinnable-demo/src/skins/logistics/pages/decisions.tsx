"use client";

import { useMemo } from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useLogistics } from "../actions";
import {
  DecisionLog,
  RateBriefLog,
  orderDecisionRows,
  orderRateBriefRows,
} from "../components";

export function DecisionsPage() {
  const { decisions, rateBriefs } = useLogistics();

  // ONE array, two consumers — see control-tower.tsx for why.
  const visible = useMemo(() => orderDecisionRows(decisions), [decisions]);
  const briefs = useMemo(() => orderRateBriefRows(rateBriefs), [rateBriefs]);

  // BEAT 3b — `visible` is the exact array <DecisionLog> maps over below, in
  // the exact order it paints, and `briefs` likewise for <RateBriefLog>. Both
  // start EMPTY in the seeded demo, so `visible: 0` is the correct answer on a
  // fresh reset; the agent should say the log is empty rather than reach for the
  // global readables and describe the network instead.
  useAgentContext({
    description:
      "What is on the Decision Log screen right now: the decision entries and " +
      "the ingested carrier rate briefs the planner can actually see, newest " +
      "first. An empty list means nothing filed yet.",
    value: JSON.stringify({
      page: "Decision Log",
      visible: visible.length,
      rows: visible.map((d) => ({
        shipment: d.shipmentId,
        kind: d.kind,
        cost_usd: d.costUsd,
        status: d.status,
        decided_by: d.decidedBy,
        role: d.role,
        rationale: d.rationale,
      })),
      // BEAT 3d — the durable artifact is part of what is ON SCREEN, so it is
      // part of this readable. It is deliberately its own key rather than a
      // seventh kind of decision row: a rate brief has no shipment and no cost,
      // and flattening it into `rows` would have the agent reporting it as a
      // decision taken on a shipment that does not exist.
      rate_briefs_visible: briefs.length,
      rate_briefs: briefs.map((b) => ({
        carrier: b.carrier,
        effective: b.effective,
        summary: b.summary,
        lane_rates: b.laneRates.map((r) => ({
          lane: r.lane,
          mode: r.mode,
          // `null`, never 0, for a lane the network has never carried — the row
          // that proves the document was read. A zero would read as a rate the
          // carrier once charged.
          old_rate_usd_per_kg: r.oldRateUsdPerKg ?? null,
          new_rate_usd_per_kg: r.newRateUsdPerKg,
        })),
        impacts: b.impacts,
        filed_by: b.filedBy,
      })),
    }),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Decision Log
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every committed and escalated call, newest first.
        </p>
      </header>
      <DecisionLog decisions={visible} />

      <section className="flex flex-col gap-3">
        <header>
          <h2 className="text-lg font-semibold tracking-tight text-ink">
            Rate briefs on file
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Filed from ingested carrier rate sheets. These belong to Meridian,
            not to the conversation that produced them.
          </p>
        </header>
        <RateBriefLog briefs={briefs} />
      </section>
    </div>
  );
}

export default DecisionsPage;
