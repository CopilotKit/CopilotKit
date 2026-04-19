"use client";

import React, { useState } from "react";

export interface TimeSlot {
  label: string;
  iso: string;
}

export interface TimePickerCardProps {
  topic: string;
  attendee?: string;
  slots: TimeSlot[];
  onSubmit: (
    result: { chosen_time: string; chosen_label: string } | { cancelled: true },
  ) => void;
}

/**
 * Renders a "Book a call" card with a small grid of time slots.
 * Used by `useInterrupt`: when the backend's `schedule_meeting` tool calls
 * `interrupt(...)`, this card appears in the chat and the user's picked
 * slot (or cancellation) is fed back via `resolve(...)`.
 */
export function TimePickerCard({
  topic,
  attendee,
  slots,
  onSubmit,
}: TimePickerCardProps) {
  const [picked, setPicked] = useState<TimeSlot | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const disabled = picked !== null || cancelled;

  if (cancelled) {
    return (
      <div
        className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 max-w-md"
        data-testid="time-picker-cancelled"
      >
        Cancelled — no time picked.
      </div>
    );
  }

  if (picked) {
    return (
      <div
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 max-w-md"
        data-testid="time-picker-picked"
      >
        <p className="text-sm text-amber-900">
          Booked for <span className="font-bold">{picked.label}</span>
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-amber-200 bg-white p-5 shadow-lg max-w-md"
      data-testid="time-picker-card"
    >
      <p className="text-xs uppercase tracking-wider text-amber-700 font-semibold">
        Book a call
      </p>
      <h3 className="text-base font-bold text-gray-900 mt-1">{topic}</h3>
      {attendee && (
        <p className="text-sm text-gray-600 mt-0.5">With {attendee}</p>
      )}

      <p className="text-sm text-gray-700 mt-3 mb-2">Pick a time:</p>
      <div className="grid grid-cols-2 gap-2">
        {slots.map((s) => (
          <button
            key={s.iso}
            disabled={disabled}
            onClick={() => {
              setPicked(s);
              onSubmit({ chosen_time: s.iso, chosen_label: s.label });
            }}
            className="rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {s.label}
          </button>
        ))}
      </div>
      <button
        disabled={disabled}
        onClick={() => {
          setCancelled(true);
          onSubmit({ cancelled: true });
        }}
        className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50"
      >
        None of these work
      </button>
    </div>
  );
}
