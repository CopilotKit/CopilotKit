"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useHumanInTheLoop,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { MeetingTimePicker } from "@copilotkit/showcase-shared";

export default function HitlDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="human_in_the_loop">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Schedule a meeting",
        message:
          "I'd like to schedule a 30-minute meeting to discuss our sales pipeline.",
      },
      {
        title: "Quick sync",
        message: "Schedule a 15-minute quick sync about the Q2 forecast.",
      },
    ],
    available: "always",
  });

  useHumanInTheLoop({
    agentId: "human_in_the_loop",
    name: "schedule_meeting",
    description:
      "Schedule a meeting. The user will be asked to pick a time via the meeting time picker UI.",
    parameters: z.object({
      reason: z.string().describe("Reason for scheduling the meeting."),
      duration_minutes: z
        .number()
        .describe("Duration of the meeting in minutes"),
    }),
    render: ({ args, respond, status }: any) => (
      <MeetingTimePicker
        status={status}
        respond={respond}
        reasonForScheduling={args?.reason}
        meetingDuration={args?.duration_minutes}
      />
    ),
  });

  return (
    <div className="flex justify-center items-center h-full w-full">
      <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg px-6">
        <CopilotChat
          agentId="human_in_the_loop"
          className="h-full rounded-2xl max-w-6xl mx-auto"
        />
      </div>
    </div>
  );
}
