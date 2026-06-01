/**
 * `read_thread` — a frontend tool that hands the agent the full Slack
 * thread it's replying in. This is what makes "write this incident
 * thread up as a postmortem" possible: the agent calls `read_thread`,
 * gets the actual messages, and summarizes those instead of inventing
 * content.
 *
 * It's a worked example of a `FrontendTool` that reaches into Slack via
 * the `ctx` (the `WebClient` + channel + thread ts) — the same shape any
 * Slack-aware tool uses.
 */
import { z } from "zod";
import type { FrontendTool } from "@copilotkit/slack";

const readThreadSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Max messages to fetch. Returned in chronological order (oldest first). Defaults to 100.",
    ),
});

interface SlackReply {
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
}

export const readThreadTool: FrontendTool<typeof readThreadSchema> = {
  name: "read_thread",
  description:
    "Fetch the messages in the current Slack thread so you can summarize or " +
    "act on them. Call this before turning a conversation into a Linear issue " +
    "or a Notion postmortem — never guess what was said. Returns the messages " +
    "in chronological order with author and timestamp.",
  parameters: readThreadSchema,
  async handler({ limit }, ctx) {
    // No thread ts means this is a brand-new top-level mention with no
    // prior conversation to read.
    if (!ctx.threadTs) {
      return JSON.stringify({
        ok: true,
        messages: [],
        note: "This message is not in a thread yet, so there is no prior conversation to read.",
      });
    }

    try {
      const res = (await ctx.client.conversations.replies({
        channel: ctx.channel,
        ts: ctx.threadTs,
        limit: limit ?? 100,
      })) as { ok?: boolean; messages?: SlackReply[] };

      const messages = (res.messages ?? []).map((m) => ({
        author: m.user ? `<@${m.user}>` : (m.bot_id ?? "unknown"),
        isBot: m.user === ctx.botUserId || Boolean(m.bot_id),
        text: m.text ?? "",
        ts: m.ts,
      }));

      return JSON.stringify({ ok: true, channel: ctx.channel, messages });
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: (err as Error).message,
        hint: "The bot may be missing the `channels:history` / `groups:history` scope, or isn't a member of this channel.",
      });
    }
  },
};
