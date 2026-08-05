"use client";

// @region[frontend-useinterrupt-render]
import {
  CopilotKit,
  CopilotChat,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import type { TimeSlot } from "./_components/time-picker-card";
import { TimePickerCard } from "./_components/time-picker-card";
import { generateFallbackSlots } from "../_shared/interrupt-fallback-slots";
import { useGenUiInterruptSuggestions } from "./suggestions";

type SchedulingPayload = {
  topic?: string;
  attendee?: string;
  slots?: TimeSlot[];
};

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
  useInterrupt({
    agentId: "gen-ui-interrupt",
    renderInChat: true,
    render: ({ event, interrupt, resolve }) => {
      const metadata = interrupt?.metadata as
        | { crewai?: { output?: SchedulingPayload } }
        | undefined;
      const raw = event.value ?? {};
      const fallback = (typeof raw === "string" ? JSON.parse(raw) : raw) as
        | SchedulingPayload
        | { metadata?: { crewai?: { output?: SchedulingPayload } } };
      const payload =
        metadata?.crewai?.output ??
        ("metadata" in fallback
          ? fallback.metadata?.crewai?.output
          : fallback) ??
        {};
      const slots =
        payload.slots && payload.slots.length > 0
          ? payload.slots
          : generateFallbackSlots();
      return (
        <TimePickerCard
          topic={payload.topic ?? "a call"}
          attendee={payload.attendee}
          slots={slots}
          onSubmit={(result) => setTimeout(() => resolve(result), 500)}
        />
      );
    },
  });

  return (
    <CopilotChat agentId="gen-ui-interrupt" className="h-full rounded-2xl" />
  );
}
// @endregion[frontend-useinterrupt-render]
