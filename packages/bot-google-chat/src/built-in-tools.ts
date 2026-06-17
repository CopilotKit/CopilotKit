/**
 * Google Chat-platform-universal frontend tools — tools every Google Chat bot
 * benefits from, regardless of what the bot does. Apps spread
 * `defaultGoogleChatTools` into the `tools:` config they pass to
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

export const lookupGoogleChatUserTool = defineBotTool({
  name: "lookup_google_chat_user",
  description:
    "Resolve a person to a Google Chat user ID so you can @-mention them. " +
    "Accepts a handle, display name, first name, or email. Returns an object " +
    "with `found`, and on success a `mention` string (e.g. `<users/123456>`) — " +
    "put that string verbatim in your reply to ping them. If `found` is false, " +
    "write the plain name instead.",
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
          mention: `<${u.id}>`,
        }
      : { found: false, query };
  },
});

/**
 * The flat list of tools the SDK ships. Spread into your
 * `createBot({tools: …})`:
 *
 *     tools: [...defaultGoogleChatTools, ...myAppTools],
 */
export const defaultGoogleChatTools: ReadonlyArray<BotTool> = [lookupGoogleChatUserTool];
