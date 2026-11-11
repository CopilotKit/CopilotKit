import type { ContextEntry } from "@copilotkit/channels-core";

/** Tell the model it replies in a Notion comment and which formatting renders. */
export const notionFormattingContext: ContextEntry = {
  description: "Notion comment formatting rules",
  value:
    "You are replying in a Notion page comment discussion. Only inline " +
    "Markdown renders: **bold**, *italic*, ~~strikethrough~~, `code`, and " +
    "[label](https://url) links. Notion comments have no headings, tables, " +
    "lists, or images: a heading shows as a bold line and a list as plain " +
    "lines. Keep replies short; a comment is a short note, not a document.",
};

/** Tell the model how replies and choices are delivered in Notion. */
export const notionDeliveryContext: ContextEntry = {
  description: "Notion comment delivery constraints",
  value:
    "Your reply streams by editing one comment in the discussion. Notion " +
    "comments have no buttons: choices show as a numbered list, and the user " +
    "answers by replying with a number.",
};

/** Default context entries for every Notion turn. */
export const defaultNotionContext: ContextEntry[] = [
  notionFormattingContext,
  notionDeliveryContext,
];
