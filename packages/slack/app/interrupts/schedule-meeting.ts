/**
 * Worked example: the Slack-side handler for the LangGraph
 * `schedule_meeting` interrupt — the equivalent of the React
 * `useHeadlessInterrupt` time-picker in the showcase
 * `interrupt-headless` demo.
 *
 * Backend (`agent/src/agents/interrupt_agent.py`):
 *
 *   - Backend tool `schedule_meeting(topic, attendee)` calls
 *     `interrupt({topic, attendee, slots: [{label, iso}, ...]})`.
 *   - The AG-UI runtime emits an `on_interrupt` custom event with that
 *     payload and the run finalizes (paused, not finished).
 *   - When the frontend resumes via `runAgent({forwardedProps:
 *     {command: {resume}}})`, `interrupt()` returns `resume`. The tool
 *     turns that into a confirmation string the agent replies with.
 *
 * Frontend (this file) renders a Block Kit picker on pending, replaces
 * it with a "✅ Booked …" confirmation on resolved (or deletes it on
 * cancel/timeout).
 */
import { z } from "zod";
import { defineInterruptHandler } from "../../src/index.js";

export const scheduleMeetingInterrupt = defineInterruptHandler({
  name: "schedule_meeting_picker",
  description: "Render a time-slot picker for the schedule_meeting interrupt.",
  payload: z.object({
    topic: z.string(),
    attendee: z.string().nullable().optional(),
    slots: z.array(z.object({ label: z.string(), iso: z.string() })),
  }),
  fallbackText({ topic }) {
    return `Pick a time for: ${topic}`;
  },
  render(state, api) {
    if (state.status === "pending") {
      const { topic, attendee, slots } = state.payload;
      return [
        { type: "header", text: { type: "plain_text", text: "Pick a time" } },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: attendee ? `*${topic}* — with ${attendee}` : `*${topic}*`,
          },
        },
        ...slots.map((slot) => ({
          type: "actions" as const,
          elements: [
            {
              type: "button" as const,
              text: { type: "plain_text" as const, text: slot.label },
              action_id: api.respond({
                chosen_time: slot.iso,
                chosen_label: slot.label,
              }),
            },
          ],
        })),
        {
          type: "actions",
          elements: [
            {
              type: "button",
              style: "danger",
              text: { type: "plain_text", text: "Cancel" },
              action_id: api.respond({ cancelled: true }),
            },
          ],
        },
      ];
    }
    if (state.status === "resolved") {
      const v = state.value as
        | { chosen_time: string; chosen_label: string }
        | { cancelled: true };
      if ("cancelled" in v) return "delete";
      const { topic, attendee } = state.payload;
      const who = attendee ? ` with ${attendee}` : "";
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:white_check_mark: Booked *${v.chosen_label}*${who} for *${topic}*`,
          },
        },
      ];
    }
    if (state.status === "cancelled") return "delete";
    return "noop";
  },
});
