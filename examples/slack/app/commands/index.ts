/**
 * Slash commands for this bot. Each is registered with the engine via
 * `createBot({ commands })`; the Slack adapter forwards every `/command` it
 * receives and the engine routes by name (ignoring unregistered ones).
 *
 * NOTE: a slash command only fires if it's also declared in the Slack app
 * config ("Slash Commands" / manifest) with the same name — Slack won't
 * deliver an unregistered command, even over Socket Mode.
 *
 * Args arrive as free text (`ctx.text`) on Slack; `ctx.options` is for
 * surfaces with native structured args (e.g. Discord). The `options` schema
 * is optional and used there for registration/typing.
 */
import { defineBotCommand } from "@copilotkit/bot";
import type { BotCommand } from "@copilotkit/bot";
import { senderContext } from "../sender-context.js";

export const appCommands: BotCommand[] = [
  // `/agent <text>` — a mention-free entry point. (Previously hardcoded in the
  // adapter; now an ordinary, app-owned command.) Runs the agent with the
  // command text as the user prompt, since slash-command args are never
  // posted to the channel for the agent to read from history.
  defineBotCommand({
    name: "agent",
    description: "Ask the triage agent anything (no @mention needed).",
    async handler({ thread, text, user }) {
      if (!text) {
        await thread.post("Usage: `/agent <your question>`");
        return;
      }
      await thread.runAgent({
        prompt: text,
        context: senderContext(user, thread.platform),
      });
    },
  }),

  // `/triage [note]` — summarize the current channel/thread and propose Linear
  // issues to file. Demonstrates a command with its own intent.
  defineBotCommand({
    name: "triage",
    description:
      "Summarize the conversation and propose Linear issues to file.",
    async handler({ thread, text, user }) {
      const prompt = text
        ? `Triage this and propose Linear issues to file: ${text}`
        : "Triage the current conversation: summarize it and propose Linear issues to file.";
      await thread.runAgent({
        prompt,
        context: senderContext(user, thread.platform),
      });
    },
  }),
];
