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
 * Both repairs restore, never discard, and both are anchored on the untrimmed
 * thread:
 *
 * - A kept tool result whose assistant call was trimmed away gets that call put
 *   back in front of it. Dropping the result instead would be protocol-safe and
 *   semantically wrong: on a human-in-the-loop turn the result IS the new
 *   information, and a backend that already holds the call would be asked to
 *   resume with nothing.
 * - A kept assistant call whose result was trimmed gets that result restored,
 *   placed directly after the call.
 *
 * Restoring a call pulls in every result for that call, not only the one the
 * filter kept. Providers reject an assistant turn with a parallel tool call
 * left unanswered, so a half-answered set is as invalid as a missing one.
 *
 * A call with no result anywhere in `full` is left alone. That is an open call
 * (a pending frontend tool, an unanswered interrupt), not a broken pair. A
 * result whose call is nowhere in `full` is left alone too: it was already
 * unpaired before the filter ran, so it is not this function's to fix.
 *
 * The filter's own ordering is preserved. Restorations are the only insertions,
 * and messages the filter synthesized (absent from `full`) pass through
 * untouched.
 */
export function ɵrepairToolCallPairs(
  kept: Message[],
  full: Message[],
): Message[] {
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

  /** Emit an assistant turn together with every result it is owed. */
  const emitWithResults = (message: Message) => {
    emit(message);
    for (const callId of toolCallIdsOf(message)) {
      const result = callIdToResult.get(callId);
      if (result) emit(result);
    }
  };

  for (const message of kept) {
    const resultCallId = resultCallIdOf(message);
    if (resultCallId === undefined) {
      emitWithResults(message);
      continue;
    }

    const issuer = callIdToIssuer.get(resultCallId);
    if (issuer) {
      // Emits the issuer first, then this result along with its siblings.
      emitWithResults(issuer);
      continue;
    }
    emit(message);
  }

  return repaired;
}
