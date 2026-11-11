/**
 * The interrupt demos' scheduling tool and the resume shim it needs.
 *
 * gen-ui-interrupt and interrupt-headless pause `schedule_meeting` until the
 * user picks a time. `@ag-ui/cloudflare-agents` pauses a tool through the AI
 * SDK's tool approval (`toolApproval`, set by the `Interrupt` agent): the run
 * ends with an AG-UI interrupt, and the next
 * run's resume answers it with `{ approved: boolean }`. The two shared pages
 * answer with the picked slot instead (`{ chosen_time, chosen_label }`, or
 * `{ cancelled: true }`), because their picker returns a value rather than a
 * yes/no.
 *
 * `translateSchedulingResume` bridges the two before the adapter reads the
 * request: a picked slot approves the call and is kept for the tool, which
 * runs once approved and reports the slot; a cancel or an empty answer turns
 * into a rejection whose reason the model reads. The OpenAI Agents SDK
 * integration needs the same app-level step (its `SchedulerAgent`).
 */
import { tool } from "ai";
import { z } from "zod";

/** What the time picker sends back. */
export interface MeetingChoice {
  chosen_time?: string;
  chosen_label?: string;
  cancelled?: boolean;
  status?: string;
}

interface ResumeEntry {
  interruptId: string;
  status: "resolved" | "cancelled";
  payload?: unknown;
}

/** Result text of a cancelled booking; the cancel fixtures key on "cancelled". */
export const CANCELLED_REASON = "User cancelled. Meeting NOT scheduled.";
const NO_TIME_REASON = "User did not pick a time. Meeting NOT scheduled.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rewrites the resume entries of a RunAgentInput: a picked slot becomes
 * `{ approved: true }` (the slot goes into `choices`, keyed by the interrupt
 * id, which is the paused call's id), a cancel or an answer without a time
 * becomes `{ approved: false, reason }`. Entries that already answer with
 * `approved`, and cancelled entries, pass through unchanged.
 */
export function translateSchedulingResume(
  input: unknown,
  choices: Map<string, MeetingChoice>,
): unknown {
  if (!isRecord(input) || !Array.isArray(input.resume)) return input;
  const resume = input.resume.map((entry: unknown) => {
    if (!isRecord(entry) || entry.status !== "resolved") return entry;
    const { interruptId, payload } = entry as unknown as ResumeEntry;
    if (typeof payload === "boolean") return entry;
    if (isRecord(payload) && typeof payload.approved === "boolean")
      return entry;

    const choice: MeetingChoice = isRecord(payload)
      ? (payload as MeetingChoice)
      : {};
    if (choice.cancelled || choice.status === "cancelled") {
      return {
        ...entry,
        payload: { approved: false, reason: CANCELLED_REASON },
      };
    }
    if (!choice.chosen_label && !choice.chosen_time) {
      return { ...entry, payload: { approved: false, reason: NO_TIME_REASON } };
    }
    choices.set(interruptId, choice);
    return { ...entry, payload: { approved: true } };
  });
  return { ...input, resume };
}

/**
 * `schedule_meeting`, paused for the user's pick (the `Interrupt` agent
 * requires approval for it). It runs only once the picker approved it, and
 * reports the slot `choices` holds for its call.
 */
export function scheduleMeetingTool(choices: Map<string, MeetingChoice>) {
  return tool({
    description:
      "Ask the user to pick a meeting time, then confirm what was scheduled.",
    inputSchema: z.object({
      topic: z.string().describe("Short description of the meeting purpose."),
      attendee: z.string().optional().describe("Who the meeting is with."),
    }),
    execute: async ({ topic }, { toolCallId }) => {
      const choice = choices.get(toolCallId);
      choices.delete(toolCallId);
      const label = choice?.chosen_label || choice?.chosen_time;
      return label
        ? `Meeting scheduled for ${label}: ${topic}`
        : `${NO_TIME_REASON} Topic: ${topic}`;
    },
  });
}
