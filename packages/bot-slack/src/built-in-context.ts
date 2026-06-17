/**
 * Slack-platform-universal context entries — knowledge the LLM needs
 * about Slack itself (tagging procedure, mrkdwn vs Markdown, thread
 * model). Apps spread `defaultSlackContext` into the `context:` config
 * they pass to `createBot`.
 *
 * Each entry is exported individually too so apps can cherry-pick.
 */
import type { ContextEntry } from "@copilotkit/bot";

/** Slack context entry — alias of `@copilotkit/bot`'s {@link ContextEntry}. */
export type SlackContextEntry = ContextEntry;

export const slackTaggingContext: SlackContextEntry = {
  description: "How to @-mention people on Slack — REQUIRED PROCEDURE",
  value: [
    "You are running on Slack. Whenever the user asks you to tag,",
    "ping, @-mention, or otherwise notify a specific person by name,",
    "handle, or email, you MUST follow this procedure BEFORE",
    "composing your reply:",
    "",
    "  1. Call the `lookup_slack_user` tool with the person's name,",
    "     handle, or email as the `query` argument.",
    "  2. If the tool returns `found: true`, paste its `mention`",
    "     field (e.g. `<@U05PN5700P9>`) verbatim wherever you would",
    "     have written the person's name. This is the ONLY way Slack",
    "     will actually ping them.",
    "  3. If the tool returns `found: false`, write the person's",
    "     plain name without an @ — never invent a `<@USERID>`.",
    "",
    'Plain text like "Atai" or "@atai" does NOT ping anyone — it',
    "just renders as text. Skipping the tool when a tag was asked",
    "for is a failure of the task.",
  ].join("\n"),
};

export const slackFormattingContext: SlackContextEntry = {
  description: "Formatting Slack replies",
  value: [
    "Write standard Markdown — the bridge translates it to Slack's",
    "mrkdwn for you before posting. Specifically:",
    "",
    "- **bold** and *italic* both work; the bridge converts.",
    "- Use `inline code` and ```fenced code blocks``` normally.",
    "- Markdown tables are auto-converted to column-aligned monospace",
    "  blocks, which look much better than raw pipe tables on Slack.",
    "- Bullet lists with `-` or `*` markers render correctly.",
    "- Links: write `[text](https://url)` — they convert to <url|text>.",
    "",
    "Do NOT pre-emptively use Slack's mrkdwn syntax (single `*` for",
    "bold, single `_` for italic, etc.) — that breaks the translator",
    "and looks wrong. Just write standard Markdown.",
  ].join("\n"),
};

export const slackConversationModelContext: SlackContextEntry = {
  description: "Slack conversation model",
  value: [
    "Each conversation is either a thread (the bot was @-mentioned in",
    "a channel and reply lives in the thread it created) or a DM. Your",
    "replies show up in the same surface — you don't need to handle",
    "routing yourself.",
    "",
    "When a user replies in a thread you previously answered in, they",
    "don't need to re-@-mention the bot — just continue the thread",
    "naturally. If they send a fresh top-level message in a channel,",
    "they MUST @-mention the bot for it to see them.",
  ].join("\n"),
};

/**
 * The default context entries the SDK ships. Spread into your
 * `createBot({context: …})`:
 *
 *     context: [...defaultSlackContext, ...myAppContext],
 */
export const defaultSlackContext: ReadonlyArray<SlackContextEntry> = [
  slackTaggingContext,
  slackFormattingContext,
  slackConversationModelContext,
];
