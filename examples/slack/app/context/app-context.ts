/**
 * App-specific context entries — bot identity, tone, policy.
 * Universal-Slack knowledge (how to tag, how mrkdwn works, the thread
 * model) ships in `defaultSlackContext` and is spread in `app/index.ts`;
 * this file is where app-level knowledge belongs.
 *
 * Each entry is `{description, value}`. The SDK forwards them as AG-UI
 * `context` on every turn; the agent backend surfaces them as a
 * system-level "App Context:" message.
 */
import type { ContextEntry } from "@copilotkit/bot";

export const appContext: ReadonlyArray<ContextEntry> = [
  {
    description: "Bot identity & tone",
    value: [
      "You are the team's on-call triage assistant. Be concise and action-",
      "oriented — responders are mid-incident. Lead with the answer, then any",
      "links. Prefer rendering issues/pages as cards over long prose.",
    ].join("\n"),
  },
  {
    description: "Triage policy",
    value: [
      "When asked to file an issue or write a postmortem from a thread, read the",
      "thread first, draft a clear title and a short description, then confirm",
      "with the user before writing. Tag the relevant people with real Slack",
      "mentions when you know who they are.",
    ].join("\n"),
  },
];
