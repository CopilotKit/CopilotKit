"use client";

// Headless interrupt demo. The chat is on the right, and an app surface is on
// the left. When the agent's `schedule_meeting` tool needs the user, a time
// picker appears IN THE APP SURFACE, not inside the chat. Picking a slot
// answers the tool, the picker goes away, and the agent confirms in chat.

// @region[headless-useinterrupt-primitives]
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  CopilotKit,
  CopilotChat,
  useFrontendTool,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { AppSurface, TimeSlotPopup } from "./app-surface";
import type { InterruptHeadlessConfig } from "./config";
import { encodeAnswer, readSchedulingPayload } from "./interrupt-payload";
import type {
  InterruptAnswerKey,
  InterruptPayloadKey,
  PickerResult,
  SchedulingPayload,
} from "./interrupt-payload";
import { useInterruptHeadlessSuggestions } from "./suggestions";

/**
 * The interrupt-headless demo. `config` says how this integration's agent
 * pauses for the time picker.
 */
export function InterruptHeadlessDemo({
  config,
}: {
  config: InterruptHeadlessConfig;
}) {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("interrupt-headless")}
      agent="interrupt-headless"
    >
      {config.mechanism === "interrupt" ? (
        <InterruptLayout payload={config.payload} answer={config.answer} />
      ) : (
        <FrontendToolLayout />
      )}
    </CopilotKit>
  );
}

// The agent's own `schedule_meeting` tool pauses the run with an interrupt.
// With `renderInChat: false`, `useInterrupt` returns the picker element
// instead of putting it in the chat, so the app surface can show it.
function InterruptLayout({
  payload,
  answer,
}: {
  payload: InterruptPayloadKey;
  answer: InterruptAnswerKey;
}) {
  const [resolving, setResolving] = useState(false);
  const interruptElement = useInterrupt({
    agentId: "interrupt-headless",
    renderInChat: false,
    render: ({ event, interrupt, resolve }) => {
      const meeting = readSchedulingPayload(payload, { event, interrupt });
      const resumeAfterPaint = (response: unknown) => {
        setResolving(true);
        // A frame boundary lets React paint before resume unmounts the
        // interrupt, but `requestAnimationFrame` never fires in a background
        // tab, so a timer runs whichever comes first and the resume cannot be
        // stranded. Fire-and-forget by design: a rejected resume is re-surfaced
        // globally instead of disappearing.
        let fired = false;
        const resumeOnce = () => {
          if (fired) return;
          fired = true;
          void resolve(response).then(
            () => setResolving(false),
            (error: unknown) => {
              setResolving(false);
              queueMicrotask(() => {
                throw error;
              });
            },
          );
        };
        requestAnimationFrame(resumeOnce);
        window.setTimeout(resumeOnce, 100);
      };
      return (
        <TimeSlotPopup
          meeting={meeting}
          onAnswer={(result) => resumeAfterPaint(encodeAnswer(answer, result))}
        />
      );
    },
  });

  useEffect(() => {
    if (interruptElement) {
      setResolving(false);
    }
  }, [interruptElement]);

  useInterruptHeadlessSuggestions();

  return <DemoLayout picker={interruptElement} resolving={resolving} />;
}
// @endregion[headless-useinterrupt-primitives]

// The agent calls a `schedule_meeting` tool that this page registers. The
// handler shows the picker, then waits for the user before it returns the
// tool result.
function FrontendToolLayout() {
  const [pending, setPending] = useState<SchedulingPayload | null>(null);
  // Resolves the tool call that is waiting for the user. The handler sets it,
  // and the picker calls it when the user picks a slot or cancels.
  const resolverRef = useRef<((result: PickerResult) => void) | null>(null);

  useInterruptHeadlessSuggestions();

  // @region[headless-promise-primitives]
  useFrontendTool({
    name: "schedule_meeting",
    description:
      "Ask the user to pick a time slot for a meeting via a picker popup " +
      "that appears outside the chat. Blocks until the user chooses a " +
      "slot or cancels.",
    parameters: z.object({
      topic: z
        .string()
        .describe("Short human-readable description of the meeting."),
      attendee: z
        .string()
        .optional()
        .describe("Who the meeting is with (optional)."),
    }),
    // Shows the picker, then returns a Promise that resolves only when the
    // user answers in the app surface.
    handler: async ({ topic, attendee }) => {
      setPending({ topic, attendee });
      const result = await new Promise<PickerResult>((resolve) => {
        resolverRef.current = resolve;
      });
      setPending(null);
      if ("cancelled" in result) {
        return "User cancelled. Meeting NOT scheduled.";
      }
      return `Meeting scheduled for ${result.chosen_label}.`;
    },
    // Render nothing inside the chat: the UI lives in the app surface.
    render: () => null,
  });
  // @endregion[headless-promise-primitives]

  const answer = (result: PickerResult) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(result);
  };

  const picker =
    pending === null ? null : (
      <TimeSlotPopup meeting={pending} onAnswer={answer} />
    );
  return <DemoLayout picker={picker} resolving={false} />;
}

function DemoLayout({
  picker,
  resolving,
}: {
  picker: ReactElement | null;
  resolving: boolean;
}) {
  return (
    <div className="grid h-screen grid-cols-[1fr_420px] bg-[#FAFAFC] dark:bg-background">
      <AppSurface picker={picker} resolving={resolving} />
      <div className="border-l border-[#DBDBE5] bg-white dark:border-border dark:bg-background">
        <CopilotChat agentId="interrupt-headless" className="h-full" />
      </div>
    </div>
  );
}
