"use client";

import React from "react";

// Per-tool renderer for the `roll_d20` backend tool. The fixture-driven
// e2e suite scripts the d20 mock as exactly five sequential calls
// returning [7, 14, 3, 19, 20], so each card carries a stable
// `data-testid="d20-card"` and a `data-d20-result` attribute for
// deterministic assertions.

export interface D20CardProps {
  loading: boolean;
  value?: number;
}

export function D20Card({ loading, value }: D20CardProps) {
  const display = typeof value === "number" ? value : undefined;
  const isCrit = display === 20;
  return (
    <div
      data-testid="d20-card"
      data-d20-result={display === undefined ? "" : String(display)}
      className={`my-3 inline-flex items-center gap-3 rounded-2xl border border-[#DBDBE5] bg-white p-4 shadow-sm ${
        isCrit ? "ring-2 ring-[#85ECCE]" : ""
      }`}
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#BEC2FF1A] text-lg"
        aria-hidden
      >
        d20
      </span>
      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
          Roll
        </div>
        <div
          data-testid="d20-value"
          className="font-mono text-2xl font-semibold text-[#010507]"
        >
          {loading ? "…" : (display ?? "—")}
        </div>
      </div>
      {isCrit ? (
        <span className="rounded-full border border-[#85ECCE4D] bg-[#85ECCE]/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#189370]">
          critical!
        </span>
      ) : null}
    </div>
  );
}
