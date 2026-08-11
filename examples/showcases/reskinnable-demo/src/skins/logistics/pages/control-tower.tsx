"use client";

import { useAgentContext } from "@copilotkit/react-core/v2";
import { useLogistics } from "../actions";
import { KpiStrip, ExceptionBoard, deriveKpiTiles } from "../components";

export function ControlTowerPage() {
  const { shipments, lanes } = useLogistics();

  // ── BEAT 3b, part 2 — what is VISIBLY on this screen ─────────────────────
  // `shipments` is the exact array handed to <ExceptionBoard> below, and
  // deriveKpiTiles is the exact function <KpiStrip> builds its tiles from —
  // formatted strings, not raw numbers, so the agent quotes the "67%" the
  // planner can read rather than the 0.6666… behind it. NEVER re-derive or
  // re-slice the source for a readable: a readable listing 5 rows against a
  // panel showing 6 describes the screen wrongly, silently, and a confidently
  // wrong description is indistinguishable from a correct one to the room.
  //
  // The board renders every row it is given (it only re-ORDERS them, worst
  // first), so there is no truncation to report and no filter state to report.
  // TASK 11 OWNS THE REWRITE of this readable: it adds four filter levers plus
  // one useMemo publishing `matching` (the count under the levers) and
  // `visible` (that list truncated), and this readable must then be rebuilt
  // from those two. Do not add a `filters` key before then — a defaulted filter
  // set asserts a choice nobody made.
  useAgentContext({
    description:
      "What is on the Control Tower screen right now: the headline KPI tiles " +
      "as displayed, and the exception board rows the planner can actually see.",
    value: JSON.stringify({
      page: "Control Tower",
      kpi_tiles: deriveKpiTiles(shipments),
      visible: shipments.length,
      rows: shipments.map((s) => ({
        reference: s.reference,
        lane: s.laneId,
        carrier: s.carrier,
        value_usd: s.valueUsd,
        // `exception` is an object; emit its code and detail, never the object.
        exception: s.exception?.code ?? null,
        exception_detail: s.exception?.detail ?? null,
        status: s.status,
        eta_planned: s.etaPlanned,
        eta_current: s.etaCurrent,
        promised: s.slaDate,
      })),
    }),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Control Tower
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Live exceptions across the network, worst first.
        </p>
      </header>
      <KpiStrip shipments={shipments} />
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Exceptions
        </h2>
        <ExceptionBoard shipments={shipments} lanes={lanes} />
      </section>
    </div>
  );
}

export default ControlTowerPage;
