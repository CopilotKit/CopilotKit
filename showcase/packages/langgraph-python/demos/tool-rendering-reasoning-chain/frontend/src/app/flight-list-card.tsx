"use client";

import React from "react";

// Rich per-tool renderer for the `search_flights` backend tool.
// Duplicated from the primary `tool-rendering` cell so each cell is
// self-contained.

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
      className="my-3 rounded-xl border border-sky-200 bg-sky-50/70 p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>
            ✈
          </span>
          <div className="font-semibold text-sky-900">
            <span data-testid="flight-origin">{origin || "?"}</span>
            <span className="mx-1 text-sky-500">→</span>
            <span data-testid="flight-destination">{destination || "?"}</span>
          </div>
        </div>
        {loading ? (
          <span className="text-xs italic text-sky-600">searching…</span>
        ) : (
          <span className="rounded-full bg-sky-200 px-2 py-0.5 text-[11px] font-medium text-sky-900">
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
            <li className="text-sm italic text-sky-700">
              No flights returned.
            </li>
          ) : (
            flights.map((f, i) => (
              <li
                key={`${f.flight ?? "flight"}-${i}`}
                data-testid="flight-row"
                className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm shadow-sm"
              >
                <div>
                  <div className="font-medium text-slate-900">
                    {f.airline ?? "—"}{" "}
                    <span className="font-mono text-xs text-slate-500">
                      {f.flight ?? ""}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">
                    {f.depart ?? "?"} → {f.arrive ?? "?"}
                  </div>
                </div>
                <div className="font-mono text-sm font-medium text-emerald-700">
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
    <div className="h-10 animate-pulse rounded-lg bg-white/60" aria-hidden />
  );
}
