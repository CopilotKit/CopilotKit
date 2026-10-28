import type { Message } from "@ag-ui/client";
import { isDeepStrictEqual } from "node:util";
import type { ThreadMessage } from "../../intelligence-platform/client";

/**
 * Select new replay occurrences for an explicitly append-only native backend.
 * Replay IDs identify occurrences, never native SDK IDs or text. Compare the
 * saved representation too: a resolved tool can reuse its pending message ID.
 * Ambiguous edits fail before execution instead of reappending old history.
 */
export function nativeHistoryInput(
  input: Message[],
  history: ThreadMessage[],
): Message[] {
  const saved = new Map<string, ThreadMessage>();
  for (const message of history) {
    if (saved.has(message.id))
      throw new Error("Ambiguous persisted message ID");
    saved.set(message.id, message);
  }
  const seen = new Set<string>();
  return input.filter((message) => {
    if (seen.has(message.id)) throw new Error("Ambiguous input message ID");
    seen.add(message.id);
    const previous = saved.get(message.id);
    if (!previous) return true;
    const current = {
      role: message.role,
      content: "content" in message ? (message.content ?? "") : "",
      toolCalls:
        message.role === "assistant"
          ? (message.toolCalls ?? []).map((call) => ({
              id: call.id,
              name: call.function.name,
              args: call.function.arguments,
            }))
          : [],
      toolCallId: message.role === "tool" ? message.toolCallId : undefined,
      activityType:
        message.role === "activity" ? message.activityType : undefined,
    };
    const prior = {
      role: previous.role,
      content: previous.content ?? "",
      toolCalls: previous.toolCalls ?? [],
      toolCallId: previous.toolCallId,
      activityType: previous.activityType,
    };
    if (isDeepStrictEqual(current, prior)) return false;
    if (
      message.role === "tool" &&
      previous.role === "tool" &&
      message.toolCallId === previous.toolCallId
    )
      return true;
    throw new Error(
      "Cannot edit persisted native history; submit a new message occurrence",
    );
  });
}
