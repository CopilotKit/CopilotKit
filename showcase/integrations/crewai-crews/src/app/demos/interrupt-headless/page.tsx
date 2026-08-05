"use client";

// Headless Interrupt cell — renders `useInterrupt` outside the chat.
//
// Layout: chat on the right, empty app surface on the left. The user
// triggers the agent from a chat suggestion. When the backend calls
// `schedule_meeting`, the standard AG-UI interrupt surfaces via the hook
// and we render a time-picker popup IN THE APP SURFACE (left pane) —
// not inside the chat. Picking a slot resolves the interrupt, the
// popup vanishes, and the agent confirms back in chat.

// @region[headless-useinterrupt-primitives]
import React, { useEffect, useState } from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import { generateFallbackSlots } from "../_shared/interrupt-fallback-slots";
import type { TimeSlot } from "../_shared/interrupt-fallback-slots";

type InterruptPayload = {
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
  const [resolving, setResolving] = useState(false);
  const interruptElement = useInterrupt({
    agentId: "interrupt-headless",
    renderInChat: false,
    render: ({ event, interrupt, resolve }) => {
      const metadata = interrupt?.metadata as
        | { crewai?: { output?: InterruptPayload } }
        | undefined;
      const raw = event.value ?? {};
      const fallback = (typeof raw === "string" ? JSON.parse(raw) : raw) as
        | InterruptPayload
        | { metadata?: { crewai?: { output?: InterruptPayload } } };
      const fallbackPayload: InterruptPayload =
        "metadata" in fallback
          ? (fallback.metadata?.crewai?.output ?? {})
          : (fallback as InterruptPayload);
      const payload: InterruptPayload =
        metadata?.crewai?.output ?? fallbackPayload;
      const resumeAfterPaint = (response: unknown) => {
        setResolving(true);
        requestAnimationFrame(() => {
          // The frame boundary must stay fire-and-forget so React can paint the
          // resolving marker before resume unmounts the interrupt. Re-surface a
          // rejected resume globally instead of letting that failure disappear.
          void resolve(response).then(
            () => setResolving(false),
            (error) => {
              setResolving(false);
              queueMicrotask(() => {
                throw error;
              });
            },
          );
        });
      };
      return (
        <TimeSlotPopup
          payload={payload}
          onPick={(slot) => {
            resumeAfterPaint({
              chosen_time: slot.iso,
              chosen_label: slot.label,
            });
          }}
          onCancel={() => {
            resumeAfterPaint({ cancelled: true });
          }}
        />
      );
    },
  });

  useEffect(() => {
    if (interruptElement) {
      setResolving(false);
    }
  }, [interruptElement]);

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
      <AppSurface interruptElement={interruptElement} resolving={resolving} />
      <div className="border-l border-[#DBDBE5] bg-white">
        <CopilotChat agentId="interrupt-headless" className="h-full" />
      </div>
    </div>
  );
}
// @endregion[headless-useinterrupt-primitives]

type AppSurfaceProps = {
  interruptElement: React.ReactElement | null;
  resolving: boolean;
};

function AppSurface({ interruptElement, resolving }: AppSurfaceProps) {
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
        {interruptElement ?? (resolving ? <ResolvingState /> : <EmptyState />)}
      </div>
    </div>
  );
}

function ResolvingState() {
  return (
    <div data-testid="interrupt-headless-resolving" className="text-center">
      <div className="text-sm font-medium text-[#010507]">
        Confirming your selection…
      </div>
      <p className="mt-1 text-sm text-[#57575B]">
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
  // Prefer the slots from the interrupt payload — the backend
  // (`interrupt_agent.py:_candidate_slots`) generates them relative to "now"
  // so the picker always shows future times. Fall back to a fresh
  // local-time generator only if the backend didn't supply any.
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
