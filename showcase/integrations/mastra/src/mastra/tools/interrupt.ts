// @region[backend-suspend-tool]
// Native interrupt backend for the `gen-ui-interrupt` + `interrupt-headless`
// cells (OSS-383). Unlike the old Strategy-B workaround (a frontend-only
// `schedule_meeting` satisfied by `useHumanInTheLoop`), this is a REAL Mastra
// suspend tool: the model calls `schedule_meeting`, the tool `suspend()`s with
// a time-picker payload, and the @ag-ui/mastra bridge maps that to an AG-UI
// interrupt (legacy `on_interrupt` CUSTOM event + the standard `RUN_FINISHED`
// interrupt-outcome, on by default in the v1 bridge). The frontend `useInterrupt`
// hook renders the picker and `resolve(...)`s, which resumes the run — the tool's
// `execute` is re-invoked with `resumeData` carrying the user's selection.
//
// Load-bearing (see the Mastra capability-map memory):
//   - `return suspend(...)` DIRECTLY. `await suspend(); return x` completes the
//     tool, so under fast streaming the agentic loop continues past the pause.
//   - Resume needs instance `storage` (configured on `new Mastra({ storage })`)
//     and the suspend-chunk runId — both handled by the bridge + src/mastra/index.ts.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export interface InterruptTimeSlot {
  label: string;
  iso: string;
}

// Mirror of `src/app/demos/_shared/interrupt-fallback-slots.ts` so the backend
// supplies future-relative candidate slots inside the suspend payload (the
// frontend only falls back to its own generator if these are absent).
function atLocal(date: Date, hour: number, minute = 0): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    minute,
    0,
    0,
  );
}

function nextMonday(from: Date): Date {
  const day = from.getDay();
  let offset = (1 - day + 7) % 7;
  if (offset <= 1) offset += 7;
  const next = new Date(from);
  next.setDate(from.getDate() + offset);
  return next;
}

export function generateCandidateSlots(
  now: Date = new Date(),
): InterruptTimeSlot[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const monday = nextMonday(now);
  const candidates: Array<[string, Date]> = [
    ["Tomorrow 10:00 AM", atLocal(tomorrow, 10)],
    ["Tomorrow 2:00 PM", atLocal(tomorrow, 14)],
    ["Monday 9:00 AM", atLocal(monday, 9)],
    ["Monday 3:30 PM", atLocal(monday, 15, 30)],
  ];
  return candidates.map(([label, date]) => ({
    label,
    iso: date.toISOString(),
  }));
}

export const scheduleMeetingInterruptTool = createTool({
  id: "schedule_meeting",
  description:
    "Ask the user to pick a meeting time. Surfaces an interactive time-picker " +
    "to the user and returns their selection. Call this whenever the user asks " +
    "to book or schedule a meeting.",
  inputSchema: z.object({
    topic: z
      .string()
      .describe("What the meeting is about (e.g. 'Intro with sales')."),
    attendee: z
      .string()
      .optional()
      .describe("Who the meeting is with (e.g. 'Alice'), if known."),
  }),
  suspendSchema: z.object({
    topic: z.string(),
    attendee: z.string().optional(),
    slots: z.array(z.object({ label: z.string(), iso: z.string() })),
  }),
  resumeSchema: z.object({
    chosen_time: z.string().optional(),
    chosen_label: z.string().optional(),
    cancelled: z.boolean().optional(),
  }),
  // Mastra createTool execute signature is `(inputData, executionContext)`:
  // the validated INPUT is the first arg; the ToolExecutionContext is the
  // second. `suspend` / `resumeData` live under `executionContext.agent`
  // (the `AgentToolExecutionContext` sub-object), NOT at the top level.
  // Destructuring them off `executionContext` directly yields `undefined`, so
  // `return suspend(...)` throws `suspend is not a function`; the model gets a
  // tool-error, re-calls, and the loop spins to the step cap with no
  // `tool-call-suspended` chunk. Mirrors the proven @ag-ui/mastra dojo tool.
  execute: async (inputData, executionContext) => {
    const { suspend, resumeData } = executionContext?.agent ?? {};
    // Second pass: the user resolved the interrupt — the run resumes here with
    // their selection. Return a short confirmation the agent narrates.
    if (resumeData) {
      if (resumeData.cancelled) {
        return "The user cancelled — no meeting was scheduled.";
      }
      const when =
        resumeData.chosen_label ?? resumeData.chosen_time ?? "the chosen time";
      return `Scheduled "${inputData.topic}" for ${when}.`;
    }
    // First pass: suspend with the picker payload. Returned directly so the
    // agentic loop pauses here instead of continuing.
    return suspend?.({
      topic: inputData.topic,
      attendee: inputData.attendee,
      slots: generateCandidateSlots(),
    });
  },
});
// @endregion[backend-suspend-tool]
