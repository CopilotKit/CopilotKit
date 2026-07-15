/**
 * Telegram-platform-universal context entries — knowledge the LLM needs
 * about Telegram itself (tagging procedure, Markdown formatting, conversation
 * model). Apps spread `defaultTelegramContext` into the `context:` config
 * they pass to `createChannel`.
 *
 * Each entry is exported individually too so apps can cherry-pick.
 */
import type { ContextEntry } from "@copilotkit/channels";

/** Telegram context entry — alias of `@copilotkit/channels`'s {@link ContextEntry}. */
export type TelegramContextEntry = ContextEntry;

export const telegramTaggingContext: TelegramContextEntry = {
  description: "How to @-mention people on Telegram — REQUIRED PROCEDURE",
  value: [
    "You are running on Telegram. Whenever the user asks you to tag,",
    "ping, @-mention, or otherwise notify a specific person by name,",
    "you MUST follow this procedure BEFORE composing your reply:",
    "",
    "  1. Call the `lookup_telegram_user` tool with the person's name",
    "     as the `query` argument.",
    "  2. If the tool returns a username, write `@username` verbatim",
    "     wherever you would have written the person's name. This is",
    "     the ONLY way Telegram will link to their profile and surface",
    "     the mention to them.",
    "  3. If the tool returns no username (the account has none or was",
    "     not found), write the person's plain display name without @",
    "     — never invent a handle.",
    "",
    'Plain text like "Alice" or "@alice" written without going through',
    "the lookup tool may not match the real handle and will not notify",
    "anyone. Skipping the tool when a tag was asked for is a failure",
    "of the task.",
  ].join("\n"),
};

export const telegramFormattingContext: TelegramContextEntry = {
  description: "Formatting Telegram replies",
  value: [
    "Write standard Markdown — the bridge translates it to Telegram HTML",
    "for you before posting. Specifically:",
    "",
    "- **bold** renders as bold text; *italic* renders as italic.",
    "- Use `inline code` and fenced code blocks (``` ... ```) normally.",
    "- Links: write `[text](https://url)` — they convert to Telegram's",
    "  anchor tags.",
    "- Bullet lists with `-` or `*` markers render as plain indented",
    "  text (Telegram has no native list elements), which still reads",
    "  cleanly.",
    "",
    "Do NOT pre-emptively write raw Telegram HTML (<b>, <i>, <code>,",
    "<a href=...>) — the bridge handles that conversion and double-",
    "encoding will break your output. Just write standard Markdown.",
  ].join("\n"),
};

export const telegramConversationModelContext: TelegramContextEntry = {
  description: "Telegram conversation model",
  value: [
    "Telegram has three distinct conversation surfaces the bot can",
    "operate in, and each has a different threading model:",
    "",
    "  DM (private chat): A single flat ongoing conversation between",
    "  the bot and one user. There are no threads; every message is",
    "  part of the same running dialogue.",
    "",
    "  Forum supergroup (topics enabled): The group is divided into",
    "  named topics, each of which is its own independent conversation.",
    "  The bot participates in one topic at a time; context does not",
    "  bleed across topics.",
    "",
    "  Normal group: The bot only participates when @-mentioned. Each",
    "  mention starts a reply chain, and the bot's context is scoped",
    "  to that chain — other messages in the group that don't mention",
    "  the bot are not visible to it.",
    "",
    "You don't need to handle routing yourself; the runtime delivers",
    "messages in the right context. Just reply naturally.",
  ].join("\n"),
};

/**
 * The default context entries the SDK ships. Spread into your
 * `createChannel({context: …})`:
 *
 *     context: [...defaultTelegramContext, ...myAppContext],
 */
export const defaultTelegramContext: ReadonlyArray<TelegramContextEntry> = [
  telegramTaggingContext,
  telegramFormattingContext,
  telegramConversationModelContext,
];
