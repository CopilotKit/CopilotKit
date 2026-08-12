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

// Shape the backend `schedule_meeting` tool suspends with (its suspendSchema),
// wrapped by the @ag-ui/mastra bridge under `mastra_suspend`.
type SuspendPayload = {
  topic?: string;
  attendee?: string;
  slots?: TimeSlot[];
};

function Chat() {
  useGenUiInterruptSuggestions();

  // Native interrupt path (OSS-383). The backend `schedule_meeting` tool
  // `suspend()`s; the @ag-ui/mastra bridge surfaces that as an AG-UI interrupt
  // and `useInterrupt` renders the picker inline. `resolve(...)` resumes the
  // Mastra run (re-invoking the tool's `execute` with the selection as
  // `resumeData`).
  useInterrupt({
    agentId: "gen-ui-interrupt",
    renderInChat: true,
    render: ({ event, resolve }) => {
      // Mastra wraps the suspend value as
      // `{ type: "mastra_suspend", toolName, suspendPayload, ... }` and the
      // AG-UI adapter JSON-stringifies it — parse, then read `suspendPayload`
      // (NOT the raw value, which is the wrapper).
      const raw = event.value ?? {};
      const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
        suspendPayload?: SuspendPayload;
      } & SuspendPayload;
      const payload: SuspendPayload = parsed.suspendPayload ?? parsed;
      const slots =
        payload.slots && payload.slots.length > 0
          ? payload.slots
          : generateFallbackSlots();
      return (
        <TimePickerCard
          topic={payload.topic ?? "a call"}
          attendee={payload.attendee}
          slots={slots}
          onSubmit={(result) => {
            // Defer resolve so React commits the picked/cancelled badge before
            // useInterrupt clears the interrupt element (a single rAF is not
            // reliable — it can fire before React's commit).
            setTimeout(() => resolve(result), 500);
          }}
        />
      );
    },
  });
  // @endregion[frontend-useinterrupt-render]

  return (
    <CopilotChat agentId="gen-ui-interrupt" className="h-full rounded-2xl" />
  );
}
