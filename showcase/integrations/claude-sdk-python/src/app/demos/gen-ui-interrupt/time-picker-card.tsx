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
 *
 * In the LangGraph showcase this card is driven by the native
 * `interrupt()` primitive and `useInterrupt`. The Microsoft Agent
 * Framework has no interrupt primitive, so this MS Agent port wires the
 * same card up through `useFrontendTool` with an async handler: when the
 * agent calls `schedule_meeting`, the handler returns a Promise that only
 * resolves once the user picks a slot (or cancels).
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
        className="rounded-2xl border border-[#DBDBE5] bg-[#F7F7F9] p-4 text-sm text-[#57575B] max-w-md"
        data-testid="time-picker-cancelled"
      >
        Cancelled — no time picked.
      </div>
    );
  }

  if (picked) {
    return (
      <div
        className="rounded-2xl border border-[#85ECCE4D] bg-[#85ECCE]/10 p-4 max-w-md"
        data-testid="time-picker-picked"
      >
        <p className="text-sm text-[#010507]">
          Booked for <span className="font-semibold">{picked.label}</span>
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border border-[#DBDBE5] bg-white p-5 shadow-sm max-w-md"
      data-testid="time-picker-card"
    >
      <p className="text-[10px] uppercase tracking-[0.14em] text-[#57575B] font-medium">
        Book a call
      </p>
      <h3 className="text-base font-semibold text-[#010507] mt-1.5">{topic}</h3>
      {attendee && (
        <p className="text-sm text-[#57575B] mt-0.5">With {attendee}</p>
      )}

      <p className="text-sm text-[#57575B] mt-4 mb-2">Pick a time:</p>
      <div className="grid grid-cols-2 gap-2">
        {slots.map((s) => (
          <button
            key={s.iso}
            disabled={disabled}
            data-testid="time-picker-slot"
            onClick={() => {
              setPicked(s);
              onSubmit({ chosen_time: s.iso, chosen_label: s.label });
            }}
            className="rounded-xl border border-[#DBDBE5] bg-white px-3 py-2 text-sm font-medium text-[#010507] hover:border-[#BEC2FF] hover:bg-[#BEC2FF1A] disabled:opacity-50 transition-colors"
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
        className="mt-3 w-full rounded-xl border border-[#E9E9EF] px-3 py-1.5 text-xs text-[#838389] hover:bg-[#FAFAFC] disabled:opacity-50 transition-colors"
      >
        None of these work
      </button>
    </div>
  );
}
