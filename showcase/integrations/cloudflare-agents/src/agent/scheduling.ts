/**
 * The interrupt demos' scheduling tool.
 *
 * gen-ui-interrupt and interrupt-headless pause `schedule_meeting` until the
 * user picks a time. `@ag-ui/cloudflare-agents` pauses a tool through the AI
 * SDK's tool approval (`toolApproval`, set by the `Interrupt` agent): the run
 * ends with an AG-UI interrupt, and the next run's resume answers it. The two
 * shared pages answer with the picked slot (`{ chosen_time, chosen_label }`),
 * or `{ cancelled: true }`. Only a no denies an approval, so either answer
 * runs the tool, and the tool reads it with `run.resumePayload(toolCallId)`.
 */
import { tool } from "ai";
import type { AGUIRun } from "@ag-ui/cloudflare-agents";
import { z } from "zod";

/** What the time picker sends back. */
export interface MeetingChoice {
  chosen_time?: string;
  chosen_label?: string;
  cancelled?: boolean;
}

/** Result text of a cancelled booking; the cancel fixtures key on "cancelled". */
export const CANCELLED_REASON = "User cancelled. Meeting NOT scheduled.";
const NO_TIME_REASON = "User did not pick a time. Meeting NOT scheduled.";

// @region[interrupt-resume-payload]
/**
 * `schedule_meeting`, paused for the user's pick (the `Interrupt` agent
 * requires approval for it). The picker's answer approves the call, so the
 * tool runs, reads the answer from the run and reports what was scheduled.
 */
export function scheduleMeetingTool(run: Pick<AGUIRun, "resumePayload">) {
  return tool({
    description:
      "Ask the user to pick a meeting time, then confirm what was scheduled.",
    inputSchema: z.object({
      topic: z.string().describe("Short description of the meeting purpose."),
      attendee: z.string().optional().describe("Who the meeting is with."),
    }),
    execute: async ({ topic }, { toolCallId }) => {
      const choice = run.resumePayload<MeetingChoice>(toolCallId);
      if (choice?.cancelled) return `${CANCELLED_REASON} Topic: ${topic}`;
      const label = choice?.chosen_label || choice?.chosen_time;
      return label
        ? `Meeting scheduled for ${label}: ${topic}`
        : `${NO_TIME_REASON} Topic: ${topic}`;
    },
  });
}
// @endregion[interrupt-resume-payload]
