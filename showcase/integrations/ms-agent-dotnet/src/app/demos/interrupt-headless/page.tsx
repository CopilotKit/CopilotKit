"use client";

// Headless Interrupt demo, adapted for the Microsoft Agent Framework (.NET)
// showcase.
//
// Adaptation note — the LangGraph reference uses `useCopilotKit` +
// `agent.subscribe(...)` to observe LangGraph `interrupt()` custom events
// and render the picker in an "app surface" pane outside the chat. .NET's
// ChatClientAgent has no interrupt() primitive, so this demo uses the same
// approval-mode shim as `gen-ui-interrupt`: a frontend-tool async handler
// stands in for the backend pause. The tool's render callback intentionally
// returns nothing for chat — the picker is rendered separately in the
// left-pane app surface based on React state that the handler toggles.
//
// Layout: chat on the right, app surface on the left. When the agent calls
// `schedule_meeting`, the handler exposes the pending request via state, the
// app surface renders the picker, the user picks, the handler resolves and
// the agent confirms back in chat. Mechanism differs from LangGraph's
// custom-event approach but the user experience matches.

import React, { useMemo, useRef, useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

type TimeSlot = { label: string; iso: string };

const DEFAULT_SLOTS: TimeSlot[] = [
  { label: "Tomorrow 10:00 AM", iso: "2026-04-25T10:00:00-07:00" },
  { label: "Tomorrow 2:00 PM", iso: "2026-04-25T14:00:00-07:00" },
  { label: "Monday 9:00 AM", iso: "2026-04-27T09:00:00-07:00" },
  { label: "Monday 3:30 PM", iso: "2026-04-27T15:30:00-07:00" },
];

type InterruptPayload = {
  topic?: string;
  attendee?: string;
};

type MeetingDecision =
  | { chosen_time: string; chosen_label: string }
  | { cancelled: true };

export default function InterruptHeadlessDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="interrupt-headless">
      <Layout />
    </CopilotKit>
  );
}

function Layout() {
  const [pending, setPending] = useState<InterruptPayload | null>(null);

  // Each handler invocation registers a resolver here keyed by an
  // auto-incrementing id. The picker UI (rendered in the app surface)
  // looks up the current resolver and calls it with the user's decision.
  // Using a ref rather than state for the resolver map avoids re-rendering
  // the entire tree every time a new tool call arrives.
  const resolverRef = useRef<Map<number, (d: MeetingDecision) => void>>(
    new Map(),
  );
  const activeIdRef = useRef<number | null>(null);
  const callIdRef = useRef(0);

  const nextCallId = useMemo(
    () => () => {
      callIdRef.current += 1;
      return callIdRef.current;
    },
    [],
  );

  const resolveActive = (decision: MeetingDecision) => {
    const id = activeIdRef.current;
    if (id === null) return;
    const resolver = resolverRef.current.get(id);
    if (!resolver) return;
    resolverRef.current.delete(id);
    activeIdRef.current = null;
    setPending(null);
    resolver(decision);
  };

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

  // @region[headless-promise-primitives]
  useFrontendTool({
    name: "schedule_meeting",
    description:
      "Ask the user to pick a time slot for a call via an in-app picker. " +
      "The picker is rendered in a separate app surface, NOT inside chat.",
    parameters: z.object({
      topic: z
        .string()
        .describe("Short human-readable description of the call's purpose."),
      attendee: z
        .string()
        .optional()
        .describe("Who the call is with (optional)."),
    }),
    handler: async ({
      topic,
      attendee,
    }: {
      topic: string;
      attendee?: string;
    }) => {
      const id = nextCallId();
      activeIdRef.current = id;
      setPending({ topic, attendee });

      const decision = await new Promise<MeetingDecision>((resolve) => {
        resolverRef.current.set(id, resolve);
      });

      if ("cancelled" in decision) {
        return `User cancelled. Meeting NOT scheduled: ${topic}`;
      }
      return `Meeting scheduled for ${decision.chosen_label}: ${topic}${attendee ? ` with ${attendee}` : ""}`;
    },
    // Render NOTHING in the chat transcript — this is the headless
    // variant. The picker UI is rendered below by `AppSurface`, which
    // reads the `pending` state set inside the handler.
    render: () => null,
  });
  // @endregion[headless-promise-primitives]

  return (
    <div className="grid h-screen grid-cols-[1fr_420px] bg-[#FAFAFC]">
      <AppSurface
        pending={pending}
        onPick={(slot) =>
          resolveActive({ chosen_time: slot.iso, chosen_label: slot.label })
        }
        onCancel={() => resolveActive({ cancelled: true })}
      />
      <div className="border-l border-[#DBDBE5] bg-white">
        <CopilotChat agentId="interrupt-headless" className="h-full" />
      </div>
    </div>
  );
}

type AppSurfaceProps = {
  pending: InterruptPayload | null;
  onPick: (slot: TimeSlot) => void;
  onCancel: () => void;
};

function AppSurface({ pending, onPick, onCancel }: AppSurfaceProps) {
  return (
    <div
      data-testid="interrupt-headless-app-surface"
      className="relative flex h-full flex-col overflow-hidden"
    >
      <header className="border-b border-[#DBDBE5] bg-white px-8 py-5">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B]">
          Headless interrupt (.NET adapted)
        </div>
        <h1 className="text-xl font-semibold text-[#010507]">Scheduling</h1>
      </header>

      <div className="relative flex flex-1 items-center justify-center p-8">
        {pending ? (
          <TimeSlotPopup
            payload={pending}
            onPick={onPick}
            onCancel={onCancel}
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
