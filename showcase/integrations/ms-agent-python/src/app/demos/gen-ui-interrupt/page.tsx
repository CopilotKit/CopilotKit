"use client";

// @region[frontend-useinterrupt-render]
import {
  CopilotKit,
  CopilotChat,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import type { TimeSlot } from "./_components/time-picker-card";
import { TimePickerCard } from "./_components/time-picker-card";
import { generateFallbackSlots } from "../_shared/interrupt-fallback-slots";
import { useGenUiInterruptSuggestions } from "./suggestions";

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
  useGenUiInterruptSuggestions();

  // MS Agent Framework has no `interrupt()` primitive, so the LangGraph
  // showcase's `useInterrupt({ renderInChat: true })` hook is silently dead
  // here — it listens for AG-UI `interrupt` events that the MAF backend
  // never emits, leaving the chat stuck on the "[Scheduling...]" tool-call
  // placeholder.
  //
  // `interrupt_agent.py` instead exposes `schedule_meeting` as a tool the
  // model is instructed to call; the frontend registers a matching
  // `useHumanInTheLoop` here, renders the picker inline, and resolves the
  // call via `respond(...)`. UX matches LGP's interrupt-rendered card; the
  // mechanism differs.
  useHumanInTheLoop({
    agentId: "gen-ui-interrupt",
    name: "schedule_meeting",
    description:
      "Ask the user to pick a meeting time. The picker renders inline in " +
      "the chat; the chosen slot is returned to the agent so it can confirm.",
    parameters: z.object({
      topic: z
        .string()
        .describe("What the meeting is about (e.g. 'Intro with sales')"),
      attendee: z
        .string()
        .optional()
        .describe("Who the meeting is with (e.g. 'Alice')"),
    }),
    render: ({ args, respond }: any) => {
      // `TimePickerCard` here is the gen-ui-interrupt-specific variant
      // (under `_components/`) that gates buttons on its own internal
      // `picked`/`cancelled` state — it doesn't take a `status` prop like
      // the hitl-in-chat version. That's fine: the buttons stay clickable
      // until the user makes a choice and `respond(...)` resolves the
      // tool call.
      const topic = (args?.topic as string | undefined) ?? "a call";
      const attendee = args?.attendee as string | undefined;
      const slots = generateFallbackSlots();
      return (
        <TimePickerCard
          topic={topic}
          attendee={attendee}
          slots={slots}
          onSubmit={(result) => respond?.(result)}
        />
      );
    },
  });
  // @endregion[frontend-useinterrupt-render]

  return (
    <CopilotChat agentId="gen-ui-interrupt" className="h-full rounded-2xl" />
  );
}
