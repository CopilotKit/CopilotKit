"use client";

// Gen UI Interrupt demo (AG2 port).
//
// The LangGraph version of this demo uses `useInterrupt` with LangGraph's
// native `interrupt()` primitive — the backend pauses the run and surfaces
// a payload that the frontend renders into the chat via the `useInterrupt`
// hook. AG2 does NOT have an equivalent interrupt primitive, so we adapt
// the demo by registering a frontend tool with `useFrontendTool`. The
// handler returns a Promise that only resolves once the user picks a time
// (or cancels), which produces the same UX: the picker appears inline in
// the chat and the agent's tool call blocks until the user decides.

import React, { useRef } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { TimePickerCard, TimeSlot } from "./time-picker-card";

const DEFAULT_SLOTS: TimeSlot[] = [
  { label: "Tomorrow 10:00 AM", iso: "2026-04-25T10:00:00-07:00" },
  { label: "Tomorrow 2:00 PM", iso: "2026-04-25T14:00:00-07:00" },
  { label: "Monday 9:00 AM", iso: "2026-04-28T09:00:00-07:00" },
  { label: "Monday 3:30 PM", iso: "2026-04-28T15:30:00-07:00" },
];

type PickerResult =
  | { chosen_time: string; chosen_label: string }
  | { cancelled: true };

export default function GenUiInterruptDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-interrupt">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // Pending-resolver ref: set by the async handler, called by the render
  // prop when the user clicks a slot or cancels. This is the AG2
  // adaptation of the LangGraph `resolve(...)` callback.
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

  // @region[frontend-promise-handler]
  useFrontendTool({
    name: "schedule_meeting",
    description:
      "Ask the user to pick a time slot for a meeting via an in-chat " +
      "picker. Blocks until the user chooses a slot or cancels.",
    parameters: z.object({
      topic: z
        .string()
        .describe("Short human-readable description of the meeting."),
      attendee: z
        .string()
        .optional()
        .describe("Who the meeting is with (optional)."),
    }),
    // Async handler: returns a Promise that resolves only once the user
    // acts on the picker. This is the AG2 shim for LangGraph's
    // `interrupt()`/`resolve()` pair.
    handler: async (): Promise<string> => {
      const result = await new Promise<PickerResult>((resolve) => {
        resolverRef.current = resolve;
      });
      if ("cancelled" in result && result.cancelled) {
        return "User cancelled. Meeting NOT scheduled.";
      }
      if ("chosen_label" in result) {
        return `Meeting scheduled for ${result.chosen_label}.`;
      }
      return "User did not pick a time. Meeting NOT scheduled.";
    },
    render: ({ args, status }) => {
      if (status === "complete") return null;
      const topic =
        (args as { topic?: string } | undefined)?.topic ?? "a meeting";
      const attendee = (args as { attendee?: string } | undefined)?.attendee;
      return (
        <TimePickerCard
          topic={topic}
          attendee={attendee}
          slots={DEFAULT_SLOTS}
          onSubmit={(result) => {
            const fn = resolverRef.current;
            resolverRef.current = null;
            fn?.(result);
          }}
        />
      );
    },
  });
  // @endregion[frontend-promise-handler]

  return (
    <CopilotChat agentId="gen-ui-interrupt" className="h-full rounded-2xl" />
  );
}
