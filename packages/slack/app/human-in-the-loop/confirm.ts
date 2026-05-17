/**
 * Worked example: a human-in-the-loop component. The agent calls it
 * like a regular tool; the tool posts an interactive Block Kit message
 * with Yes / No buttons and **blocks waiting for the user to click**.
 * Once the click arrives, `render` is called again with the resolved
 * state and the bridge replaces the original message with a
 * confirmation (or deletes it on cancel).
 *
 * The Slack-side equivalent of React's `useHumanInTheLoop`.
 */
import { z } from "zod";
import { defineHumanInTheLoop } from "../../src/index.js";

export const confirmHitl = defineHumanInTheLoop({
  name: "confirm",
  description:
    "Ask the user to confirm an action before proceeding. Renders an " +
    "interactive Block Kit card with Yes / No buttons; the tool result " +
    "carries the user's choice (or `cancelled` / `timeout`). Use this " +
    "any time you would otherwise need to guess intent on a " +
    "potentially irreversible action.",
  props: z.object({
    question: z.string().min(1).describe("The yes/no question to show the user."),
  }),
  fallbackText({ question }) {
    return `Confirm: ${question}`;
  },
  render(state, api) {
    if (state.status === "pending") {
      return [
        { type: "section", text: { type: "mrkdwn", text: state.props.question } },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              style: "primary",
              text: { type: "plain_text", text: "Yes" },
              action_id: api.respond({ confirmed: true }),
            },
            {
              type: "button",
              style: "danger",
              text: { type: "plain_text", text: "No" },
              action_id: api.respond({ confirmed: false }),
            },
          ],
        },
      ];
    }
    if (state.status === "resolved") {
      const v = state.value as { confirmed: boolean };
      const verb = v.confirmed ? ":white_check_mark: Confirmed" : ":x: Declined";
      return [
        {
          type: "section",
          text: { type: "mrkdwn", text: `${verb}: ${state.props.question}` },
        },
      ];
    }
    if (state.status === "cancelled") return "delete";
    return "noop";
  },
  timeoutMs: 5 * 60_000,
});
