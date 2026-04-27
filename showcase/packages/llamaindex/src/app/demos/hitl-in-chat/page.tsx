"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useHumanInTheLoop,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { TimePickerCard, TimeSlot } from "./time-picker-card";

const DEFAULT_SLOTS: TimeSlot[] = [
  { label: "Tomorrow 10:00 AM", iso: "2026-04-25T10:00:00-07:00" },
  { label: "Tomorrow 2:00 PM", iso: "2026-04-25T14:00:00-07:00" },
  { label: "Monday 9:00 AM", iso: "2026-04-28T09:00:00-07:00" },
  { label: "Monday 3:30 PM", iso: "2026-04-28T15:30:00-07:00" },
];

export default function HitlInChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="human_in_the_loop">
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
    agentId: "human_in_the_loop",
    name: "schedule_meeting",
    description:
      "Ask the user to pick a time slot for a meeting. The picker UI presents fixed candidate slots; the user's choice is returned to the agent.",
    parameters: z.object({
      reason: z
        .string()
        .describe("What the call is about (e.g. 'Intro with sales')"),
    }),
    render: ({ args, status, respond }: any) => (
      <TimePickerCard
        topic={args?.reason ?? "a call"}
        slots={DEFAULT_SLOTS}
        status={status}
        onSubmit={(result) => respond?.(result)}
      />
    ),
  });

  return (
    <CopilotChat agentId="human_in_the_loop" className="h-full rounded-2xl" />
  );
}
