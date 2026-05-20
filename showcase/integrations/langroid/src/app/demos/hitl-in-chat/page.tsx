"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useHumanInTheLoop,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { TimePickerCard, TimeSlot } from "./time-picker-card";

const DEFAULT_SLOTS: TimeSlot[] = [
  { label: "Tomorrow 10:00 AM", iso: "2026-04-30T10:00:00-07:00" },
  { label: "Tomorrow 2:00 PM", iso: "2026-04-30T14:00:00-07:00" },
  { label: "Monday 9:00 AM", iso: "2026-05-04T09:00:00-07:00" },
  { label: "Monday 3:30 PM", iso: "2026-05-04T15:30:00-07:00" },
];

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
        slots={DEFAULT_SLOTS}
        status={status}
        onSubmit={(result) => respond?.(result)}
      />
    ),
  });

  return <CopilotChat agentId="hitl-in-chat" className="h-full rounded-2xl" />;
}
