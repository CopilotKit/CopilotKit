/**
 * Leading-keyword commands. A user types e.g. "/triage <text>"; the adapter
 * parses the prefix (default "/") and routes here by name. The command text is
 * injected via runAgent({ prompt }) — the engine's path for input that is NOT
 * in replayed history. The WhatsApp adapter intentionally does NOT persist
 * command turns to history, so do NOT rely on history for the command text.
 */
import { defineBotCommand, type BotCommand } from "@copilotkit/bot";

export const appCommands: BotCommand[] = [
  defineBotCommand({
    name: "triage",
    description:
      "Summarize a report and propose Linear issues to file (no @mention needed).",
    async handler({ thread, text }) {
      const prompt = text
        ? `Triage this report: ${text}`
        : "Triage the current conversation: summarize it and propose Linear issues to file.";
      await thread.runAgent({ prompt });
    },
  }),
];
