/**
 * `confirm_write` — the human-in-the-loop gate in front of every Linear /
 * Notion write. The agent is instructed (see the system prompt in
 * `runtime.ts`) to call this BEFORE creating an issue or a page; the tool
 * posts an interactive Block Kit card and **blocks until the user clicks
 * Create or Cancel**. The agent only performs the write once this resolves
 * with `{ confirmed: true }`.
 *
 * The Slack-side equivalent of React's `useHumanInTheLoop`. Because #4883's
 * HITL encodes its resume payload into the button `value`, a click still
 * works minutes later — even after a deploy restarted the bridge process —
 * which is exactly the "approve the action 20 minutes later" durability
 * story.
 */
import { z } from "zod";
import { defineHumanInTheLoop } from "@copilotkit/slack";

export const confirmWriteHitl = defineHumanInTheLoop({
  name: "confirm_write",
  description:
    "Ask the user to approve a write before you perform it. Call this with a " +
    "one-line summary of the action you're about to take in Linear or Notion " +
    "(e.g. \"Create CPK issue: 'Checkout 500s under load'\"). Renders Create / " +
    "Cancel buttons; the tool result tells you whether the user confirmed. You " +
    "MUST get a confirmation before creating or modifying anything.",
  props: z.object({
    action: z
      .string()
      .min(1)
      .describe(
        "Short imperative title of the write, e.g. 'Create Linear issue' or " +
          "'Create Notion postmortem'.",
      ),
    detail: z
      .string()
      .optional()
      .describe(
        "The specifics the user is approving — issue title + a one-line " +
          "description, or the page title + section outline.",
      ),
  }),
  fallbackText({ action }) {
    return `Approve: ${action}`;
  },
  render(state, api) {
    const body = (icon: string, label: string) => {
      const lines = [
        `${icon}  *${label}*`,
        `:writing_hand:  ${state.props.action}`,
      ];
      if (state.props.detail) lines.push(state.props.detail);
      return lines.join("\n");
    };

    if (state.status === "pending") {
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: body(":raised_hand:", "Approve this write?"),
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              style: "primary",
              text: { type: "plain_text", text: "Create" },
              action_id: api.respond({ confirmed: true }),
            },
            {
              type: "button",
              style: "danger",
              text: { type: "plain_text", text: "Cancel" },
              action_id: api.respond({ confirmed: false }),
            },
          ],
        },
      ];
    }

    if (state.status === "resolved") {
      const v = state.value as { confirmed: boolean };
      const icon = v.confirmed ? ":white_check_mark:" : ":no_entry_sign:";
      const label = v.confirmed ? "Approved" : "Declined";
      return [
        {
          type: "section",
          text: { type: "mrkdwn", text: body(icon, label) },
        },
      ];
    }

    if (state.status === "cancelled" || state.status === "timeout") {
      const label =
        state.status === "timeout"
          ? "Approval timed out"
          : "Approval cancelled";
      const icon =
        state.status === "timeout" ? ":hourglass:" : ":no_entry_sign:";
      return [
        {
          type: "section",
          text: { type: "mrkdwn", text: body(icon, label) },
        },
      ];
    }

    return "noop";
  },
  timeoutMs: 10 * 60_000,
});
