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

// What the picker shows: the paused `schedule_meeting` call's arguments. The
// tool takes only a topic and an attendee, so `slots` stays empty and the
// picker falls back to generated slots.
type SchedulingPayload = {
  topic?: string;
  attendee?: string;
  slots?: TimeSlot[];
};

// `schedule_meeting` needs approval (AI SDK `toolApproval`), so
// @ag-ui/cloudflare-agents ends the run with a `tool_approval` interrupt
// before the tool runs. Its `metadata.tool_input` holds the call's arguments.
function readSchedulingPayload(
  interrupt: { metadata?: unknown } | null | undefined,
): SchedulingPayload {
  const input = (interrupt?.metadata as { tool_input?: unknown } | undefined)
    ?.tool_input;
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as SchedulingPayload)
    : {};
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
  // The failure banner lives OUTSIDE the interrupt element on purpose. The hook
  // caches the element it rendered, so a picker already on screen never sees an
  // updated prop: a flag threaded into the card would keep showing a stale
  // failure on the NEXT booking, before that booking's resume has even started.
  const [resumeFailed, setResumeFailed] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {resumeFailed && (
        <div
          role="alert"
          data-testid="time-picker-resume-error"
          className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          Your previous selection could not be sent. Please try booking again.
        </div>
      )}
      <div className="min-h-0 flex-1">
        <InterruptChat setResumeFailed={setResumeFailed} />
      </div>
    </div>
  );
}

function InterruptChat({
  setResumeFailed,
}: {
  setResumeFailed: (failed: boolean) => void;
}) {
  useGenUiInterruptSuggestions();

  // Native interrupt path. The run finishes with `outcome.type ===
  // "interrupt"` before `schedule_meeting` runs. `resolve(...)` sends the
  // picked slot as the resume payload, which approves the call; the tool
  // reads the slot from the run (src/agent/scheduling.ts).
  useInterrupt({
    agentId: "gen-ui-interrupt",
    renderInChat: true,
    render: ({ interrupt, resolve }) => {
      const payload = readSchedulingPayload(interrupt);
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
            setResumeFailed(false);
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
