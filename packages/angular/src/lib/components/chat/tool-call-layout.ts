import type { Message, ToolCall, ToolMessage } from "@ag-ui/core";
import type { CopilotKit } from "../../copilotkit";

/**
 * How the chat shows tool calls, as in React.
 *
 * - `"grouped"` (default): calls made in a row share one card, collapsed to a
 *   summary ("Used 3 tools") that opens to a row per call.
 * - `"line"`: the same grouping as a quiet line of text, like the reasoning
 *   message's "Thought for 4 seconds".
 * - `"stacked"`: the latest call on top of a stack of the earlier ones; click
 *   to fan the stack out into its cards.
 * - `"separate"`: every call gets its own card, as before grouping existed.
 *
 * Only calls drawn by a renderer that opts into grouping are grouped:
 * CopilotKit's built-in card (`defaultToolRendering: true`) and renderers
 * registered with `group: true`. Any other call always shows on its own and
 * splits the group around it.
 *
 * React's `"turn"` display is not available in Angular yet.
 */
export type CopilotChatToolCallDisplay =
  | "grouped"
  | "line"
  | "stacked"
  | "separate";

/** One tool call and, once it has finished, the message carrying its result. */
export interface ToolCallEntry {
  toolCall: ToolCall;
  toolMessage?: ToolMessage;
}

export type ToolCallSegment =
  /** Consecutive calls drawn by renderers that opted into grouping. */
  | {
      kind: "group";
      id: string;
      calls: ToolCallEntry[];
      /** Nothing renders after this group yet, so a running agent may add to it. */
      trailing: boolean;
    }
  /** A call drawn by a renderer that didn't opt into grouping, or by none. */
  | { kind: "call"; id: string; call: ToolCallEntry; rendered: boolean };

/** What one assistant message's tool-call area renders. */
export interface ToolCallLayout {
  segments: ToolCallSegment[];
}

/** Which tool-call renderers are registered. */
export interface ToolCallRendererNames {
  /** Tool names with a renderer of their own. */
  named: ReadonlySet<string>;
  /** Of those, the ones whose renderer opted into grouping. */
  groupedNames: ReadonlySet<string>;
  /** A wildcard (`"*"`) renderer, or the built-in card, is registered. */
  wildcard: boolean;
  /** The wildcard renderer opted into grouping (the built-in card does). */
  wildcardGroups: boolean;
}

/** Index of tool results by the call they answer. */
export function getToolResults(messages: Message[]): Map<string, ToolMessage> {
  const results = new Map<string, ToolMessage>();
  for (const message of messages) {
    if (message.role === "tool") results.set(message.toolCallId, message);
  }
  return results;
}

/**
 * Lays out the tool calls of every assistant message in `rendered`, like
 * React's `getToolCallLayouts`.
 *
 * Calls drawn by a renderer that opted into grouping join the group that's
 * open; anything else that shows between them closes it: assistant text, a
 * user, reasoning or activity message, or a call drawn by any other renderer.
 * A group belongs to the message where it starts, so later messages whose
 * calls joined it render no tool calls themselves.
 *
 * @param rendered - The messages as the chat renders them, in order.
 * @param all - Every message, for finding tool results.
 * @param renderers - The registered renderers.
 */
export function getToolCallLayouts(
  rendered: Message[],
  all: Message[],
  renderers: ToolCallRendererNames,
): Map<string, ToolCallLayout> {
  const results = getToolResults(all);
  const layouts = new Map<string, ToolCallLayout>();
  let open: Extract<ToolCallSegment, { kind: "group" }> | undefined;

  for (const message of rendered) {
    if (message.role === "tool") continue;
    if (message.role !== "assistant") {
      open = undefined;
      continue;
    }
    if (typeof message.content === "string" && message.content.trim()) {
      open = undefined;
    }

    const segments: ToolCallSegment[] = [];
    layouts.set(message.id, { segments });
    // Streaming can repeat a call: keep its first position, last content.
    const toolCalls = new Map<string, ToolCall>();
    for (const toolCall of message.toolCalls ?? []) {
      toolCalls.set(toolCall.id, toolCall);
    }
    for (const toolCall of toolCalls.values()) {
      const entry = { toolCall, toolMessage: results.get(toolCall.id) };

      const name = toolCall.function.name;
      const named = renderers.named.has(name);
      const rendered = named || renderers.wildcard;
      const groups = named
        ? renderers.groupedNames.has(name)
        : renderers.wildcardGroups;

      if (!rendered || !groups) {
        if (rendered) open = undefined;
        segments.push({ kind: "call", id: toolCall.id, call: entry, rendered });
      } else if (open) {
        open.calls.push(entry);
      } else {
        open = {
          kind: "group",
          id: toolCall.id,
          calls: [entry],
          trailing: false,
        };
        segments.push(open);
      }
    }
  }
  if (open) open.trailing = true;
  return layouts;
}

/**
 * Which tool-call renderers are registered, for grouping (see
 * `getToolCallLayouts`). Like React's `useToolCallRendererNames`.
 */
export function getToolCallRendererNames(
  copilotKit: Pick<
    CopilotKit,
    | "toolCallRenderConfigs"
    | "clientToolCallRenderConfigs"
    | "humanInTheLoopToolRenderConfigs"
    | "defaultToolRenderingEnabled"
  >,
): ToolCallRendererNames {
  const application = copilotKit.toolCallRenderConfigs();
  const named = application.filter((entry) => entry.name !== "*");
  const wildcards = application.filter((entry) => entry.name === "*");
  return {
    named: new Set([
      ...named.map((entry) => entry.name),
      ...copilotKit
        .clientToolCallRenderConfigs()
        .filter((entry) => entry.component !== undefined)
        .map((entry) => entry.name),
      ...copilotKit
        .humanInTheLoopToolRenderConfigs()
        .map((entry) => entry.name),
    ]),
    groupedNames: new Set(
      named.filter((entry) => entry.group).map((entry) => entry.name),
    ),
    wildcard: wildcards.length > 0 || copilotKit.defaultToolRenderingEnabled,
    // An application wildcard wins over the built-in card, which groups.
    wildcardGroups:
      wildcards.length > 0
        ? wildcards.some((entry) => entry.group)
        : copilotKit.defaultToolRenderingEnabled,
  };
}
