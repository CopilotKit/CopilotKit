"use client";

/**
 * In-Chat HITL (book_call) demo.
 *
 * Mirrors the hitl-in-chat-booking page at `/demos/hitl-in-chat-booking`
 * but exposed at the canonical `/demos/hitl-in-chat` route that the D5
 * harness expects. The `book_call` tool presents a TimePickerCard with
 * fixed time slots; the user picks one, and the agent acknowledges.
 */

import {
  CopilotKit,
  CopilotChat,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  TimePickerCard,
  TimeSlot,
} from "../hitl-in-chat-booking/time-picker-card";

const DEFAULT_SLOTS: TimeSlot[] = [
  { label: "Tomorrow 10:00 AM", iso: "2026-04-30T10:00:00-07:00" },
  { label: "Tomorrow 2:00 PM", iso: "2026-04-30T14:00:00-07:00" },
  { label: "Monday 9:00 AM", iso: "2026-05-04T09:00:00-07:00" },
  { label: "Monday 3:30 PM", iso: "2026-05-04T15:30:00-07:00" },
];

export default function HitlInChat() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="default">
      <Demo />
    </CopilotKit>
  );
}

function Demo() {
  useHumanInTheLoop({
    agentId: "default",
    name: "book_call",
    description:
      "Ask the user to pick a time slot for a call. The picker UI presents fixed candidate slots; the user's choice is returned to the agent.",
    parameters: z.object({
      topic: z
        .string()
        .describe("What the call is about (e.g. 'Intro with sales')"),
      attendee: z
        .string()
        .describe("Who the call is with (e.g. 'Alice from Sales')"),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: ({ args, status, respond }: any) => (
      <TimePickerCard
        topic={args?.topic ?? "a call"}
        attendee={args?.attendee}
        slots={DEFAULT_SLOTS}
        status={status}
        onSubmit={(result) => respond?.(result)}
      />
    ),
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">In-Chat Booking (HITL)</h1>
      <p className="text-sm opacity-70 mb-6">
        Try: &ldquo;Book a 30-minute onboarding call for Alice.&rdquo; The agent
        renders an inline time picker; pick a slot to confirm.
      </p>
      <CopilotChat agentId="default" />
    </main>
  );
}
