"use client";

// Interrupt-based Generative UI demo, adapted for the Microsoft Agent
// Framework (.NET) showcase.
//
// Adaptation note — the original LangGraph demo uses LangGraph's
// `interrupt()` primitive to pause execution inside a backend tool and
// surface a payload to the frontend's `useInterrupt` hook. .NET's
// ChatClientAgent has NO equivalent pause/resume primitive, so we shim the
// behavior as an "approval-mode" frontend tool: `useFrontendTool` declares
// `schedule_meeting` on the client with an async handler that resolves
// when the user makes a selection. The backend agent calls the tool, the
// frontend handler renders the TimePickerCard, awaits the user's choice,
// and returns a plain-text result string. Visually and semantically this
// is indistinguishable from the interrupt-based flow.

import React, { useMemo, useRef, useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { TimePickerCard, TimeSlot } from "./time-picker-card";

const DEFAULT_SLOTS: TimeSlot[] = [
  { label: "Tomorrow 10:00 AM", iso: "2026-04-25T10:00:00-07:00" },
  { label: "Tomorrow 2:00 PM", iso: "2026-04-25T14:00:00-07:00" },
  { label: "Monday 9:00 AM", iso: "2026-04-27T09:00:00-07:00" },
  { label: "Monday 3:30 PM", iso: "2026-04-27T15:30:00-07:00" },
];

type MeetingDecision =
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

  // Per-tool-call decision registry. When the render callback captures the
  // user's pick we store it keyed by an auto-incrementing id; the async
  // handler polls this registry until a decision shows up. This keeps the
  // render callback decoupled from the handler's promise lifecycle
  // (important because `useFrontendTool`'s render callback may re-render
  // many times as args stream in, but the handler runs exactly once per
  // tool call).
  const decisionsRef = useRef<Map<number, MeetingDecision>>(new Map());
  const callIdRef = useRef(0);
  const [activeCallId, setActiveCallId] = useState<number | null>(null);

  const nextCallId = useMemo(
    () => () => {
      callIdRef.current += 1;
      return callIdRef.current;
    },
    [],
  );

  // @region[frontend-promise-handler]
  useFrontendTool({
    name: "schedule_meeting",
    description:
      "Ask the user to pick a time slot for a call via an in-chat picker. " +
      "Returns a plain-text result describing the chosen slot or that the " +
      "user cancelled.",
    parameters: z.object({
      topic: z
        .string()
        .describe("Short human-readable description of the call's purpose."),
      attendee: z
        .string()
        .optional()
        .describe("Who the call is with (optional)."),
    }),
    // Async handler — the approval-mode shim that stands in for
    // LangGraph's `interrupt()`. We return a Promise that resolves only
    // after the user interacts with the TimePickerCard (via onSubmit in
    // the render callback below). The resolved value mirrors the string
    // that LangGraph's backend tool returned.
    handler: async ({
      topic,
      attendee,
    }: {
      topic: string;
      attendee?: string;
    }) => {
      const id = nextCallId();
      setActiveCallId(id);

      const decision = await new Promise<MeetingDecision>((resolve) => {
        const tick = () => {
          const pending = decisionsRef.current.get(id);
          if (pending) {
            decisionsRef.current.delete(id);
            resolve(pending);
            return;
          }
          // 60ms is a reasonable compromise: fast enough that the user
          // doesn't perceive lag between click and agent confirmation,
          // slow enough that a stalled render doesn't spin the main thread.
          setTimeout(tick, 60);
        };
        tick();
      });

      if ("cancelled" in decision) {
        return `User cancelled. Meeting NOT scheduled: ${topic}`;
      }
      return `Meeting scheduled for ${decision.chosen_label}: ${topic}${attendee ? ` with ${attendee}` : ""}`;
    },
    render: ({ args }) => {
      const topic = (args?.topic as string | undefined) ?? "a call";
      const attendee = args?.attendee as string | undefined;
      return (
        <TimePickerCard
          topic={topic}
          attendee={attendee}
          slots={DEFAULT_SLOTS}
          onSubmit={(result) => {
            if (activeCallId !== null) {
              decisionsRef.current.set(activeCallId, result);
            }
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
