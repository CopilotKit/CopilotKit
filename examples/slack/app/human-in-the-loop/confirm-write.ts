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
 * the "approve the action 20 minutes later" durability story.
 */
import { z } from "zod";
import { defineHumanInTheLoop } from "@copilotkit/slack";
import type { KnownBlock } from "@slack/types";

/** header text is plain_text and capped at 150 chars. */
const header = (text: string): KnownBlock => ({
  type: "header",
  text: { type: "plain_text", text: text.slice(0, 150), emoji: true },
});

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
  // Colored left border that tracks the decision: amber while pending,
  // green once approved, red if declined, gray on cancel/timeout.
  accentColor: (state) => {
    if (state.status === "pending") return "#E2B340";
    if (state.status === "resolved") {
      return (state.value as { confirmed: boolean }).confirmed
        ? "#27AE60"
        : "#EB5757";
    }
    return "#9B9B9B";
  },
  render(state, api) {
    const detailBlock: KnownBlock | undefined = state.props.detail
      ? {
          type: "section",
          text: { type: "mrkdwn", text: state.props.detail },
        }
      : undefined;

    if (state.status === "pending") {
      return [
        header(`📝 ${state.props.action}?`),
        ...(detailBlock ? [detailBlock] : []),
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: ":lock:  Nothing is written until you click *Create*.",
            },
          ],
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              style: "primary",
              text: { type: "plain_text", text: "Create", emoji: true },
              action_id: api.respond({ confirmed: true }),
            },
            {
              type: "button",
              style: "danger",
              text: { type: "plain_text", text: "Cancel", emoji: true },
              action_id: api.respond({ confirmed: false }),
            },
          ],
        },
      ];
    }

    if (state.status === "resolved") {
      const v = state.value as { confirmed: boolean };
      return [
        header(`${v.confirmed ? "✅" : "🚫"} ${state.props.action}`),
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: v.confirmed
                ? ":white_check_mark:  Approved — writing now."
                : ":no_entry_sign:  Declined — nothing was written.",
            },
          ],
        },
      ];
    }

    if (state.status === "cancelled" || state.status === "timeout") {
      const timedOut = state.status === "timeout";
      return [
        header(`${timedOut ? "⏳" : "🚫"} ${state.props.action}`),
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: timedOut
                ? ":hourglass:  Approval timed out — nothing was written."
                : ":no_entry_sign:  Approval cancelled — nothing was written.",
            },
          ],
        },
      ];
    }

    return "noop";
  },
  timeoutMs: 10 * 60_000,
});
