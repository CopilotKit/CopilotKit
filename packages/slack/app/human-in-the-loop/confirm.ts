/**
 * Worked example: a human-in-the-loop component. The agent calls it
 * like a regular tool; the tool posts an interactive Block Kit message
 * with Yes / No buttons and **blocks waiting for the user to click**.
 * Once the click arrives, `render` is called again with the resolved
 * state and the bridge replaces the original message with a
 * self-contained confirmation card (clear feedback even before the
 * agent's natural-language follow-up lands).
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
    question: z
      .string()
      .min(1)
      .describe("The yes/no question to show the user."),
  }),
  fallbackText({ question }) {
    return `Confirm: ${question}`;
  },
  render(state, api) {
    if (state.status === "pending") {
      // Pending: question + Yes/No on a single actions row.
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:thinking_face:  *Confirm*\n${state.props.question}`,
          },
        },
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
      // The previous render put the answer in a one-liner that looked
      // a lot like a regular bot message — easy to miss visually,
      // especially in a busy thread. Re-render the question + a
      // distinct "Your answer" line so the resolved state reads as a
      // structured form result, not a sentence.
      const v = state.value as { confirmed: boolean };
      const answerLabel = v.confirmed ? "Yes" : "No";
      const answerIcon = v.confirmed ? ":white_check_mark:" : ":no_entry_sign:";
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:thinking_face:  *Confirmation*\n${state.props.question}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `${answerIcon}  Your answer: *${answerLabel}*`,
            },
          ],
        },
      ];
    }
    if (state.status === "cancelled" || state.status === "timeout") {
      const label =
        state.status === "timeout"
          ? "Confirmation timed out"
          : "Confirmation cancelled";
      const icon =
        state.status === "timeout" ? ":hourglass:" : ":no_entry_sign:";
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${icon}  *${label}*\n${state.props.question}`,
          },
        },
      ];
    }
    return "noop";
  },
  timeoutMs: 5 * 60_000,
});
