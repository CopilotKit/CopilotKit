"use client";

import { useState } from "react";
// @region[frontend-useinterrupt-render]
import {
  CopilotKit,
  CopilotChat,
  useHumanInTheLoop,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { generateFallbackSlots } from "../_shared/interrupt-fallback-slots";
import { TimePickerCard } from "./_components/time-picker-card";
import type { GenUiInterruptConfig } from "./config";
import { encodeAnswer, readSchedulingPayload } from "./interrupt-payload";
import type {
  InterruptAnswerKey,
  InterruptPayloadKey,
} from "./interrupt-payload";
import { useGenUiInterruptSuggestions } from "./suggestions";

/**
 * The gen-ui-interrupt demo: when the agent's `schedule_meeting` tool needs
 * the user, a time picker renders inline in the chat. `config` says how this
 * integration's agent pauses for it.
 */
export function GenUiInterruptDemo({
  config,
}: {
  config: GenUiInterruptConfig;
}) {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("gen-ui-interrupt")}
      agent="gen-ui-interrupt"
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          {config.mechanism === "interrupt" ? (
            <InterruptChat payload={config.payload} answer={config.answer} />
          ) : (
            <FrontendToolChat />
          )}
        </div>
      </div>
    </CopilotKit>
  );
}

function InterruptChat({
  payload,
  answer,
}: {
  payload: InterruptPayloadKey;
  answer: InterruptAnswerKey;
}) {
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
        <InterruptPicker
          payload={payload}
          answer={answer}
          setResumeFailed={setResumeFailed}
        />
      </div>
    </div>
  );
}

// The agent's own `schedule_meeting` tool pauses the run with an interrupt.
// `useInterrupt` renders the picker inline in the chat, and `resolve(...)`
// resumes the run with the user's answer.
function InterruptPicker({
  payload,
  answer,
  setResumeFailed,
}: {
  payload: InterruptPayloadKey;
  answer: InterruptAnswerKey;
  setResumeFailed: (failed: boolean) => void;
}) {
  useGenUiInterruptSuggestions();

  useInterrupt({
    agentId: "gen-ui-interrupt",
    renderInChat: true,
    render: ({ event, interrupt, resolve }) => {
      const meeting = readSchedulingPayload(payload, { event, interrupt });
      const slots =
        meeting.slots && meeting.slots.length > 0
          ? meeting.slots
          : generateFallbackSlots();
      return (
        <TimePickerCard
          topic={meeting.topic ?? "a call"}
          attendee={meeting.attendee}
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
              void resolve(encodeAnswer(answer, result)).catch(
                (error: unknown) => {
                  setResumeFailed(true);
                  queueMicrotask(() => {
                    throw error;
                  });
                },
              );
            }, 500);
          }}
        />
      );
    },
  });

  return (
    <CopilotChat agentId="gen-ui-interrupt" className="h-full rounded-2xl" />
  );
}

// The agent calls a `schedule_meeting` tool that this page registers. The
// picker renders inline in the chat, and `respond(...)` sends the user's
// answer back as the tool result.
function FrontendToolChat() {
  useGenUiInterruptSuggestions();

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
    // The card keeps its own picked and cancelled state, so its buttons stay
    // clickable until the user answers.
    render: ({ args, respond }) => (
      <TimePickerCard
        topic={args.topic ?? "a call"}
        attendee={args.attendee}
        slots={generateFallbackSlots()}
        onSubmit={(result) => void respond?.(result)}
      />
    ),
  });
  // @endregion[frontend-useinterrupt-render]

  return (
    <CopilotChat agentId="gen-ui-interrupt" className="h-full rounded-2xl" />
  );
}
