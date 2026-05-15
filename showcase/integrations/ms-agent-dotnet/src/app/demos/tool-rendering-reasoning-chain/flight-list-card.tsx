"use client";

import React from "react";

// Rich per-tool renderer for the `search_flights` backend tool.
//
// Registered in page.tsx via `useRenderTool({ name: "search_flights", ... })`,
// this card shows the search origin/destination and a short list of flight
// results. It only renders once the backend returns; while the tool is still
// running it shows a compact loading state so the chat doesn't look frozen.

export interface Flight {
  airline?: string;
  flightNumber?: string;
  departureTime?: string;
  arrivalTime?: string;
  price?: number;
  currency?: string;
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
            F
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
                key={`${f.flightNumber ?? "flight"}-${i}`}
                data-testid="flight-row"
                className="flex items-center justify-between rounded-xl border border-[#E9E9EF] bg-[#FAFAFC] px-3 py-2.5 text-sm"
              >
                <div>
                  <div className="font-medium text-[#010507]">
                    {f.airline ?? "—"}{" "}
                    <span className="font-mono text-xs text-[#838389]">
                      {f.flightNumber ?? ""}
                    </span>
                  </div>
                  <div className="text-xs text-[#57575B] mt-0.5">
                    {f.departureTime ?? "?"} → {f.arrivalTime ?? "?"}
                  </div>
                </div>
                <div className="font-mono text-sm font-medium text-[#189370]">
                  {f.price !== undefined
                    ? `${f.currency === "USD" || !f.currency ? "$" : ""}${f.price}`
                    : "—"}
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
