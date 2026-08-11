"use client";

import { useMemo } from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useLogistics } from "../actions";
import { DecisionLog, orderDecisionRows } from "../components";

export function DecisionsPage() {
  const { decisions } = useLogistics();

  // ONE array, two consumers — see control-tower.tsx for why.
  const visible = useMemo(() => orderDecisionRows(decisions), [decisions]);

  // BEAT 3b — `visible` is the exact array <DecisionLog> maps over below, in
  // the exact order it paints. The log starts EMPTY in the seeded demo, so
  // `visible: 0` is the correct answer on a fresh reset; the agent should say
  // the log is empty rather than reach for the global readables and describe
  // the network instead.
  useAgentContext({
    description:
      "What is on the Decision Log screen right now: the decision entries the " +
      "planner can actually see, newest first. An empty list means no " +
      "decisions filed yet.",
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
    </div>
  );
}

export default DecisionsPage;
