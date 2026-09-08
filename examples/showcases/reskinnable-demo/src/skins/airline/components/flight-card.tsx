"use client";

import { Plane, Clock } from "lucide-react";
import type { Flight } from "../data/types";
import { formatTime, formatDate, durationBetween, cn, lookup } from "./utils";

interface FlightCardProps {
  flight: Flight;
}

const STATUS_STYLES: Record<Flight["status"], string> = {
  on_time: "bg-positive-soft text-positive",
  delayed: "bg-amber-100 text-amber-700",
  boarding: "bg-brand-soft text-brand",
  cancelled: "bg-negative-soft text-negative",
  departed: "bg-surface-muted text-ink-muted",
};

const STATUS_LABEL: Record<Flight["status"], string> = {
  on_time: "On time",
  delayed: "Delayed",
  boarding: "Boarding",
  cancelled: "Cancelled",
  departed: "Departed",
};

export function FlightCard({ flight }: FlightCardProps) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-6 shadow-soft">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">
            Flight
          </div>
          <div className="text-lg font-semibold text-ink">
            {flight.flight_number}
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold",
            lookup(STATUS_STYLES, flight.status, STATUS_STYLES.on_time),
          )}
        >
          {lookup(STATUS_LABEL, flight.status, "Scheduled")}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="text-3xl font-bold tracking-tight text-ink">
            {flight.origin}
          </div>
          <div className="text-sm text-ink-muted">{flight.origin_city}</div>
          <div className="mt-2 text-sm font-medium text-ink">
            {formatTime(flight.departure_time)}
          </div>
          <div className="text-xs text-ink-muted">
            {formatDate(flight.departure_time)}
          </div>
        </div>

        <div className="flex flex-col items-center text-ink-muted">
          <div className="flex items-center gap-1 text-xs">
            <Clock className="h-3 w-3" />
            {durationBetween(flight.departure_time, flight.arrival_time)}
          </div>
          <div className="relative my-2 h-px w-24 bg-hairline sm:w-40">
            <Plane className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-90 text-brand" />
          </div>
          <div className="text-[10px] uppercase tracking-wider">
            {flight.aircraft}
          </div>
        </div>

        <div className="flex-1 text-right">
          <div className="text-3xl font-bold tracking-tight text-ink">
            {flight.destination}
          </div>
          <div className="text-sm text-ink-muted">
            {flight.destination_city}
          </div>
          <div className="mt-2 text-sm font-medium text-ink">
            {formatTime(flight.arrival_time)}
          </div>
          <div className="text-xs text-ink-muted">
            {formatDate(flight.arrival_time)}
          </div>
        </div>
      </div>

      {flight.gate ? (
        <div className="mt-5 flex items-center gap-6 border-t border-hairline pt-4 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-muted">
              Gate
            </div>
            <div className="font-mono font-semibold text-ink">
              {flight.gate}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
