"use client";

import {
  CopilotKit,
  CopilotChat,
  useHumanInTheLoop,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import type { TimeSlot } from "./_components/time-picker-card";
import { TimePickerCard } from "./_components/time-picker-card";
import { generateFallbackSlots } from "../_shared/interrupt-fallback-slots";
import { useGenUiInterruptSuggestions } from "./suggestions";

export function GenUiInterruptChat({
  integration,
  interruptPattern,
}: {
  integration: string;
  interruptPattern: "native" | "promise-based";
}) {
  return (
    <CopilotKit
      runtimeUrl={`/api/${integration}/gen-ui-interrupt`}
      agent="gen-ui-interrupt"
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          {interruptPattern === "promise-based" ? (
            <PromiseInterruptChat />
          ) : (
            <NativeInterruptChat />
          )}
        </div>
      </div>
    </CopilotKit>
  );
}

// Shape the backend `schedule_meeting` tool pauses with. `slots` is absent on
// some paths (e.g. Strands passes only topic and attendee), so the picker
// falls back to generated slots.
type SchedulingPayload = {
  topic?: string;
  attendee?: string;
  slots?: TimeSlot[];
};

/**
 * JSON.parse that never throws and never returns a primitive. The reader runs
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

// Read the tool's `interrupt()` payload off an AG-UI interrupt.
//
// Bridges expose it on different channels: `ag_ui_strands` (Python) carries
// the reason object under `metadata.reason`, while the published
// `@ag-ui/aws-strands` JSON-encodes it into `message`. The legacy event value
// (LangGraph and adapters that pass the payload through unwrapped) is read
// last, so one page serves every native-interrupt backend.
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

  const decoded = parseObject(interrupt?.message);
  if (decoded) {
    const nested = (decoded as { reason?: SchedulingPayload }).reason;
    return nested && typeof nested === "object"
      ? nested
      : (decoded as SchedulingPayload);
  }

  const legacy =
    typeof eventValue === "string" ? parseObject(eventValue) : eventValue;
  if (!legacy || typeof legacy !== "object") return {};
  const wrapped = (legacy as { metadata?: { reason?: SchedulingPayload } })
    .metadata?.reason;
  if (wrapped && typeof wrapped === "object") return wrapped;
  return legacy as SchedulingPayload;
}

// @region[frontend-useinterrupt-render]
function NativeInterruptChat() {
  useGenUiInterruptSuggestions();

  // `useInterrupt` is the low-level primitive for handling LangGraph
  // `interrupt(...)` events. The backend's `schedule_meeting` tool surfaces
  // a structured payload — `{ topic, attendee, slots }` — which we render
  // inline in the chat as a message bubble. Calling `resolve(...)` resumes
  // the LangGraph run with the user's selection.
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

  return (
    <CopilotChat agentId="gen-ui-interrupt" className="h-full rounded-2xl" />
  );
}
// @endregion[frontend-useinterrupt-render]

function PromiseInterruptChat() {
  useGenUiInterruptSuggestions();

  // This framework has no LangGraph-style `interrupt()` primitive, so
  // `useInterrupt({ renderInChat: true })` is silently dead here — it
  // listens for AG-UI `interrupt` events that this backend never emits.
  //
  // The backend instead exposes `schedule_meeting` as a tool the model is
  // instructed to call (Strategy B); the frontend registers a matching
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

  return (
    <CopilotChat agentId="gen-ui-interrupt" className="h-full rounded-2xl" />
  );
}
