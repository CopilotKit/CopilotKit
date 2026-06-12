/**
 * Slack-platform-universal frontend tools — tools every Slack bot
 * benefits from, regardless of what the bot does. Apps spread
 * `defaultSlackTools` into the `tools:` config they pass to
 * `createBot`.
 */
import { z } from "zod";
import { defineBotTool, type BotTool } from "@copilotkit/bot";

const lookupSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Handle, display name, first name, or email of the person to look up.",
    ),
});

export const lookupSlackUserTool = defineBotTool({
  name: "lookup_slack_user",
  description:
    "Resolve a person to a Slack user ID so you can @-mention them. " +
    "Accepts a handle (`atai`), display name (`Atai Barkai`), first name, " +
    "or email. Returns an object with `found`, and on success a " +
    "`mention` string (e.g. `<@U0B45V75NNR>`) — put that string verbatim " +
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
          email: u.email,
          mention: `<@${u.id}>`,
        }
      : { found: false, query };
  },
});

/**
 * The flat list of tools the SDK ships. Spread into your
 * `createBot({tools: …})`:
 *
 *     tools: [...defaultSlackTools, ...myAppTools],
 */
export const defaultSlackTools: ReadonlyArray<BotTool> = [lookupSlackUserTool];
