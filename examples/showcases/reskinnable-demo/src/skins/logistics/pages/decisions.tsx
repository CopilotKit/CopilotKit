"use client";

import { useLogistics } from "../actions";
import { DecisionLog } from "../components";

export function DecisionsPage() {
  const { decisions } = useLogistics();
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
      <DecisionLog decisions={decisions} />
    </div>
  );
}

export default DecisionsPage;
