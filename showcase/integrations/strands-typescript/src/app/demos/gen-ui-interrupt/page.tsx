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

// Shape the backend `schedule_meeting` tool pauses with: its `interrupt()`
// `reason` payload. `slots` is absent on the Strands path (the tool passes only
// topic and attendee), so the picker falls back to generated slots.
type SchedulingPayload = {
  topic?: string;
  attendee?: string;
  slots?: TimeSlot[];
};

// Read the tool's `interrupt()` reason off an AG-UI interrupt.
//
// The two bridges expose it on different channels: `ag_ui_strands` (Python)
// carries the reason object under `metadata.reason`, while the published
// `@ag-ui/aws-strands` 0.2.3 JSON-encodes it into `message` instead. Both are
// read so one page serves both, and the legacy event value is read last for
// adapters that pass the payload through unwrapped.
function readSchedulingPayload(
  interrupt: { metadata?: unknown; message?: string } | undefined,
  eventValue: unknown,
): SchedulingPayload {
  const metadata = interrupt?.metadata as
    | { reason?: SchedulingPayload }
    | undefined;
  if (metadata?.reason) return metadata.reason;

  if (interrupt?.message) {
    try {
      const decoded = JSON.parse(interrupt.message) as SchedulingPayload;
      if (decoded && typeof decoded === "object") return decoded;
    } catch {
      // A plain-prose message is not a payload; fall through.
    }
  }

  const raw = eventValue ?? {};
  const legacy = (typeof raw === "string" ? JSON.parse(raw) : raw) as
    | SchedulingPayload
    | { metadata?: { reason?: SchedulingPayload } };
  if ("metadata" in legacy) return legacy.metadata?.reason ?? {};
  return legacy;
}

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

  // Native interrupt path. The backend `schedule_meeting` tool calls Strands'
  // `tool_context.interrupt(...)`; the @ag-ui/aws-strands bridge finishes the
  // run with `outcome.type === "interrupt"` and carries the tool's `reason`
  // under the interrupt's `metadata.reason`. `resolve(...)` resumes the same
  // Strands run, handing the selection back to that `interrupt()` call.
  useInterrupt({
    agentId: "gen-ui-interrupt",
    renderInChat: true,
    render: ({ event, interrupt, resolve }) => {
      const payload = readSchedulingPayload(interrupt, event.value);
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
            // Defer resolve so React commits the picked/cancelled state
            // before useInterrupt clears the interrupt element. A single
            // requestAnimationFrame is not reliable — rAF fires before
            // React's commit in some scheduling scenarios. Using a short
            // setTimeout ensures the commit lands first and the user sees
            // the "Booked"/"Cancelled" badge before the card unmounts.
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
