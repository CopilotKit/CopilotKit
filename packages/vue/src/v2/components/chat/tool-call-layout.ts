import type { Message, ToolCall, ToolMessage } from "@ag-ui/core";

/**
 * How the chat shows tool calls.
 *
 * - `"grouped"` (default): calls made in a row share one card, collapsed to a
 *   summary ("Used 3 tools") that opens to a row per call.
 * - `"line"`: the same grouping as a quiet line of text, like the reasoning
 *   message's "Thought for 4 seconds".
 * - `"stacked"`: the latest call on top of a stack of the earlier ones; click
 *   to fan the stack out into its cards.
 * - `"separate"`: every call gets its own card, as before grouping existed.
 *
 * Only calls drawn by a renderer that opts into grouping (`group: true`) are
 * grouped; CopilotKit's built-in card from `useDefaultRenderTool()` does. Any
 * other call always shows on its own and splits the group around it.
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
  /**
   * A call drawn by a renderer that didn't opt into grouping, or with no
   * renderer at all. The latter renders nothing (and warns in development)
   * without breaking a group.
   */
  | { kind: "call"; id: string; call: ToolCallEntry; rendered: boolean };

/** What one assistant message's tool-call area renders. */
export interface ToolCallLayout {
  segments: ToolCallSegment[];
  /** Changes whenever anything this layout renders changes; for memoization. */
  signature: string;
}

/** Which tool-call renderers are registered. */
export interface ToolCallRendererNames {
  /** Tool names with a renderer of their own. */
  named: ReadonlySet<string>;
  /** Of those, the ones whose renderer opted into grouping. */
  groupedNames: ReadonlySet<string>;
  /** A wildcard (`"*"`) renderer is registered. */
  wildcard: boolean;
  /** The wildcard renderer opted into grouping (the built-in card does). */
  wildcardGroups: boolean;
}

function contentLength(content: ToolMessage["content"]): number {
  return typeof content === "string"
    ? content.length
    : JSON.stringify(content ?? "").length;
}

const entrySignature = ({ toolCall, toolMessage }: ToolCallEntry) =>
  [
    toolCall.id,
    toolCall.function.name,
    toolCall.function.arguments.length,
    toolMessage
      ? `${contentLength(toolMessage.content)}${toolMessage.error ? "!" : ""}`
      : "-",
  ].join(":");

function signatureOf(segments: ToolCallSegment[]): string {
  return segments
    .map((segment) =>
      segment.kind === "call"
        ? `c(${entrySignature(segment.call)})`
        : `g${segment.trailing ? "*" : ""}(${segment.calls.map(entrySignature).join(",")})`,
    )
    .join("|");
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
 * Lays out the tool calls of every assistant message in `rendered`.
 *
 * Calls drawn by a renderer that opted into grouping join the group that's
 * open; anything else that shows between them closes it: assistant text, a
 * user, reasoning or activity message, or a call drawn by any other renderer. A group belongs to
 * the message where it starts, so later messages whose calls joined it render
 * no tool calls themselves.
 *
 * @param rendered - The messages as the chat renders them, in order.
 * @param all - Every message, for finding tool results (a transform may hide them).
 * @param renderers - The registered renderers.
 */
export function getToolCallLayouts(
  rendered: Message[],
  all: Message[],
  renderers: ToolCallRendererNames,
): Map<string, ToolCallLayout> {
  const results = getToolResults(all);
  const layouts = new Map<string, ToolCallSegment[]>();
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
    layouts.set(message.id, segments);
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

  const layout = new Map<string, ToolCallLayout>();
  for (const [id, segments] of layouts) {
    layout.set(id, { segments, signature: signatureOf(segments) });
  }
  return layout;
}

const TOOL_CALL_SLOT_PREFIX = "tool-call-";

/**
 * Which renderers draw tool calls, from the registered renderers and the
 * view's tool-call slots. A slot wins over a registered renderer and never
 * groups, since the chat can't tell what it draws: `#tool-call-<name>` takes
 * that tool, and `#tool-call` takes every tool.
 *
 * @param renderers - The registered renderers (`copilotkit.renderToolCalls`).
 * @param slotNames - The names of the slots the view was given.
 */
export function getToolCallRendererNames(
  renderers: readonly { name: string; group?: boolean }[],
  slotNames: readonly string[] = [],
): ToolCallRendererNames {
  const wildcardSlot = slotNames.includes("tool-call");
  const slotTools = slotNames
    .filter((name) => name.startsWith(TOOL_CALL_SLOT_PREFIX))
    .map((name) => name.slice(TOOL_CALL_SLOT_PREFIX.length));
  const named = renderers.filter((renderer) => renderer.name !== "*");
  const wildcards = renderers.filter((renderer) => renderer.name === "*");
  return {
    named: new Set([...named.map((renderer) => renderer.name), ...slotTools]),
    groupedNames: new Set(
      wildcardSlot
        ? []
        : named
            .filter(
              (renderer) =>
                renderer.group && !slotTools.includes(renderer.name),
            )
            .map((renderer) => renderer.name),
    ),
    wildcard: wildcards.length > 0 || wildcardSlot,
    wildcardGroups:
      !wildcardSlot && wildcards.some((renderer) => renderer.group),
  };
}
