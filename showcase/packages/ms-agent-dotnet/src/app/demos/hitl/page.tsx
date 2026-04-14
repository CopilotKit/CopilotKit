"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  DemoErrorBoundary,
  MeetingTimePicker,
  useShowcaseSuggestions,
  demonstrationCatalog,
} from "@copilotkit/showcase-shared";

export default function HitlDemo() {
  return (
    <DemoErrorBoundary demoName="Human in the Loop">
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent="human_in_the_loop"
        a2ui={{ catalog: demonstrationCatalog }}
      >
        <DemoContent />
      </CopilotKit>
    </DemoErrorBoundary>
  );
}

function DemoContent() {
  useShowcaseSuggestions();

  useHumanInTheLoop({
    agentId: "human_in_the_loop",
    name: "scheduleTime",
    description: "Use human-in-the-loop to schedule a meeting with the user.",
    parameters: z.object({
      reasonForScheduling: z
        .string()
        .describe("Reason for scheduling, very brief - 5 words."),
      meetingDuration: z
        .number()
        .describe("Duration of the meeting in minutes"),
    }),
    render: ({ respond, status, args }: any) => {
      return <MeetingTimePicker status={status} respond={respond} {...args} />;
    },
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
