"use client";

import type { Flight } from "@/lib/flights";
import { formatTime } from "@/lib/flights";

interface BoardingPassProps {
  flight?: Flight;
  flightId: string;
  booked?: boolean;
}

export function BoardingPass({ flight, flightId, booked }: BoardingPassProps) {
  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm max-w-lg">
      {/* Colored top stripe */}
      <div className="h-2 bg-indigo-600" />

      <div className="flex divide-x divide-dashed divide-gray-300">
        {/* Main section */}
        <div className="flex-1 p-5 space-y-3">
          {flight ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">
                    Airline
                  </p>
                  <p className="text-sm font-semibold text-gray-900">
                    {flight.airline}
                  </p>
                </div>
                <span className="font-mono text-xs text-gray-400">
                  {flight.flight_no}
                </span>
              </div>

              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">
                  Route
                </p>
                <p className="text-xl font-bold text-gray-900 tracking-tight">
                  {flight.origin} → {flight.destination}
                </p>
              </div>

              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">
                    Departs
                  </p>
                  <p className="text-sm font-semibold text-gray-900 tabular-nums">
                    {formatTime(flight.depart)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">
                    Arrives
                  </p>
                  <p className="text-sm font-semibold text-gray-900 tabular-nums">
                    {formatTime(flight.arrive)}
                  </p>
                </div>
              </div>

              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">
                    Duration
                  </p>
                  <p className="text-sm text-gray-700">{flight.duration}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">
                    Class
                  </p>
                  <p className="text-sm text-gray-700">{flight.cabin}</p>
                </div>
              </div>
            </>
          ) : (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">
                Flight
              </p>
              <p className="font-mono text-sm text-gray-700">{flightId}</p>
            </div>
          )}
        </div>

        {/* Stub section */}
        <div className="w-36 p-4 flex flex-col justify-between bg-gray-50/60">
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">
                Seat
              </p>
              <p className="text-sm font-semibold text-gray-900">Aisle</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">
                Gate
              </p>
              <p className="text-sm font-semibold text-gray-900">—</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">
                Boarding
              </p>
              <p className="text-sm font-semibold text-gray-900">—</p>
            </div>
            {flight && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">
                  Price
                </p>
                <p className="text-sm font-bold text-indigo-600 tabular-nums">
                  {typeof flight?.price_usd === "number"
                    ? `$${flight.price_usd.toLocaleString()}`
                    : "—"}
                </p>
              </div>
            )}
          </div>

          {booked && (
            <div className="mt-3">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                CONFIRMED ✓
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
