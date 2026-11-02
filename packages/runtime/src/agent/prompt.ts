import type { RunAgentInput } from "@ag-ui/client";

/**
 * Formats the "Context from the application" section of the agent system
 * prompt. Each entry becomes `${description}:\n${value}\n`.
 *
 * @param context - The `context` entries from the AG-UI run input.
 * @returns The section text, or `undefined` when `context` is empty.
 *
 * @example
 * ```ts
 * formatContextSection([{ description: "User", value: "Ada" }]);
 * // "\n## Context from the application\nUser:\nAda\n"
 * ```
 */
export function formatContextSection(context: RunAgentInput["context"]) {
  if (context.length === 0) return undefined;
  const entries = context.map(
    (entry) => `${entry.description}:\n${entry.value}\n`,
  );
  return `\n## Context from the application\n${entries.join("")}`;
}

/**
 * Formats the "Application State" section of the agent system prompt. The
 * state is written as pretty-printed JSON in a ```json fence, with a line
 * that tells the model it can edit the state with `AGUISendStateSnapshot` or
 * `AGUISendStateDelta`.
 *
 * @param state - The `state` from the AG-UI run input.
 * @returns The section text, or `undefined` when `state` is `undefined`,
 * `null`, or an empty object.
 *
 * @example
 * ```ts
 * formatStateSection({ count: 1 });
 * ```
 */
export function formatStateSection(state: RunAgentInput["state"]) {
  const isEmptyObject =
    typeof state === "object" &&
    state !== null &&
    Object.keys(state).length === 0;
  if (state === undefined || state === null || isEmptyObject) return undefined;
  return (
    "\n## Application State\n" +
    "This is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n" +
    `\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`
  );
}

/**
 * Builds the agent system prompt from the configured prompt, the run's
 * application context, and the run's application state, in that order.
 * Sections that have no content are left out.
 *
 * @param input - The `context` and `state` from the AG-UI run input.
 * @param options - `prompt`: the agent's configured system prompt.
 * @returns The system prompt, or `undefined` when there is no prompt, no
 * context, and no state.
 *
 * @example
 * ```ts
 * const system = buildAgentSystemPrompt(input, { prompt: "You are helpful." });
 * ```
 */
export function buildAgentSystemPrompt(
  input: Pick<RunAgentInput, "context" | "state">,
  options: { prompt?: string },
) {
  const sections = [
    options.prompt || undefined,
    formatContextSection(input.context),
    formatStateSection(input.state),
  ];
  const present = sections.filter(
    (section): section is string => section !== undefined,
  );
  if (present.length === 0) return undefined;
  return present.join("");
}
