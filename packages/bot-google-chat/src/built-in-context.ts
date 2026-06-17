/**
 * Google Chat platform-universal context entries — knowledge the LLM needs
 * about Google Chat itself (tagging procedure, Chat text format, space/thread
 * model). Apps spread `defaultGoogleChatContext` into the `context:` config
 * they pass to `createBot`.
 *
 * Each entry is exported individually too so apps can cherry-pick.
 */
import type { ContextEntry } from "@copilotkit/bot";

/** Google Chat context entry — alias of `@copilotkit/bot`'s {@link ContextEntry}. */
export type GoogleChatContextEntry = ContextEntry;

export const googleChatTaggingContext: GoogleChatContextEntry = {
  description: "How to @-mention people on Google Chat — REQUIRED PROCEDURE",
  value: [
    "You are running on Google Chat. Whenever the user asks you to tag,",
    "ping, @-mention, or otherwise notify a specific person by name,",
    "handle, or email, you MUST follow this procedure BEFORE",
    "composing your reply:",
    "",
    "  1. Call the `lookup_google_chat_user` tool with the person's name",
    "     or email as the `query` argument.",
    "  2. If the tool returns `found: true`, paste its `mention` field",
    "     (e.g. `<users/12345>`) verbatim wherever you would have written",
    "     the person's name. This is the ONLY way Google Chat will",
    "     actually notify them.",
    "  3. If the tool returns `found: false`, write the person's plain",
    "     name without an @ — never invent a `<users/ID>` mention.",
    "",
    'Plain text like "Alice" or "@alice" does NOT ping anyone — it',
    "just renders as text. Skipping the tool when a tag was asked",
    "for is a failure of the task.",
  ].join("\n"),
};

export const googleChatFormattingContext: GoogleChatContextEntry = {
  description: "Formatting Google Chat replies",
  value: [
    "Write standard Markdown — the bridge translates it to Google Chat's",
    "text format for you before posting. Specifically:",
    "",
    "- **bold** and *italic* both work; the bridge converts them to",
    "  Google Chat's `*bold*` and `_italic_` syntax.",
    "- Use `inline code` and ```fenced code blocks``` normally.",
    "- Bullet lists with `-` or `*` markers render correctly.",
    "- Links: write `[text](https://url)` — they convert to <url|text>.",
    "- Strikethrough: write `~~text~~` — converts to `~text~`.",
    "",
    "Do NOT pre-emptively use Google Chat's native text syntax (single",
    "`*` for bold, single `_` for italic, `~strike~`, `<url|text>`,",
    "etc.) — that breaks the translator and looks wrong. Just write",
    "standard Markdown.",
  ].join("\n"),
};

export const googleChatConversationModelContext: GoogleChatContextEntry = {
  description: "Google Chat conversation model",
  value: [
    "Google Chat organises conversations into spaces. A space can be a",
    "group room (ROOM), a direct message (DM), or an ad-hoc group DM.",
    "Within a room, messages are grouped into threads.",
    "",
    "Each conversation the bot participates in is either a thread inside",
    "a room (the bot was @-mentioned and the reply lives in the thread)",
    "or a DM. Your replies show up in the same surface — you don't need",
    "to handle routing yourself.",
    "",
    "When a user continues a thread you previously answered in, they",
    "don't need to re-@-mention the bot — just continue in the same",
    "thread naturally. If they send a new top-level message in a room,",
    "they MUST @-mention the bot for it to see the message.",
    "",
    "In a DM space there are no threads; every exchange is a new message",
    "in the same direct-message conversation.",
  ].join("\n"),
};

/**
 * The default context entries the SDK ships. Spread into your
 * `createBot({context: …})`:
 *
 *     context: [...defaultGoogleChatContext, ...myAppContext],
 */
export const defaultGoogleChatContext: ReadonlyArray<GoogleChatContextEntry> = [
  googleChatTaggingContext,
  googleChatFormattingContext,
  googleChatConversationModelContext,
];
