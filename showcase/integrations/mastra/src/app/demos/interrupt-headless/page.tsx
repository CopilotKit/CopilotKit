"use client";

// Headless Interrupt cell (OSS-383) — native `useInterrupt` in headless mode.
//
// Layout: chat on the right, app surface on the left. The user triggers the
// agent from a chat suggestion. When the backend `schedule_meeting` tool
// `suspend()`s, the @ag-ui/mastra bridge surfaces an AG-UI interrupt;
// `useInterrupt({ renderInChat: false })` returns the picker element which we
// place IN THE APP SURFACE (left pane) rather than inside the chat. Picking a
// slot `resolve(...)`s the interrupt, resuming the Mastra run, and the agent
// confirms back in chat.
//
// `useInterrupt` handles both the standard `RUN_FINISHED` interrupt-outcome and
// the legacy `on_interrupt` custom event, and drives the correct spec `resume`
// on CopilotKit ≥1.61.2 — so this cell no longer hand-rolls the resume plumbing.

// @region[headless-useinterrupt-primitives]
import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import { generateFallbackSlots } from "../_shared/interrupt-fallback-slots";
import type { TimeSlot } from "../_shared/interrupt-fallback-slots";

// Shape the backend `schedule_meeting` tool suspends with, wrapped by the
// @ag-ui/mastra bridge under `mastra_suspend`.
type SuspendPayload = {
  topic?: string;
  attendee?: string;
  slots?: TimeSlot[];
};

export default function InterruptHeadlessDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="interrupt-headless">
      <Layout />
    </CopilotKit>
  );
}

function Layout() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Book a call with sales",
        message: "Book an intro call with the sales team to discuss pricing.",
      },
      {
        title: "Schedule a 1:1 with Alice",
        message: "Schedule a 1:1 with Alice next week to review Q2 goals.",
      },
    ],
    available: "always",
  });

  // Headless: the hook RETURNS the interrupt element (or null) instead of
  // publishing it into the chat, so we can place it in the app surface.
  const interruptEl = useInterrupt({
    agentId: "interrupt-headless",
    renderInChat: false,
    render: ({ event, resolve }) => {
      // Mastra wraps the suspend value as `{ type: "mastra_suspend",
      // suspendPayload, ... }`, JSON-stringified — parse then read
      // `suspendPayload` (not the raw wrapper).
      const raw = event.value ?? {};
      const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
        suspendPayload?: SuspendPayload;
      } & SuspendPayload;
      const payload: SuspendPayload = parsed.suspendPayload ?? parsed;
      return (
        <TimeSlotPopup
          payload={payload}
          onPick={(slot) =>
            setTimeout(
              () =>
                resolve({ chosen_time: slot.iso, chosen_label: slot.label }),
              500,
            )
          }
          onCancel={() => setTimeout(() => resolve({ cancelled: true }), 500)}
        />
      );
    },
  });

  return (
    <div className="grid h-screen grid-cols-[1fr_420px] bg-[#FAFAFC]">
      <AppSurface interruptEl={interruptEl} />
      <div className="border-l border-[#DBDBE5] bg-white">
        <CopilotChat agentId="interrupt-headless" className="h-full" />
      </div>
    </div>
  );
}
// @endregion[headless-useinterrupt-primitives]

function AppSurface({
  interruptEl,
}: {
  interruptEl: React.ReactElement | null;
}) {
  return (
    <div
      data-testid="interrupt-headless-app-surface"
      className="relative flex h-full flex-col overflow-hidden"
    >
      <header className="border-b border-[#DBDBE5] bg-white px-8 py-5">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B]">
          Headless interrupt
        </div>
        <h1 className="text-xl font-semibold text-[#010507]">Scheduling</h1>
      </header>

      <div className="relative flex flex-1 items-center justify-center p-8">
        {interruptEl ?? <EmptyState />}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      data-testid="interrupt-headless-empty"
      className="max-w-sm text-center"
    >
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-[#DBDBE5] bg-white text-[#85ECCE]">
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
      <div className="text-sm font-medium text-[#010507]">
        Nothing scheduled yet
      </div>
      <p className="mt-1 text-sm text-[#57575B]">
        Ask the assistant to book something. When it needs your input, a picker
        will appear right here.
      </p>
    </div>
  );
}

type TimeSlotPopupProps = {
  payload: SuspendPayload;
  onPick: (slot: TimeSlot) => void;
  onCancel: () => void;
};

function TimeSlotPopup({ payload, onPick, onCancel }: TimeSlotPopupProps) {
  // Prefer the backend-supplied slots (generated relative to "now" so they
  // never rot); fall back to a fresh local generator only if absent.
  const slots =
    payload.slots && payload.slots.length > 0
      ? payload.slots
      : generateFallbackSlots();
  return (
    <div
      role="dialog"
      aria-modal="false"
      data-testid="interrupt-headless-popup"
      className="w-full max-w-md rounded-2xl border border-[#DBDBE5] bg-white p-6 shadow-[0_20px_40px_-20px_rgba(1,5,7,0.25)]"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-[#85ECCE]" />
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B]">
          Pick a time
        </span>
      </div>
      <h2 className="mb-1 text-lg font-semibold text-[#010507]">
        {payload.topic ?? "Meeting"}
      </h2>
      {payload.attendee ? (
        <p className="mb-5 text-sm text-[#57575B]">
          with{" "}
          <span className="font-medium text-[#010507]">{payload.attendee}</span>
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
            onClick={() => onPick(slot)}
            className="rounded-xl border border-[#DBDBE5] bg-white px-3 py-3 text-sm font-medium text-[#010507] transition-colors hover:border-[#BEC2FF] hover:bg-[#BEC2FF1A]"
          >
            {slot.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="interrupt-headless-cancel"
        onClick={onCancel}
        className="mt-4 w-full rounded-xl border border-[#DBDBE5] bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-[#57575B] transition-colors hover:bg-[#FAFAFC]"
      >
        Cancel
      </button>
    </div>
  );
}
