import type { AssistantMessage, Message, ToolCall } from "@ag-ui/core";

/**
 * Collapses tool calls that share an id, keeping first-seen order.
 *
 * AG-UI's TOOL_CALL_START handler appends to the parent message's `toolCalls`
 * without checking whether that id is already present. When a start event is
 * applied twice (the human-in-the-loop flow does this when the run syncs after
 * `respond()`), the message carries the same call twice. The second copy has
 * empty `arguments`, because a start event carries none. The args arrive later
 * as TOOL_CALL_ARGS deltas addressed to the first copy.
 *
 * Left alone, the same tool call renders twice: once populated and once blank.
 * The blank copy is the redundant one, so the copy that carries arguments wins,
 * whatever order the two arrive in.
 *
 * @param toolCalls - The tool calls of one assistant message.
 * @returns The same array when no id repeats, so memoized consumers keep a
 *   stable reference. Otherwise a new array with one entry per id.
 */
function dedupeToolCalls(toolCalls: ToolCall[]) {
  const byId = new Map<string, ToolCall>();
  for (const toolCall of toolCalls) {
    const existing = byId.get(toolCall.id);
    if (!existing) {
      byId.set(toolCall.id, toolCall);
      continue;
    }
    const isPopulatedReplacingEmpty =
      !existing.function?.arguments && Boolean(toolCall.function?.arguments);
    if (isPopulatedReplacingEmpty) {
      byId.set(toolCall.id, toolCall);
    }
  }
  return byId.size === toolCalls.length ? toolCalls : [...byId.values()];
}

/**
 * Merges two snapshots of the same assistant message.
 *
 * - Empty `content` means a streaming update cleared the field, so the earlier
 *   non-empty content is kept.
 * - `toolCalls: undefined` means the later chunk had no tool-call activity, so
 *   the earlier tool calls are kept. An explicit `[]` is kept as-is.
 * - Fields that only the earlier snapshot has are kept.
 */
function mergeAssistantMessages(
  existing: AssistantMessage,
  message: AssistantMessage,
) {
  const content = message.content || existing.content;
  const toolCalls = message.toolCalls ?? existing.toolCalls;
  return {
    ...existing,
    ...message,
    content,
    toolCalls: toolCalls ? dedupeToolCalls(toolCalls) : toolCalls,
  };
}

/**
 * Returns the assistant message with repeated tool-call ids collapsed. Returns
 * the same object when nothing collapsed.
 */
function withDedupedToolCalls(message: AssistantMessage) {
  if (!message.toolCalls) return message;
  const toolCalls = dedupeToolCalls(message.toolCalls);
  return toolCalls === message.toolCalls ? message : { ...message, toolCalls };
}

/**
 * De-duplicates chat messages by id, for rendering.
 *
 * A message list from an agent can hold the same message id more than once
 * while it streams. This keeps one entry per id, at the position the id first
 * appears:
 *
 * - **Assistant messages** are merged. Later fields win, but empty `content`
 *   falls back to earlier non-empty content, and `toolCalls: undefined` falls
 *   back to earlier tool calls (an explicit `[]` is kept).
 * - **Tool calls** on an assistant message are de-duplicated by id, also
 *   when the message itself is not repeated. The copy that has arguments
 *   wins, and the first-seen order is kept.
 * - **Other roles** keep the last copy.
 *
 * @param messages - The agent's messages, in order.
 * @returns A new array. A message that needed no change is returned as the
 *   same object.
 *
 * @example
 * ```ts
 * const visible = ɵdeduplicateMessages(agent.messages);
 * ```
 */
export function ɵdeduplicateMessages(messages: readonly Message[]) {
  const byId = new Map<string, Message>();
  for (const message of messages) {
    if (message.role !== "assistant") {
      byId.set(message.id, message);
      continue;
    }
    const existing = byId.get(message.id);
    const merged =
      existing?.role === "assistant"
        ? mergeAssistantMessages(existing, message)
        : withDedupedToolCalls(message);
    byId.set(message.id, merged);
  }
  return [...byId.values()];
}

/**
 * Serializes object content for {@link ɵmessagesFingerprint}.
 *
 * `JSON.stringify` throws on a circular structure (and on a `BigInt`). The
 * fingerprint runs on every render, so a throw would take the chat down. A
 * value that cannot be serialized gets a constant key instead: it does not
 * trigger a change on its own, but every other part of the fingerprint still
 * does.
 */
function objectContentKey(content: object) {
  try {
    return JSON.stringify(content) ?? "";
  } catch {
    return "[unserializable]";
  }
}

/**
 * Gives the part of the fingerprint that tracks a message's content:
 * - string content: its length, so streamed text changes it.
 * - array content: the part count, so an added attachment changes it. The
 *   parts are not serialized, which keeps base64 uploads out of the key.
 * - object content (activity messages): its JSON, so a snapshot that replaces
 *   the content under the same message id changes it.
 */
function contentKey(content: unknown) {
  if (typeof content === "string" || Array.isArray(content)) {
    return String(content.length);
  }
  if (content !== null && typeof content === "object") {
    return objectContentKey(content);
  }
  return "0";
}

/**
 * Builds a string that changes whenever a render of the message list could
 * change. Use it as a cheap memo key in place of a deep comparison.
 *
 * The key covers, per message:
 * - the id and the role.
 * - the content: text length, part count, or the JSON of object content.
 * - the `toolCallId` of a tool message.
 * - each tool call's id and the length of its arguments, so streamed
 *   arguments change the key.
 *
 * It never throws. Object content that cannot be serialized (for example a
 * circular tool result) gets a constant key.
 *
 * @param messages - The agent's messages, in order.
 * @returns The fingerprint string.
 *
 * @example
 * ```ts
 * const key = ɵmessagesFingerprint(agent.messages);
 * if (key !== previousKey) rerender();
 * ```
 */
export function ɵmessagesFingerprint(messages: readonly Message[]) {
  return messages
    .map((message) => {
      const toolCallId = "toolCallId" in message ? message.toolCallId : "";
      const toolCalls =
        "toolCalls" in message && Array.isArray(message.toolCalls)
          ? message.toolCalls
          : [];
      const toolCallsKey = toolCalls
        .map((tc) => `${tc.id}:${tc.function?.arguments?.length ?? 0}`)
        .join(";");
      return `${message.id}:${message.role}:${contentKey(message.content)}:${toolCallId}:${toolCallsKey}`;
    })
    .join(",");
}
