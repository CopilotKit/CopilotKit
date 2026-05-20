"use client";

// Headless Interrupt demo (AG2 port).
//
// Layout: chat on the right, empty app surface on the left. The user triggers
// the agent from a chat suggestion. When the agent calls `schedule_meeting`,
// we render a time-picker popup IN THE APP SURFACE (left pane) — outside of
// the chat. Picking a slot resolves the tool call, the popup vanishes, and
// the agent confirms back in chat.
//
// Adaptation: the LangGraph version uses a custom `useHeadlessInterrupt` hook
// built on top of `useAgent` + `useCopilotKit` that reads LangGraph's native
// `interrupt()` event from the AG-UI stream and resumes via
// `copilotkit.runAgent({ forwardedProps: { command: { resume, ... } } })`.
// AG2 has no interrupt primitive, so we instead register `schedule_meeting`
// as a frontend tool and gate the UI on whether the tool is currently
// awaiting a user decision. The async handler returns a Promise that only
// resolves when the user interacts with the external popup — equivalent UX,
// different mechanism.

import React, { useRef, useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

type InterruptPayload = {
  topic?: string;
  attendee?: string;
};

type TimeSlot = { label: string; iso: string };

type PickerResult =
  | { chosen_time: string; chosen_label: string }
  | { cancelled: true };

const DEFAULT_SLOTS: TimeSlot[] = [
  { label: "Tomorrow 10:00 AM", iso: "2026-04-25T10:00:00-07:00" },
  { label: "Tomorrow 2:00 PM", iso: "2026-04-25T14:00:00-07:00" },
  { label: "Monday 9:00 AM", iso: "2026-04-28T09:00:00-07:00" },
  { label: "Monday 3:30 PM", iso: "2026-04-28T15:30:00-07:00" },
];

export default function InterruptHeadlessDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="interrupt-headless">
      <Layout />
    </CopilotKit>
  );
}

function Layout() {
  const [pending, setPending] = useState<InterruptPayload | null>(null);
  // Resolver for the currently-awaiting `schedule_meeting` tool call. Set by
  // the async frontend-tool handler below, called when the user picks a slot
  // or cancels from the external popup.
  const resolverRef = useRef<((result: PickerResult) => void) | null>(null);

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
      "Ask the user to pick a time slot for a meeting via a picker popup " +
      "that appears outside the chat. Blocks until the user chooses a " +
      "slot or cancels.",
    parameters: z.object({
      topic: z
        .string()
        .describe("Short human-readable description of the meeting."),
      attendee: z
        .string()
        .optional()
        .describe("Who the meeting is with (optional)."),
    }),
    // Async handler: sets the pending payload so the popup renders, then
    // returns a Promise that only resolves once the user interacts with the
    // popup. This is the AG2 shim for the LangGraph headless interrupt
    // `resume` flow.
    handler: async ({
      topic,
      attendee,
    }: {
      topic: string;
      attendee?: string;
    }): Promise<string> => {
      setPending({ topic, attendee });
      const result = await new Promise<PickerResult>((resolve) => {
        resolverRef.current = resolve;
      });
      setPending(null);
      if ("cancelled" in result && result.cancelled) {
        return "User cancelled. Meeting NOT scheduled.";
      }
      if ("chosen_label" in result) {
        return `Meeting scheduled for ${result.chosen_label}.`;
      }
      return "User did not pick a time. Meeting NOT scheduled.";
    },
    // Render nothing inside the chat — the UI lives in the app surface.
    render: () => null,
  });
  // @endregion[headless-promise-primitives]

  const resolve = (result: PickerResult) => {
    const fn = resolverRef.current;
    resolverRef.current = null;
    fn?.(result);
  };

  return (
    <div className="grid h-screen grid-cols-[1fr_420px] bg-[#FAFAFC]">
      <AppSurface pending={pending} resolve={resolve} />
      <div className="border-l border-[#DBDBE5] bg-white">
        <CopilotChat agentId="interrupt-headless" className="h-full" />
      </div>
    </div>
  );
}

type AppSurfaceProps = {
  pending: InterruptPayload | null;
  resolve: (result: PickerResult) => void;
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
            payload={pending}
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
