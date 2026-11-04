import type { Message, ToolCall, ToolMessage } from "@ag-ui/core";
import { isForwardedToClientPlaceholder } from "@copilotkit/core";

/**
 * How the chat shows tool calls.
 *
 * - `"grouped"` (default): calls made in a row share one card, collapsed to a
 *   summary ("Used 3 tools") that opens to a row per call.
 * - `"line"`: the same grouping as a quiet line of text, like the reasoning
 *   message's "Thought for 4 seconds".
 * - `"stacked"`: the latest call on top of a stack of the earlier ones; click
 *   to fan the stack out into its cards.
 * - `"turn"`: the agent works in the open (narration, then a row per call),
 *   and when the reply is done everything before it folds into "Worked for 9s".
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
  | "turn"
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
    if (message.role !== "tool") continue;
    const existing = results.get(message.toolCallId);
    // A transport placeholder is not the call's answer. A replayed history can
    // hold the placeholder and the saved result for the same call, and the
    // saved result may come first, so a later placeholder must not hide it.
    if (
      existing &&
      !isForwardedToClientPlaceholder(existing.content) &&
      isForwardedToClientPlaceholder(message.content)
    ) {
      continue;
    }
    results.set(message.toolCallId, message);
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

/** A reply's working phase, for the `"turn"` display. */
export interface TurnWork {
  /** Stable across the turn's life: the id of the user message it answers. */
  key: string;
  /** The first assistant-side message, where the "Worked for" line goes. */
  firstMessageId: string;
  /** Everything up to and including the last message with a tool call. */
  workMessageIds: ReadonlySet<string>;
  /**
   * The reply's last assistant message, when it has text and is part of the
   * work (it also calls a tool). Its text is the answer, so it stays out.
   */
  replyTextMessageId?: string;
  calls: ToolCallEntry[];
  /** No user message follows, so the agent may still be working on it. */
  isLatest: boolean;
}

/**
 * Finds the working phase of every reply in `rendered`: its messages up to the
 * last one that calls a tool. Text in there was narration; what follows is the
 * reply itself. Replies that called no tools are omitted, except the latest,
 * which may be about to.
 */
export function getTurnWork(
  rendered: Message[],
  layouts: Map<string, ToolCallLayout>,
): Map<string, TurnWork> {
  const turns = new Map<string, TurnWork>();
  let start = 0;
  while (start < rendered.length) {
    let end = start;
    while (end < rendered.length && rendered[end]!.role !== "user") end++;
    const key = start > 0 ? rendered[start - 1]!.id : "start";
    const visible = rendered
      .slice(start, end)
      .filter((message) => message.role !== "tool");
    const isLatest = end === rendered.length;

    // A message's calls may sit in a group an earlier message owns, so
    // collect every shown call first, then find the last message making one.
    const calls: ToolCallEntry[] = [];
    for (const message of visible) {
      for (const segment of layouts.get(message.id)?.segments ?? []) {
        if (segment.kind === "group") calls.push(...segment.calls);
        else if (segment.rendered) calls.push(segment.call);
      }
    }
    const shown = new Set(calls.map((entry) => entry.toolCall.id));
    let lastWork = -1;
    visible.forEach((message, index) => {
      if (
        message.role === "assistant" &&
        message.toolCalls?.some((call) => shown.has(call.id))
      ) {
        lastWork = index;
      }
    });

    const first = visible[0];
    if (first && (calls.length > 0 || isLatest)) {
      let lastAssistant = -1;
      visible.forEach((message, index) => {
        if (message.role === "assistant") lastAssistant = index;
      });
      const replyText = visible[lastAssistant]?.content;
      const endsWithWork =
        lastAssistant >= 0 &&
        lastAssistant <= lastWork &&
        typeof replyText === "string" &&
        replyText.trim().length > 0;

      turns.set(key, {
        key,
        firstMessageId: first.id,
        workMessageIds: new Set(
          visible.slice(0, lastWork + 1).map((message) => message.id),
        ),
        replyTextMessageId: endsWithWork
          ? visible[lastAssistant]!.id
          : undefined,
        calls,
        isLatest,
      });
    }
    start = end + 1;
  }
  return turns;
}
