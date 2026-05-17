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
 * it with a self-sufficient confirmation card on resolved (so the
 * user has clear feedback even before the agent's natural-language
 * follow-up lands), or shows a cancelled card on cancel/timeout.
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
      const subtitle = attendee
        ? `*${topic}* — with ${attendee}`
        : `*${topic}*`;
      // Group all time-slot buttons into ONE actions block so they
      // render as a clean horizontal row in Slack (or wrap nicely on
      // narrow widths). Cancel stays in a separate row + danger
      // style so it's visually distinct from the time options.
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:calendar:  *Pick a time*\n${subtitle}`,
          },
        },
        {
          type: "actions",
          elements: slots.map((slot) => ({
            type: "button" as const,
            text: { type: "plain_text" as const, text: slot.label },
            action_id: api.respond({
              chosen_time: slot.iso,
              chosen_label: slot.label,
            }),
          })),
        },
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
      const { topic, attendee } = state.payload;
      if ("cancelled" in v) {
        // Self-contained "cancelled" card — instead of deleting the
        // message, leave a visible breadcrumb so the conversation
        // history is readable. Block contains enough info to read
        // standalone (topic + who + status).
        return [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:no_entry_sign:  *Booking cancelled*\n*${topic}*${attendee ? ` — with ${attendee}` : ""}`,
            },
          },
        ];
      }
      // Self-sufficient confirmation card: title, when, who, what.
      // Reads cleanly even before the agent's natural-language reply
      // lands.
      const detailLines = [
        `*When:* ${v.chosen_label}`,
        attendee ? `*With:* ${attendee}` : null,
        `*Topic:* ${topic}`,
      ].filter(Boolean);
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:white_check_mark:  *Meeting booked*`,
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: detailLines.join("\n") },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Calendar invite will be sent shortly.`,
            },
          ],
        },
      ];
    }
    if (state.status === "cancelled" || state.status === "timeout") {
      const { topic } = state.payload;
      const label =
        state.status === "timeout" ? "Booking timed out" : "Booking cancelled";
      const icon =
        state.status === "timeout" ? ":hourglass:" : ":no_entry_sign:";
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${icon}  *${label}*\n*${topic}*`,
          },
        },
      ];
    }
    return "noop";
  },
});
