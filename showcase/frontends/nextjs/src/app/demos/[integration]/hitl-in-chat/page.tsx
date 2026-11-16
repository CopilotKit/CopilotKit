"use client";

// @region[hitl-hook]
// @region[time-slots]
import {
  CopilotKit,
  CopilotChat,
  useHumanInTheLoop,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { generateFallbackSlots } from "../_shared/interrupt-fallback-slots";
import { TimePickerCard } from "./time-picker-card";

// The candidate slots: tomorrow and next Monday, counted from when the page
// loads, so the dates never go stale.
const CANDIDATE_SLOTS = generateFallbackSlots();
// @endregion[time-slots]

export default function HitlInChatDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("hitl-in-chat")}
      agent="hitl-in-chat"
    >
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

  // @region[hitl-frontend-tool]
  useHumanInTheLoop({
    agentId: "hitl-in-chat",
    name: "book_call",
    description:
      "Use this tool for ANY request to schedule, book, set up, arrange, or organize a call, meeting, 1:1, intro, sync, or chat, including phrasings like 'schedule a 1:1 with Alice', 'book a call', or 'set up a meeting'. It presents the user an in-chat time picker with candidate slots and returns their chosen time. ALWAYS prefer this tool over `schedule_meeting` or any other scheduling tool when the user wants to pick a meeting time in this conversation.",
    parameters: z.object({
      topic: z
        .string()
        .describe("What the call is about (e.g. 'Intro with sales')"),
      attendee: z
        .string()
        .describe("Who the call is with (e.g. 'Alice from Sales')"),
    }),
    render: ({ args, status, respond }) => (
      <TimePickerCard
        topic={args.topic ?? "a call"}
        attendee={args.attendee}
        slots={CANDIDATE_SLOTS}
        status={status}
        onSubmit={(result) => void respond?.(result)}
      />
    ),
  });
  // @endregion[hitl-frontend-tool]
  // @endregion[hitl-hook]

  return <CopilotChat agentId="hitl-in-chat" className="h-full rounded-2xl" />;
}
