import type { Context, Message, Tool } from "@ag-ui/client";

/**
 * Where an agent puts the application context and state for the model.
 *
 * - `"system"` (default): in the system prompt, after the agent's own prompt.
 * - `"message"`: at the start of the newest user message. The system prompt
 *   then stays the same for the whole thread.
 *
 * Providers cache an unchanged request prefix (tools, then system prompt,
 * then messages). With `"system"`, a context or state change between turns
 * changes the system prompt, so the whole conversation history misses the
 * cache. With `"message"`, only the newest turn changes.
 */
export type ContextPlacement = "system" | "message";

const isEmptyState = (state: unknown): boolean =>
  state === undefined ||
  state === null ||
  (typeof state === "object" &&
    !Array.isArray(state) &&
    Object.keys(state).length === 0);

/** The "Context from the application" section, or undefined when empty. */
export function applicationContextSection(
  context: Context[] | undefined,
): string | undefined {
  if (!context?.length) return undefined;
  return (
    "## Context from the application\n" +
    context.map((ctx) => `${ctx.description}:\n${ctx.value}\n`).join("")
  );
}

/** The "Application State" section, or undefined when the state is empty. */
export function applicationStateSection(state: unknown): string | undefined {
  if (isEmptyState(state)) return undefined;
  return (
    "## Application State\n" +
    "This is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n" +
    `\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`
  );
}

/**
 * Returns a copy of `messages` with `note` at the start of the newest user
 * message. Earlier messages are not changed, so the request prefix up to the
 * newest user message stays cacheable. Returns undefined when there is no
 * user message, so that the caller can fall back to the system prompt.
 */
export function prependToNewestUserMessage(
  messages: Message[],
  note: string,
): Message[] | undefined {
  // An indexed backward loop: lint-fix rewrites reverse() to toReversed(),
  // which this package's TypeScript lib does not have.
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "user") continue;
    const content = message.content;
    const updated: Message =
      typeof content === "string"
        ? { ...message, content: `${note}\n\n${content}` }
        : {
            ...message,
            content: [{ type: "text", text: `${note}\n\n` }, ...content],
          };
    return [...messages.slice(0, i), updated, ...messages.slice(i + 1)];
  }
  return undefined;
}

/**
 * Sorts tools by name. The client sends frontend tools in registration
 * order, which can change between renders. The tool list is the start of
 * the cached prefix, so a new order misses the whole cache.
 */
export function sortToolsByName<T extends Pick<Tool, "name">>(tools: T[]): T[] {
  return [...tools].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}
