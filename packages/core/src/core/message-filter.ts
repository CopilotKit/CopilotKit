import type { Message } from "@ag-ui/client";

/**
 * Rewrites the message list a runtime agent sends on each run.
 *
 * CopilotKit sends the whole thread on every request. When the backend already
 * stores the conversation (a LangGraph checkpointer, a Mastra memory store, a
 * Strands `SessionManager`, an Agent Framework chat history provider), that
 * history is dead weight: the payload grows without bound, and an agent that
 * merges the inbound list with its own store can show the model every turn
 * twice. See https://github.com/CopilotKit/CopilotKit/issues/1482.
 *
 * The filter runs on the outbound payload only. It never touches the messages
 * the UI renders, so trimming here does not shorten the visible transcript.
 *
 * Return the messages to send. Returning an empty array is valid and means
 * "send nothing but the run metadata".
 *
 * @param messages - The thread as the client holds it, in order, with
 *   `activity`-role messages already removed.
 * @param context - Which agent is about to run.
 */
export type CopilotKitMessageFilter = (
  messages: Message[],
  context: { agentId: string },
) => Message[];

interface AssistantToolCall {
  id: string;
}

function toolCallIdsOf(message: Message): string[] {
  const calls = (message as { toolCalls?: AssistantToolCall[] }).toolCalls;
  if (!Array.isArray(calls)) return [];
  return calls.map((call) => call.id).filter((id): id is string => Boolean(id));
}

function resultCallIdOf(message: Message): string | undefined {
  if (message.role !== "tool") return undefined;
  return (message as { toolCallId?: string }).toolCallId;
}

/**
 * Repair the tool-call pairs a filter broke.
 *
 * Every provider rejects a half pair. A tool result whose call is gone reads as
 * a reply to nothing, and an assistant tool call whose result is gone leaves
 * the turn unanswered — the failure reporters hit on #1482 when a trimmed
 * history landed mid-HITL and Anthropic answered "a tool result is expected".
 * A filter written as `messages.slice(-1)` cannot know this, so the repair runs
 * for every filter rather than being something each caller opts into.
 *
 * Two directions, both anchored on the untrimmed thread:
 *
 * - A kept tool result whose assistant call was dropped is dropped too.
 * - A kept assistant call whose result was dropped gets that result restored,
 *   placed directly after the call.
 *
 * A call with no result anywhere in `full` is left alone. That is an open call
 * (a pending frontend tool, an unanswered interrupt), not a broken pair.
 *
 * The filter's own ordering is preserved. Restored results are the only
 * insertions, and messages the filter synthesized (absent from `full`) pass
 * through untouched.
 */
export function ɵrepairToolCallPairs(
  kept: Message[],
  full: Message[],
): Message[] {
  const keptIds = new Set(kept.map((message) => message.id));

  // Both maps are built from the untrimmed thread: the repair has to reason
  // about pairs the filter already broke, so the kept list cannot answer
  // "did this call have a result".
  const callIdToIssuer = new Map<string, Message>();
  const callIdToResult = new Map<string, Message>();
  for (const message of full) {
    for (const callId of toolCallIdsOf(message)) {
      callIdToIssuer.set(callId, message);
    }
    const resultCallId = resultCallIdOf(message);
    if (resultCallId !== undefined) {
      callIdToResult.set(resultCallId, message);
    }
  }

  const repaired: Message[] = [];
  const emitted = new Set<string>();

  const emit = (message: Message) => {
    if (emitted.has(message.id)) return;
    emitted.add(message.id);
    repaired.push(message);
  };

  for (const message of kept) {
    const resultCallId = resultCallIdOf(message);
    if (resultCallId !== undefined) {
      const issuer = callIdToIssuer.get(resultCallId);
      // Unknown issuer means the pair never existed in this thread — the
      // result stands on its own and is not ours to drop.
      if (issuer && !keptIds.has(issuer.id)) continue;
      emit(message);
      continue;
    }

    emit(message);

    for (const callId of toolCallIdsOf(message)) {
      const result = callIdToResult.get(callId);
      if (result && !keptIds.has(result.id)) {
        emit(result);
      }
    }
  }

  return repaired;
}
