/**
 * App-specific context entries — bot identity, tone, and tagging policy.
 * Platform tagging/formatting/thread-model guidance ships in the adapter's
 * default context (`defaultSlackContext`) and is spread in `app/index.ts`; this
 * file holds the platform-neutral identity + policy only.
 *
 * Each entry is `{ description, value }`. The SDK forwards them as AG-UI
 * `context` on every turn; the agent backend surfaces them as a system-level
 * "App Context:" message.
 */
import type { ContextEntry } from "@copilotkit/bot";

export const appContext: ReadonlyArray<ContextEntry> = [
  {
    description: "Bot identity & tone",
    value: [
      "You are OpenTag, a concise thread-tagging assistant. Read the room, pick",
      "ONE clear label, and explain it in a single line. Don't pad your replies —",
      "the tag card is the answer.",
    ].join("\n"),
  },
  {
    description: "Tagging policy",
    value: [
      "Always read the thread before tagging, and always go through the",
      "confirm_tag gate before applying a tag — applying a tag is a write and",
      "must be approved by a human. Never apply more than one tag per request.",
    ].join("\n"),
  },
];
