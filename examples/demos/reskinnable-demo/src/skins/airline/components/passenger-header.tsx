"use client";

import { Plane } from "lucide-react";
import type { Passenger, Flight } from "../data/types";
import { initials, tierStyleOf, cn } from "./utils";

interface PassengerHeaderProps {
  passenger: Passenger | null | undefined;
  flight: Flight | null | undefined;
}

export function PassengerHeader({ passenger, flight }: PassengerHeaderProps) {
  if (!passenger) {
    return (
      <div className="rounded-2xl border border-dashed border-hairline p-6 text-sm text-ink-muted">
        Waiting for passenger context…
      </div>
    );
  }

  const tier = tierStyleOf(passenger.tier);

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-hairline bg-surface px-5 py-4 shadow-soft">
      <div className="flex min-w-0 items-center gap-4">
        <div
          className={cn(
            "grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-semibold ring-2",
            tier.bg,
            tier.ring,
          )}
        >
          {initials(passenger.name)}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold text-ink">
              {passenger.name}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                tier.bg,
              )}
            >
              {tier.label}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-ink-muted">
            PNR <span className="font-mono">{passenger.pnr}</span> ·{" "}
            <span className="font-mono">{passenger.member_id}</span>
          </div>
        </div>
      </div>

      {flight ? (
        <div className="hidden shrink-0 items-center gap-3 text-sm sm:flex">
          <span className="font-semibold text-ink">{flight.flight_number}</span>
          <span className="text-ink-muted">
            {flight.origin}
            <Plane className="mx-1.5 inline h-3 w-3 -rotate-12" />
            {flight.destination}
          </span>
          {flight.gate ? (
            <span className="rounded-md bg-surface-muted px-2 py-1 font-mono text-xs text-ink">
              gate {flight.gate}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
