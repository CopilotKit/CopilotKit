"use client";

import { useState } from "react";
import type { ReactElement } from "react";
import { generateFallbackSlots } from "../_shared/interrupt-fallback-slots";
import type { PickerResult, SchedulingPayload } from "./interrupt-payload";

/**
 * The left pane: the time picker while the agent waits for the user, a short
 * note while the answer is on its way, and an empty state otherwise.
 */
export function AppSurface({
  picker,
  resolving,
}: {
  picker: ReactElement | null;
  resolving: boolean;
}) {
  return (
    <div
      data-testid="interrupt-headless-app-surface"
      className="relative flex h-full flex-col overflow-hidden"
    >
      <header className="border-b border-[#DBDBE5] bg-white px-8 py-5 dark:border-border dark:bg-card">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B] dark:text-muted-foreground">
          Headless interrupt
        </div>
        <h1 className="text-xl font-semibold text-[#010507] dark:text-foreground">
          Scheduling
        </h1>
      </header>

      <div className="relative flex flex-1 items-center justify-center p-8">
        {picker ?? (resolving ? <ResolvingState /> : <EmptyState />)}
      </div>
    </div>
  );
}

function ResolvingState() {
  return (
    <div data-testid="interrupt-headless-resolving" className="text-center">
      <div className="text-sm font-medium text-[#010507] dark:text-foreground">
        Confirming your selection…
      </div>
      <p className="mt-1 text-sm text-[#57575B] dark:text-muted-foreground">
        The assistant will post the confirmed booking in chat.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      data-testid="interrupt-headless-empty"
      className="max-w-sm text-center"
    >
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-[#DBDBE5] bg-white text-[#85ECCE] dark:border-border dark:bg-card">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </div>
      <div className="text-sm font-medium text-[#010507] dark:text-foreground">
        Nothing scheduled yet
      </div>
      <p className="mt-1 text-sm text-[#57575B] dark:text-muted-foreground">
        Ask the assistant to book something. When it needs your input, a picker
        will appear right here.
      </p>
    </div>
  );
}

/**
 * The time picker. It answers once: the buttons lock on the first click, so
 * a second click cannot race the answer that is already on its way.
 */
export function TimeSlotPopup({
  meeting,
  onAnswer,
}: {
  meeting: SchedulingPayload;
  onAnswer: (result: PickerResult) => void;
}) {
  const [answered, setAnswered] = useState(false);
  // Slots the agent sends win. Otherwise the picker offers slots counted
  // from now, so it always shows future times.
  const slots =
    meeting.slots && meeting.slots.length > 0
      ? meeting.slots
      : generateFallbackSlots();

  const answer = (result: PickerResult) => {
    setAnswered(true);
    onAnswer(result);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      data-testid="interrupt-headless-popup"
      className="w-full max-w-md rounded-2xl border border-[#DBDBE5] bg-white p-6 shadow-[0_20px_40px_-20px_rgba(1,5,7,0.25)] dark:border-border dark:bg-card"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-[#85ECCE]" />
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B] dark:text-muted-foreground">
          Pick a time
        </span>
      </div>
      <h2 className="mb-1 text-lg font-semibold text-[#010507] dark:text-foreground">
        {meeting.topic ?? "Meeting"}
      </h2>
      {meeting.attendee ? (
        <p className="mb-5 text-sm text-[#57575B] dark:text-muted-foreground">
          with{" "}
          <span className="font-medium text-[#010507] dark:text-foreground">
            {meeting.attendee}
          </span>
        </p>
      ) : (
        <div className="mb-5" />
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {slots.map((slot) => (
          <button
            key={slot.iso}
            type="button"
            data-testid={`interrupt-headless-slot-${slot.iso}`}
            disabled={answered}
            onClick={() =>
              answer({ chosen_time: slot.iso, chosen_label: slot.label })
            }
            className="rounded-xl border border-[#DBDBE5] bg-white px-3 py-3 text-sm font-medium text-[#010507] transition-colors hover:border-[#BEC2FF] hover:bg-[#BEC2FF1A] disabled:cursor-not-allowed disabled:opacity-60 dark:border-border dark:bg-card dark:text-foreground dark:hover:border-[#BEC2FF] dark:hover:bg-[#BEC2FF1A]"
          >
            {slot.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="interrupt-headless-cancel"
        disabled={answered}
        onClick={() => answer({ cancelled: true })}
        className="mt-4 w-full rounded-xl border border-[#DBDBE5] bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-[#57575B] transition-colors hover:bg-[#FAFAFC] disabled:cursor-not-allowed disabled:opacity-60 dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-muted"
      >
        Cancel
      </button>
    </div>
  );
}
