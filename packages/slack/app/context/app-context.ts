/**
 * App-specific context entries — bot identity, tone, policy, etc.
 * Universal-Slack knowledge (how to tag, how mrkdwn works, the thread
 * model) lives in `src/middlewares/` and is auto-included; this file
 * is where app-level knowledge belongs.
 *
 * Wire `appContext` into `createSlackBridge({context: appContext})`.
 *
 * Each entry is `{description, value}`. The SDK forwards them as
 * AG-UI `context` on every turn; the agent backend's CopilotKit
 * middleware surfaces them as a system-level "App Context:" message.
 */
import type { SlackContextEntry } from "../../src/index.js";

export const appContext: ReadonlyArray<SlackContextEntry> = [
  {
    description: "Bot identity (example entry)",
    value: [
      "You are the example CopilotKit AG-UI Slack bot. Be helpful, brief,",
      "and friendly. This entry is here to show how an app contributes",
      "its own context — replace it with whatever your bot needs to know.",
    ].join("\n"),
  },
];
