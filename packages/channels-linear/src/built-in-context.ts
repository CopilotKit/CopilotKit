import type { ContextEntry } from "@copilotkit/channels-core";

/** Tells the model it is a Linear agent and which formatting renders. */
export const linearFormattingContext: ContextEntry = {
  description: "Linear agent formatting rules",
  value:
    "You are a Linear agent working on an issue inside a Linear agent session. " +
    "Your replies render as Markdown: headings, lists, tables, links, `code`, " +
    "and code blocks all work. Mention issues by their identifier (for example " +
    "ENG-123); Linear links them for you.",
};

/** Tells the model how its output reaches the user in Linear. */
export const linearDeliveryContext: ContextEntry = {
  description: "Linear agent delivery constraints",
  value:
    "Your reasoning shows as thoughts and your tool calls show as actions in the " +
    "session. Each message is a separate activity and cannot be edited later, so " +
    "do not promise to update a message; post a new one instead. When you offer " +
    "choices, they appear as selectable options and the user's pick comes back " +
    "as their next message.",
};

/** The context entries a Linear adapter adds to every run by default. */
export const defaultLinearContext: ContextEntry[] = [
  linearFormattingContext,
  linearDeliveryContext,
];
