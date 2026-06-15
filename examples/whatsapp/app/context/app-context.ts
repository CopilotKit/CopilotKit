/**
 * App-specific context entries — bot identity, tone, triage policy.
 * Universal-WhatsApp knowledge (formatting rules, single-message delivery
 * constraints) ships in `defaultWhatsAppContext` and is spread in
 * `app/index.ts`; this file is where app-level knowledge belongs.
 *
 * Each entry is `{description, value}` — BOTH required. The SDK forwards them
 * as AG-UI `context` on every turn; the agent backend surfaces them as a
 * system-level "App Context:" message.
 */
import type { ContextEntry } from "@copilotkit/bot";

export const appContext: ContextEntry[] = [
  {
    description: "Bot persona and triage policy",
    value:
      "You are an on-call triage assistant reachable on WhatsApp. Be concise, " +
      "confirm before any write action, and ask one clarifying question at a time.",
  },
];
