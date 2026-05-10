"use client";

import {
  CopilotKit,
  CopilotChat,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import { TimePickerCard, TimeSlot } from "./_components/time-picker-card";
import { FALLBACK_SLOTS } from "./fallback-slots";
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

  // @region[frontend-useinterrupt-render]
  // `useInterrupt` is the low-level primitive for handling LangGraph
  // `interrupt(...)` events. The backend's `schedule_meeting` tool surfaces
  // a structured payload — `{ topic, attendee, slots }` — which we render
  // inline in the chat as a message bubble. Calling `resolve(...)` resumes
  // the LangGraph run with the user's selection.
  useInterrupt({
    agentId: "gen-ui-interrupt",
    renderInChat: true,
    render: ({ event, resolve }) => {
      const payload = (event.value ?? {}) as {
        topic?: string;
        attendee?: string;
        slots?: TimeSlot[];
      };
      const slots =
        payload.slots && payload.slots.length > 0
          ? payload.slots
          : FALLBACK_SLOTS;
      return (
        <TimePickerCard
          topic={payload.topic ?? "a call"}
          attendee={payload.attendee}
          slots={slots}
          onSubmit={(result) => resolve(result)}
        />
      );
    },
  });
  // @endregion[frontend-useinterrupt-render]

  return (
    <CopilotChat agentId="gen-ui-interrupt" className="h-full rounded-2xl" />
  );
}
