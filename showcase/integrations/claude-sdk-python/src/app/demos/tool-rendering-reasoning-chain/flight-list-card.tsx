"use client";

import React from "react";

export interface Flight {
  airline?: string;
  flight?: string;
  depart?: string;
  arrive?: string;
  price_usd?: number;
}

export interface FlightListCardProps {
  loading: boolean;
  origin: string;
  destination: string;
  flights: Flight[];
}

export function FlightListCard({
  loading,
  origin,
  destination,
  flights,
}: FlightListCardProps) {
  return (
    <div
      data-testid="flight-list-card"
      className="my-3 rounded-2xl border border-[#DBDBE5] bg-white p-5 shadow-sm"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#BEC2FF1A] text-[#010507]"
            aria-hidden
          >
            ✈
          </span>
          <div className="font-semibold text-[#010507]">
            <span data-testid="flight-origin">{origin || "?"}</span>
            <span className="mx-1.5 text-[#838389]">→</span>
            <span data-testid="flight-destination">{destination || "?"}</span>
          </div>
        </div>
        {loading ? (
          <span className="text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
            searching…
          </span>
        ) : (
          <span className="rounded-full border border-[#DBDBE5] bg-[#F7F7F9] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B]">
            {flights.length} result{flights.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : (
        <ul className="space-y-2">
          {flights.length === 0 ? (
            <li className="text-sm italic text-[#57575B]">
              No flights returned.
            </li>
          ) : (
            flights.map((f, i) => (
              <li
                key={`${f.flight ?? "flight"}-${i}`}
                data-testid="flight-row"
                className="flex items-center justify-between rounded-xl border border-[#E9E9EF] bg-[#FAFAFC] px-3 py-2.5 text-sm"
              >
                <div>
                  <div className="font-medium text-[#010507]">
                    {f.airline ?? "—"}{" "}
                    <span className="font-mono text-xs text-[#838389]">
                      {f.flight ?? ""}
                    </span>
                  </div>
                  <div className="text-xs text-[#57575B] mt-0.5">
                    {f.depart ?? "?"} → {f.arrive ?? "?"}
                  </div>
                </div>
                <div className="font-mono text-sm font-medium text-[#189370]">
                  {f.price_usd !== undefined ? `$${f.price_usd}` : "—"}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="h-10 animate-pulse rounded-xl bg-[#F0F0F4]" aria-hidden />
  );
}
