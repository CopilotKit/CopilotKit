/**
 * `read_thread` — an app-side `BotTool` that hands the agent the full
 * conversation thread it's replying in. This is what makes "write this
 * incident thread up as a postmortem" possible: the agent calls
 * `read_thread`, gets the actual messages, and summarizes those instead
 * of inventing content.
 *
 * It's a worked example of a `BotTool` that reads conversation history
 * via the platform-agnostic `ctx.thread.getMessages()` capability —
 * the adapter targets the current thread, so no channel/ts plumbing is
 * needed.
 */
import { z } from "zod";
import { defineBotTool } from "@copilotkit/bot";

export const readThreadTool = defineBotTool({
  name: "read_thread",
  description:
    "Fetch the messages in the current conversation thread so you can " +
    "summarize or act on them. Call this before turning a conversation into a " +
    "Linear issue or a Notion postmortem — never guess what was said. Returns " +
    "the messages in chronological order with author and timestamp.",
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
