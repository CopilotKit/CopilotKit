"use client";

import { useState } from "react";
import type { Flight } from "@/lib/flights";
import { formatTime } from "@/lib/flights";

interface BookingConfirmCardProps {
  flight?: Flight;
  flightId: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}

export function BookingConfirmCard({
  flight,
  flightId,
  onConfirm,
  onCancel,
}: BookingConfirmCardProps) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-5 space-y-4">
      <h3 className="text-base font-semibold text-gray-900">
        Confirm your booking
      </h3>

      {flight ? (
        <div className="space-y-2">
          <div className="text-lg font-bold text-gray-900">
            {flight.origin} → {flight.destination}
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-medium">{flight.airline}</span>
            <span className="text-gray-400 font-mono text-xs">
              {flight.flight_no}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600 tabular-nums">
            <span>{formatTime(flight.depart)}</span>
            <span className="text-gray-300">–</span>
            <span>{formatTime(flight.arrive)}</span>
            <span className="text-gray-400">·</span>
            <span>{flight.duration}</span>
          </div>
          <div className="text-xl font-bold text-indigo-600 tabular-nums">
            {typeof flight?.price_usd === "number"
              ? `$${flight.price_usd.toLocaleString()}`
              : "—"}
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-600">
          Flight{" "}
          <span className="font-mono text-xs bg-white border border-gray-200 rounded px-1.5 py-0.5">
            {flightId}
          </span>
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            try {
              await onConfirm();
            } finally {
              setSubmitting(false);
            }
          }}
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60"
        >
          Confirm &amp; book
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            try {
              await onCancel();
            } finally {
              setSubmitting(false);
            }
          }}
          className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
