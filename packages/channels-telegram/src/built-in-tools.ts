/**
 * Telegram-platform-universal frontend tools — tools every Telegram bot
 * benefits from, regardless of what the bot does. Apps spread
 * `defaultTelegramTools` into the `tools:` config they pass to
 * `createChannel`.
 */
import { z } from "zod";
import { defineChannelTool } from "@copilotkit/channels-core";
import type { ChannelTool } from "@copilotkit/channels-core";

const lookupSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Handle, display name, or first name of the person to look up."),
});

export const lookupTelegramUserTool = defineChannelTool({
  name: "lookup_telegram_user",
  description:
    "Resolve a person to a Telegram user ID so you can mention them. " +
    "Accepts a handle (`ada`), display name (`Ada Lovelace`), or first name. " +
    "Returns an object with `found`, and on success a " +
    "`mention` string (e.g. `@ada` or `tg://user?id=7`) — put that string verbatim " +
    "in your reply to ping them. If `found` is false, write the plain " +
    "name instead.",
  parameters: lookupSchema,
  async handler({ query }, { thread }) {
    const u = await thread.lookupUser(query);
    return u
      ? {
          found: true,
          query,
          userId: u.id,
          name: u.name,
          handle: u.handle,
          mention: u.handle ? "@" + u.handle : "tg://user?id=" + u.id,
        }
      : { found: false, query };
  },
});

/**
 * The flat list of tools the SDK ships. Spread into your
 * `createChannel({tools: …})`:
 *
 *     tools: [...defaultTelegramTools, ...myAppTools],
 */
export const defaultTelegramTools: ReadonlyArray<ChannelTool> = [
  lookupTelegramUserTool,
];
