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

// The interrupt `schedule_meeting` pauses with. The adapter publishes the
// paused call's arguments on `metadata.tool_input` (see
// src/demo_agents/interrupt_agent.py); `slots` is never among them, so the
// picker falls back to generated slots.
type SchedulingPayload = {
  topic?: string;
  attendee?: string;
  slots?: TimeSlot[];
};

function readSchedulingPayload(
  interrupt: { metadata?: unknown } | null | undefined,
): SchedulingPayload {
  const metadata = interrupt?.metadata as
    | { tool_input?: SchedulingPayload }
    | undefined;
  const input = metadata?.tool_input;
  return input && typeof input === "object" ? input : {};
}

export default function GenUiInterruptDemo() {
  return (
    <CopilotKit
      useSingleEndpoint
      runtimeUrl="/api/copilotkit"
      agent="gen-ui-interrupt"
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
          className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
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

  // Native interrupt path. The backend `schedule_meeting` tool is marked
  // `needs_approval`, so the Agents SDK pauses the run before the tool runs and
  // the adapter finishes it with `outcome.type === "interrupt"`, the call's
  // arguments on the interrupt's `metadata.tool_input`. `resolve(...)` starts a
  // new run that carries the answer as a `resume` entry: `{ approved: true }`
  // with the pick runs the tool once, `{ approved: false }` cancels it. The
  // server keeps nothing in between.
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
              const answer =
                "cancelled" in result
                  ? { approved: false }
                  : { approved: true, ...result };
              void resolve(answer).catch((error: unknown) => {
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
