"use client";

import React, { useState } from "react";

export interface TimeSlot {
  label: string;
  iso: string;
}

export type TimePickerStatus = "inProgress" | "executing" | "complete";

export interface TimePickerCardProps {
  topic: string;
  attendee?: string;
  slots: TimeSlot[];
  status: TimePickerStatus;
  onSubmit: (
    result: { chosen_time: string; chosen_label: string } | { cancelled: true },
  ) => void;
}

/**
 * Renders a "Book a call" card with a small grid of time slots.
 * The user picks one slot (or cancels); that resolution is forwarded back
 * to the agent via the onSubmit callback wired up by `useHumanInTheLoop`.
 */
export function TimePickerCard({
  topic,
  attendee,
  slots,
  status,
  onSubmit,
}: TimePickerCardProps) {
  const [picked, setPicked] = useState<TimeSlot | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const disabled = status !== "executing" || picked !== null || cancelled;

  if (cancelled) {
    return (
      <div
        style={{
          borderRadius: "16px",
          border: "1px solid #DBDBE5",
          background: "#F7F7F9",
          padding: "16px",
          fontSize: "14px",
          color: "#57575B",
          maxWidth: "28rem",
        }}
        data-testid="time-picker-cancelled"
      >
        Cancelled — no time picked.
      </div>
    );
  }

  if (picked) {
    return (
      <div
        style={{
          borderRadius: "16px",
          border: "1px solid #85ECCE4D",
          background: "rgba(133, 236, 206, 0.1)",
          padding: "16px",
          maxWidth: "28rem",
        }}
        data-testid="time-picker-picked"
      >
        <p style={{ fontSize: "14px", color: "#010507" }}>
          Booked for <span style={{ fontWeight: 600 }}>{picked.label}</span>
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: "16px",
        border: "1px solid #DBDBE5",
        background: "#fff",
        padding: "20px",
        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        maxWidth: "28rem",
      }}
      data-testid="time-picker-card"
    >
      <p
        style={{
          fontSize: "10px",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "#57575B",
          fontWeight: 500,
        }}
      >
        Book a call
      </p>
      <h3
        style={{
          fontSize: "16px",
          fontWeight: 600,
          color: "#010507",
          marginTop: "6px",
        }}
      >
        {topic}
      </h3>
      {attendee && (
        <p style={{ fontSize: "14px", color: "#57575B", marginTop: "2px" }}>
          With {attendee}
        </p>
      )}

      <p
        style={{
          fontSize: "14px",
          color: "#57575B",
          marginTop: "16px",
          marginBottom: "8px",
        }}
      >
        Pick a time:
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px",
        }}
      >
        {slots.map((s) => (
          <button
            key={s.iso}
            disabled={disabled}
            data-testid="time-picker-slot"
            onClick={() => {
              setPicked(s);
              onSubmit({ chosen_time: s.iso, chosen_label: s.label });
            }}
            style={{
              borderRadius: "12px",
              border: "1px solid #DBDBE5",
              background: "#fff",
              padding: "8px 12px",
              fontSize: "14px",
              fontWeight: 500,
              color: "#010507",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              transition: "border-color 120ms, background 120ms",
            }}
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
        style={{
          marginTop: "12px",
          width: "100%",
          borderRadius: "12px",
          border: "1px solid #E9E9EF",
          padding: "6px 12px",
          fontSize: "12px",
          color: "#838389",
          background: "transparent",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        None of these work
      </button>
    </div>
  );
}
