/**
 * `read_thread` — an app-side `BotTool` that hands the agent the full
 * conversation thread it's replying in. This is what lets OpenTag tag a real
 * conversation: the agent calls `read_thread`, gets the actual messages, and
 * reasons about those instead of inventing content.
 *
 * It's a worked example of a `BotTool` that reads conversation history via the
 * platform-agnostic `ctx.thread.getMessages()` capability — the adapter targets
 * the current thread, so no channel/ts plumbing is needed.
 */
import { z } from "zod";
import { defineBotTool } from "@copilotkit/bot";

export const readThreadTool = defineBotTool({
  name: "read_thread",
  description:
    "Fetch the messages in the current conversation thread so you can decide " +
    "how to tag it. Call this before proposing a tag — never guess what was " +
    "said. Returns the messages in chronological order with author and timestamp.",
  parameters: z.object({}),
  async handler(_args, { thread }) {
    const messages = await thread.getMessages();
    return {
      count: messages.length,
      messages: messages.map((m) => ({
        user: m.user?.name ?? m.user?.handle ?? (m.isBot ? "bot" : "unknown"),
        text: m.text,
        ts: m.ts,
      })),
    };
  },
});
