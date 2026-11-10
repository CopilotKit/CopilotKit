/**
 * Context entries that tell the model about Google Chat: how replies are
 * formatted and how conversations are organized. Spread
 * `defaultGoogleChatContext` into `createChannel({ context })`.
 */
import type { ContextEntry } from "@copilotkit/channels-core";

/** A Google Chat context entry. */
export type GoogleChatContextEntry = ContextEntry;

/**
 * Tagging procedure context. NOT included in `defaultGoogleChatContext` in
 * v1: it instructs the LLM to call `lookup_google_chat_user`, which only
 * works if a real `lookupUser` is implemented (Google Chat has no
 * bot-accessible user-directory lookup by default). Only add this context —
 * together with `lookupGoogleChatUserTool` — when you have implemented
 * `lookupUser`.
 */
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
    "Write standard Markdown — the adapter translates it to Google Chat's",
    "text format for you before posting. Specifically:",
    "",
    "- **bold** and *italic* both work; the adapter converts them to",
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
    "Google Chat organises conversations into spaces: named spaces, group",
    "chats, and direct messages. Inside a space, messages are grouped into",
    "threads.",
    "",
    "In a named space or group chat, you only see messages that @-mention",
    "you, and you reply in the thread of that message. In a direct message",
    "you see every message. Your replies go to the right place on their",
    "own — you don't need to handle routing yourself.",
  ].join("\n"),
};

/**
 * The default context entries the SDK ships. Spread into your
 * `createChannel({ context: … })`:
 *
 *     context: [...defaultGoogleChatContext, ...myAppContext],
 */
export const defaultGoogleChatContext: ReadonlyArray<GoogleChatContextEntry> = [
  googleChatFormattingContext,
  googleChatConversationModelContext,
];
