/**
 * Slash commands for OpenTag. Each is registered with the engine via
 * `createBot({ commands })`; an adapter forwards every `/command` it receives
 * and the engine routes by name (ignoring unregistered ones).
 *
 * NOTE: on Slack a command only fires if it's ALSO declared in the Slack app
 * config ("Slash Commands" / manifest) with the same name — Slack won't deliver
 * an unregistered command, even over Socket Mode. (Other adapters register their
 * commands up front; the engine routes by name regardless.)
 *
 * Args arrive as free text (`ctx.text`) on Slack.
 */
import { defineBotCommand } from "@copilotkit/bot";
import type { BotCommand } from "@copilotkit/bot";
import { senderContext } from "../sender-context.js";

export const appCommands: BotCommand[] = [
  // `/tag [note]` — a mention-free entry point. Runs the agent to read the
  // current thread and propose a tag; an optional note steers it. Slash-command
  // args are never posted to the channel, so we inject them as the prompt.
  defineBotCommand({
    name: "tag",
    description: "Read this thread and suggest a tag (no @mention needed).",
    async handler({ thread, text, user }) {
      const prompt = text
        ? `Tag this conversation. Extra context from the user: ${text}`
        : "Tag this conversation: read the thread and propose the single best label.";
      await thread.runAgent({
        prompt,
        context: senderContext(user, thread.platform),
      });
    },
  }),
];
