"use client";

// Headless Interrupt cell — demonstrates `useHeadlessInterrupt`.
//
// Layout: chat on the right, empty app surface on the left. The user
// triggers the agent from a chat suggestion. When the backend calls
// `schedule_meeting`, LangGraph's `interrupt()` surfaces via the hook
// and we render a time-picker popup IN THE APP SURFACE (left pane) —
// not inside the chat. Picking a slot resolves the interrupt, the
// popup vanishes, and the agent confirms back in chat.

import React, { useEffect, useMemo, useState } from "react";
import {
  CopilotKit,
  CopilotChat,
  useAgent,
  useConfigureSuggestions,
  useCopilotKit,
} from "@copilotkit/react-core/v2";

const INTERRUPT_EVENT_NAME = "on_interrupt";

type InterruptPayload = {
  topic?: string;
  attendee?: string;
};

type InterruptEvent = {
  name: string;
  value: InterruptPayload;
};

type TimeSlot = { label: string; iso: string };

const DEFAULT_SLOTS: TimeSlot[] = [
  { label: "Tomorrow 10:00 AM", iso: "2026-04-19T10:00:00-07:00" },
  { label: "Tomorrow 2:00 PM", iso: "2026-04-19T14:00:00-07:00" },
  { label: "Monday 9:00 AM", iso: "2026-04-21T09:00:00-07:00" },
  { label: "Monday 3:30 PM", iso: "2026-04-21T15:30:00-07:00" },
];

export default function InterruptHeadlessDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="interrupt-headless">
      <Layout />
    </CopilotKit>
  );
}

function Layout() {
  const { pending, resolve } = useHeadlessInterrupt("interrupt-headless");

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

  return (
    <div className="grid h-screen grid-cols-[1fr_420px] bg-[#FAFAFC]">
      <AppSurface pending={pending} resolve={resolve} />
      <div className="border-l border-[#DBDBE5] bg-white">
        <CopilotChat agentId="interrupt-headless" className="h-full" />
      </div>
    </div>
  );
}

// @region[headless-useinterrupt-primitives]
function useHeadlessInterrupt(agentId: string): {
  pending: InterruptEvent | null;
  resolve: (response: unknown) => void;
} {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId });
  const [pending, setPending] = useState<InterruptEvent | null>(null);

  useEffect(() => {
    let local: InterruptEvent | null = null;
    const sub = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name === INTERRUPT_EVENT_NAME) {
          local = {
            name: event.name,
            value: (event.value ?? {}) as InterruptPayload,
          };
        }
      },
      onRunStartedEvent: () => {
        local = null;
        setPending(null);
      },
      onRunFinalized: () => {
        if (local) {
          setPending(local);
          local = null;
        }
      },
      onRunFailed: () => {
        local = null;
      },
    });
    return () => sub.unsubscribe();
  }, [agent]);

  const resolve = useMemo(
    () => (response: unknown) => {
      const snapshot = pending;
      setPending(null);
      void copilotkit
        .runAgent({
          agent,
          forwardedProps: {
            command: {
              resume: response,
              interruptEvent: snapshot?.value,
            },
          },
        })
        .catch(() => {});
    },
    [agent, copilotkit, pending],
  );

  return { pending, resolve };
}
// @endregion[headless-useinterrupt-primitives]

type AppSurfaceProps = {
  pending: InterruptEvent | null;
  resolve: (response: unknown) => void;
};

function AppSurface({ pending, resolve }: AppSurfaceProps) {
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
        {pending ? (
          <TimeSlotPopup
            payload={pending.value}
            onPick={(slot) =>
              resolve({ chosen_time: slot.iso, chosen_label: slot.label })
            }
            onCancel={() => resolve({ cancelled: true })}
          />
        ) : (
          <EmptyState />
        )}
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
  payload: InterruptPayload;
  onPick: (slot: TimeSlot) => void;
  onCancel: () => void;
};

function TimeSlotPopup({ payload, onPick, onCancel }: TimeSlotPopupProps) {
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
        {DEFAULT_SLOTS.map((slot) => (
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
