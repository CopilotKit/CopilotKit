/**
 * Google Chat-platform-universal frontend tools. Apps spread
 * `defaultGoogleChatTools` into the `tools:` config they pass to
 * `createBot`.
 *
 * Note: in v1 the default list is empty — see {@link lookupGoogleChatUserTool}
 * for why user tagging is not shipped by default.
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

/**
 * Resolves a person to a Google Chat `<users/ID>` mention via
 * `thread.lookupUser`.
 *
 * NOT shipped in `defaultGoogleChatTools` in v1: Google Chat exposes no
 * bot-accessible user-directory lookup, so the default adapter's
 * `lookupUser` always returns `undefined` and this tool would always
 * report `{ found: false }`. To enable it, implement a working
 * `lookupUser` (e.g. via the Admin SDK / People API with domain-wide
 * delegation) and add this tool — together with
 * `googleChatTaggingContext` — to your bot's `tools` / `context`.
 */
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
 *
 * Empty in v1: the only platform-universal candidate,
 * {@link lookupGoogleChatUserTool}, requires a working `lookupUser`
 * that Google Chat does not provide by default, so it is opt-in rather
 * than shipped here.
 */
export const defaultGoogleChatTools: ReadonlyArray<BotTool> = [];
