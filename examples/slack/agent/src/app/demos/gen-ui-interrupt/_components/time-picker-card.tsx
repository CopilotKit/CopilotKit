"use client";

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { Button } from "./button";
import { Badge } from "./badge";

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
 * Renders an in-chat "Book a call" card with a small grid of time slots.
 * Used by `useInterrupt`: when the backend's `schedule_meeting` tool calls
 * `interrupt(...)`, this card appears as a chat message bubble. The user's
 * picked slot (or cancellation) is fed back to the agent via `resolve(...)`.
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
      <Card className="max-w-md" data-testid="time-picker-cancelled">
        <CardContent className="flex items-center gap-2 p-4 pt-4">
          <Badge variant="destructive">Cancelled</Badge>
          <span className="text-sm text-neutral-600">No time picked.</span>
        </CardContent>
      </Card>
    );
  }

  if (picked) {
    return (
      <Card
        className="max-w-md border-emerald-200 bg-emerald-50/40"
        data-testid="time-picker-picked"
      >
        <CardContent className="flex items-center gap-2 p-4 pt-4">
          <Badge variant="success">Booked</Badge>
          <span className="text-sm text-neutral-800">
            <span className="font-semibold">{picked.label}</span>
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-md" data-testid="time-picker-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <Badge variant="outline">Book a call</Badge>
          {attendee && (
            <span className="text-xs text-neutral-500">With {attendee}</span>
          )}
        </div>
        <CardTitle className="pt-1">{topic}</CardTitle>
        <CardDescription>Pick a time that works for you.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {slots.map((s) => (
            <Button
              key={s.iso}
              variant="outline"
              disabled={disabled}
              data-testid="time-picker-slot"
              onClick={() => {
                setPicked(s);
                onSubmit({ chosen_time: s.iso, chosen_label: s.label });
              }}
              className="justify-start"
            >
              {s.label}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setCancelled(true);
            onSubmit({ cancelled: true });
          }}
          className="mt-3 w-full text-neutral-500"
          data-testid="time-picker-cancel"
        >
          None of these work
        </Button>
      </CardContent>
    </Card>
  );
}
