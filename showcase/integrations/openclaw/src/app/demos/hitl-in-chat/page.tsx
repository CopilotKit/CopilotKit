"use client";

// @region[hitl-hook]
// @region[time-slots]
import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useAgentContext,
  useHumanInTheLoop,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { TimePickerCard, TimeSlot } from "./time-picker-card";

// Candidate slots are generated relative to "now" at view time so they are
// always in the future — hardcoded dates go stale and the agent (correctly)
// refuses to confirm a booking in the past.
function buildDefaultSlots(): TimeSlot[] {
  const at = (daysAhead: number, hour: number, minute: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const label = (d: Date) =>
    d.toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  return [at(1, 10, 0), at(1, 14, 0), at(3, 9, 0), at(3, 15, 30)].map((d) => ({
    label: label(d),
    iso: d.toISOString(),
  }));
}
// @endregion[time-slots]

export default function HitlInChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="hitl-in-chat">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  const slots = React.useMemo(() => buildDefaultSlots(), []);

  // @region[agent-steering]
  // Per-demo steering via AG-UI context (clawg-ui appends it to the agent
  // prompt). Keeps the "call book_call" instruction with this demo.
  useAgentContext({
    description: "Operating instructions for this demo",
    value:
      "You are a scheduling assistant. Whenever the user asks to book a call or " +
      "schedule a meeting, you MUST call the book_call tool with a short topic and " +
      "the attendee. When the tool returns the user's chosen slot, confirm it " +
      "concisely. Never propose or confirm a time in the past.",
  });
  // @endregion[agent-steering]

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Book a call with sales",
        message:
          "Please book an intro call with the sales team to discuss pricing.",
      },
      {
        title: "Schedule a 1:1 with Alice",
        message: "Schedule a 1:1 with Alice next week to review Q2 goals.",
      },
    ],
    available: "always",
  });

  useHumanInTheLoop({
    agentId: "hitl-in-chat",
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
    render: ({ args, status, respond }: any) => (
      <TimePickerCard
        topic={args?.topic ?? "a call"}
        attendee={args?.attendee}
        slots={slots}
        status={status}
        onSubmit={(result) => respond?.(result)}
      />
    ),
  });
  // @endregion[hitl-hook]

  return <CopilotChat agentId="hitl-in-chat" className="h-full rounded-2xl" />;
}
