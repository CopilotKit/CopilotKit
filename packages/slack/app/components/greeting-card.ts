/**
 * Worked example: a `SlackComponent` that renders a rich greeting card.
 *
 * Anatomy of a Slack component (the agent-side equivalent of React's
 * `useComponent`):
 *   - `name` / `description` — what the LLM sees when picking which
 *     component to render.
 *   - `props` — Zod schema describing the call shape. The SDK converts
 *     this to JSON Schema for the LLM and `safeParse`s the args before
 *     calling `render`, so your render fn sees typed props.
 *   - `render` — pure function: props in, `KnownBlock[]` out. The bridge
 *     posts those blocks via `chat.postMessage` in the current thread.
 *   - `fallbackText` — plain-text preview Slack shows on mobile / in
 *     notifications (required when posting blocks). Optional; falls
 *     back to `description` if omitted.
 *
 * Wire components into `createSlackBridge({components: [...]})` (see
 * `app/index.ts`).
 */
import { z } from "zod";
import { defineSlackComponent } from "../../src/index.js";

const greetingSchema = z.object({
  recipient: z
    .string()
    .min(1)
    .describe("Person being greeted — usually a Slack <@USERID> mention."),
  message: z
    .string()
    .min(1)
    .describe("The greeting text itself, in plain Markdown."),
  emoji: z
    .string()
    .optional()
    .describe("Optional Slack emoji shortcode, e.g. ':wave:'."),
});

export const greetingCardComponent = defineSlackComponent({
  name: "greeting_card",
  description:
    "Render a friendly greeting as a rich Block Kit card with a header, " +
    "the message body, and an optional emoji. Use when the user has " +
    "asked for a 'fancy' or 'rich' greeting, otherwise stick to plain text.",
  props: greetingSchema,
  fallbackText({ recipient, message }) {
    return `Hello ${recipient}! ${message}`;
  },
  render({ recipient, message, emoji }) {
    // Slack `<@USERID>` mentions only render in `mrkdwn` contexts —
    // a `header` block uses `plain_text` and would show the raw
    // `<@U...>` string. Put the greeting in a section/mrkdwn so the
    // mention actually pings the recipient.
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:wave:  *Hello ${recipient}!*`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: emoji ? `${emoji}  ${message}` : message,
        },
      },
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Posted via the example `greeting_card` component.",
          },
        ],
      },
    ];
  },
});
