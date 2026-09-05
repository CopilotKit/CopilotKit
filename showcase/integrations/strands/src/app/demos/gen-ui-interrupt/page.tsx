"use client";

import { useState } from "react";
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
/**
 * JSON.parse that never throws and never returns a primitive. Both readers run
 * inside a React render callback, where a throw takes the whole pane down.
 */
function parseObject(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readSchedulingPayload(
  interrupt: { metadata?: unknown; message?: string } | null | undefined,
  eventValue: unknown,
): SchedulingPayload {
  const metadata = interrupt?.metadata as
    | { reason?: SchedulingPayload }
    | undefined;
  if (metadata?.reason && typeof metadata.reason === "object") {
    return metadata.reason;
  }

  // The published TypeScript bridge JSON-encodes the reason into `message`
  // instead of carrying it on metadata.
  const decoded = parseObject(interrupt?.message);
  if (decoded) {
    const nested = (decoded as { reason?: SchedulingPayload }).reason;
    return nested && typeof nested === "object"
      ? nested
      : (decoded as SchedulingPayload);
  }

  // Legacy channel: some adapters pass the payload through as the event value,
  // JSON-encoded or not.
  const legacy =
    typeof eventValue === "string" ? parseObject(eventValue) : eventValue;
  if (!legacy || typeof legacy !== "object") return {};
  const wrapped = (legacy as { metadata?: { reason?: SchedulingPayload } })
    .metadata?.reason;
  if (wrapped && typeof wrapped === "object") return wrapped;
  return legacy as SchedulingPayload;
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
  const [resumeFailed, setResumeFailed] = useState(false);

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
          resumeFailed={resumeFailed}
          onSubmit={(result) => {
            // Defer resolve so React commits the picked/cancelled badge before
            // useInterrupt clears the interrupt element (a single rAF is not
            // reliable: it can fire before React's commit). The rejection is
            // re-surfaced rather than dropped, because the card has already
            // shown a green "Booked" badge by then and a silently failed
            // resume would leave the user reading a success that never
            // happened.
            window.setTimeout(() => {
              void resolve(result).catch((error: unknown) => {
                setResumeFailed(true);
                queueMicrotask(() => {
                  throw error;
                });
              });
            }, 500);
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
