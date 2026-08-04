"use client";

import { useLogistics } from "../actions";
import { KpiStrip, ExceptionBoard } from "../components";

export function ControlTowerPage() {
  const { shipments, lanes } = useLogistics();
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
