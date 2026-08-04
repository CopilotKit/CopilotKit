"use client";

import { useLogistics } from "../actions";
import { LaneTable } from "../components";

export function LanesPage() {
  const { lanes } = useLogistics();
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
