"use client";

import { useEffect, useRef, useState } from "react";
import type { Flight } from "@/lib/flights";
import { formatTime, stopsLabel } from "@/lib/flights";
import { BookingConfirmCard } from "@/components/BookingConfirmCard";
import { BoardingPass } from "@/components/BoardingPass";

export function FlightCard({
  flight,
  onSelect,
}: {
  flight: Flight;
  onSelect?: (flight: Flight) => void;
}) {
  const isNonstop = flight.stops === 0;
  const selectable = Boolean(onSelect);

  return (
    <div
      className={`rounded-xl border bg-white shadow-sm p-4 flex flex-col gap-3 transition-colors ${
        selectable
          ? "border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30"
          : "border-gray-200"
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Left: route + times */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-gray-900 text-sm">
              {flight.airline}
            </span>
            <span className="text-xs text-gray-400 font-mono">
              {flight.flight_no}
            </span>
          </div>

          <div className="text-base font-bold text-gray-900 mb-1">
            {flight.origin} → {flight.destination}
          </div>

          <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap mb-2">
            <span className="tabular-nums">{formatTime(flight.depart)}</span>
            <span className="text-gray-300">–</span>
            <span className="tabular-nums">{formatTime(flight.arrive)}</span>
            <span className="text-gray-400">·</span>
            <span>{flight.duration}</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                isNonstop
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-amber-50 text-amber-700 border border-amber-200"
              }`}
            >
              {stopsLabel(flight.stops)}
            </span>
            <span className="text-xs text-gray-500 border border-gray-200 rounded-full px-2 py-0.5">
              {flight.cabin}
            </span>
          </div>

          {flight.notes && (
            <p className="mt-2 text-xs text-gray-400 truncate">
              {flight.notes}
            </p>
          )}
        </div>

        {/* Right: price + id */}
        <div className="flex flex-col items-end shrink-0 gap-1">
          <span className="text-xl font-bold text-indigo-600 tabular-nums">
            {typeof flight.price_usd === "number"
              ? `$${flight.price_usd.toLocaleString()}`
              : "—"}
          </span>
          <span className="text-[10px] text-gray-300 font-mono">
            {flight.id}
          </span>
        </div>
      </div>

      {/* Selector — opens the booking confirm inline (no agent round-trip), so the
          confirm step renders right here in view instead of being appended below
          the fold by a fresh agent turn. */}
      {selectable && (
        <button
          type="button"
          onClick={() => onSelect?.(flight)}
          className="self-end inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition-colors cursor-pointer"
        >
          Select this flight
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function FlightOptions({ flights = [] }: { flights?: Flight[] }) {
  // The whole select → confirm → book flow is local to this card: no agent run,
  // so nothing gets appended to the chat stream and the booking UI can never be
  // scrolled out of view. The conversational "Book me flight X" path still goes
  // through the agent's book_flight HITL tool.
  const [chosen, setChosen] = useState<Flight | null>(null);
  const [booked, setBooked] = useState(false);
  const focusRef = useRef<HTMLDivElement>(null);

  // Keep the confirm card / boarding pass in view as it replaces the list.
  useEffect(() => {
    if (chosen) focusRef.current?.scrollIntoView({ block: "nearest" });
  }, [chosen, booked]);

  if (flights.length === 0) {
    return <p className="text-sm text-gray-400 py-2">No flights found.</p>;
  }

  if (chosen) {
    return (
      <div ref={focusRef}>
        {booked ? (
          <BoardingPass flightId={chosen.id} flight={chosen} booked />
        ) : (
          <BookingConfirmCard
            flight={chosen}
            flightId={chosen.id}
            onConfirm={() => setBooked(true)}
            onCancel={() => setChosen(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-1">
      <p className="text-sm font-medium text-gray-500 mb-2">
        ✈️ Flight options
      </p>
      <div className="grid gap-3">
        {flights.map((flight, i) => (
          <FlightCard
            key={flight.id ?? `${flight.flight_no ?? "flight"}-${i}`}
            flight={flight}
            onSelect={setChosen}
          />
        ))}
      </div>
    </div>
  );
}
