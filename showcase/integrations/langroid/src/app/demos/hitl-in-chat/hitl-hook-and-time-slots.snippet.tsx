// Docs-only snippet — not imported or rendered. The dashboard demo at
// `page.tsx` for this framework runs a different HITL scenario (a
// generic approve/reject card) that doesn't match the canonical
// `/human-in-the-loop` page's booking + candidate-slots pattern. This
// file shows what the booking shape looks like in the same framework's
// shape, so the docs render real teaching code rather than a missing-
// snippet box.
//
// Mirrors the convention from `tool-rendering/render-flight-tool.snippet.tsx`.

// @region[hitl-hook]
// @region[time-slots]
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";

// Stand-in for the locally-authored picker UI. In a real page, this
// lives at `./time-picker-card.tsx` and exports `TimePickerCard` plus
// the `TimeSlot` type.
type TimeSlot = { label: string; iso: string };
declare const TimePickerCard: React.ComponentType<{
  topic: string;
  attendee?: string;
  slots: TimeSlot[];
  status: string;
  onSubmit: (result: unknown) => void;
}>;

type BookCallRenderProps = {
  args?: { topic?: string; attendee?: string };
  status: string;
  respond?: (result: unknown) => void;
};

const DEFAULT_SLOTS: TimeSlot[] = [
  { label: "Tomorrow 10:00 AM", iso: "2026-04-30T10:00:00-07:00" },
  { label: "Tomorrow 2:00 PM", iso: "2026-04-30T14:00:00-07:00" },
  { label: "Monday 9:00 AM", iso: "2026-05-04T09:00:00-07:00" },
  { label: "Monday 3:30 PM", iso: "2026-05-04T15:30:00-07:00" },
];
// @endregion[time-slots]

export function HitlBookingHook() {
  useHumanInTheLoop({
    name: "book_call",
    description:
      "Ask the user to pick a time slot for a call. The picker UI presents fixed candidate slots; the user's choice is returned to the agent.",
    parameters: z.object({
      topic: z
        .string()
        .describe("What the call is about (e.g. 'Intro with sales')"),
      attendee: z
        .string()
        .describe("Who the call is with (e.g. 'Alice from Sales')"),
    }),
    render: ({ args, status, respond }: BookCallRenderProps) => (
      <TimePickerCard
        topic={args?.topic ?? "a call"}
        attendee={args?.attendee}
        slots={DEFAULT_SLOTS}
        status={status}
        onSubmit={(result) => respond?.(result)}
      />
    ),
  });
  // @endregion[hitl-hook]
}
