import {
  defineChannelTool,
  singleStringParameterSchema,
} from "@copilotkit/channels-core";
import type { ChannelTool } from "@copilotkit/channels-core";

const lookupSchema = singleStringParameterSchema({
  name: "query",
  description:
    "Handle, display name, first name, or email of the person to look up.",
});

/**
 * Resolves a person to a Google Chat `<users/ID>` mention through
 * `thread.lookupUser`.
 *
 * Not in {@link defaultGoogleChatTools}: Google Chat gives an app no user
 * directory, so the adapter's `lookupUser` returns `undefined` and this tool
 * would always answer "not found". Add it, with `googleChatTaggingContext`,
 * after you give the adapter a working `lookupUser` (for example through the
 * Admin SDK with domain-wide delegation).
 */
export const lookupGoogleChatUserTool: ChannelTool = defineChannelTool({
  name: "lookup_google_chat_user",
  description:
    "Resolve a person to a Google Chat user ID so you can @-mention them. " +
    "Accepts a handle, display name, first name, or email. On success it " +
    "returns a `mention` string (e.g. `<users/123456>`) — put that string " +
    "verbatim in your reply to ping them. If `found` is false, write the " +
    "plain name instead.",
  parameters: lookupSchema,
  async handler({ query }, { thread }) {
    const u = await thread.lookupUser(query);
    return u
      ? { found: true, query, userId: u.id, name: u.name, mention: `<${u.id}>` }
      : { found: false, query };
  },
});

/**
 * The tools the adapter ships. Empty: the only platform-wide candidate,
 * {@link lookupGoogleChatUserTool}, needs a user directory Google Chat does
 * not provide.
 */
export const defaultGoogleChatTools: ChannelTool[] = [];
