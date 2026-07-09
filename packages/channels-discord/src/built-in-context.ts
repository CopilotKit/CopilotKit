/**
 * Discord-platform-universal context entries — knowledge the LLM needs
 * about Discord itself (tagging procedure, formatting, conversation
 * model). Apps spread `defaultDiscordContext` into the `context:` config
 * they pass to `createBot`.
 *
 * Each entry is exported individually too so apps can cherry-pick.
 */
import type { ContextEntry } from "@copilotkit/channels";

export const discordTaggingContext: ContextEntry = {
  description: "How to tag/mention people in Discord",
  value:
    "To mention a user, use <@USER_ID> (numeric id). If you only know a name or " +
    "handle, call lookup_discord_user to resolve it to an id first, then mention " +
    "with <@id>. Mention a channel with <#CHANNEL_ID>.",
};

export const discordFormattingContext: ContextEntry = {
  description: "Discord message formatting",
  value:
    "Use standard Markdown: **bold**, *italic*, `code`, ```fenced``` blocks, > quotes, " +
    "and # / ## / ### headings. Discord renders NO tables — never output a pipe table; " +
    "put tabular data in a fenced code block or call the appropriate render tool. " +
    "Mentions use <@USER_ID> and channels <#CHANNEL_ID>.",
};

export const discordConversationModelContext: ContextEntry = {
  description: "The Discord conversation model",
  value:
    "Each channel, thread, and DM is one conversation. You reply in the same channel " +
    "the message arrived in. Use the read-history tool to see prior messages when you " +
    "need context from earlier in the conversation.",
};

/**
 * The default context entries the SDK ships. Spread into your
 * `createBot({context: …})`:
 *
 *     context: [...defaultDiscordContext, ...myAppContext],
 */
export const defaultDiscordContext: ContextEntry[] = [
  discordTaggingContext,
  discordFormattingContext,
  discordConversationModelContext,
];
