/**
 * Slash commands for this bot. Each is registered with the engine via
 * `createBot({ commands })`; the Discord adapter forwards every `/command` it
 * receives and the engine routes by name (ignoring unregistered ones).
 *
 * NOTE: a slash command only fires if it's also declared in the Discord app
 * config ("Application Commands") with the same name — Discord won't
 * deliver an unregistered command.
 *
 * Args arrive via `ctx.options` (Discord's native structured args); `ctx.text`
 * is a convenience flat string of all option values joined. The `options` schema
 * is used for registration/typing on Discord.
 */
import { defineBotCommand, type BotCommand } from "@copilotkit/bot";
import { senderContext } from "../sender-context.js";

export const appCommands: BotCommand[] = [
  // `/agent <text>` — a mention-free entry point. Runs the agent with the
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
      try {
        await thread.runAgent({ prompt: text, context: senderContext(user) });
      } catch (err) {
        console.error("[discord-bot] agent run failed:", err);
        await thread
          .post(
            "⚠️ I hit an error reaching the agent and couldn't finish that — please try again in a moment.",
          )
          .catch((e) =>
            console.error("[discord-bot] failed to post error notice:", e),
          );
      }
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
      try {
        await thread.runAgent({ prompt, context: senderContext(user) });
      } catch (err) {
        console.error("[discord-bot] agent run failed:", err);
        await thread
          .post(
            "⚠️ I hit an error reaching the agent and couldn't finish that — please try again in a moment.",
          )
          .catch((e) =>
            console.error("[discord-bot] failed to post error notice:", e),
          );
      }
    },
  }),
];
