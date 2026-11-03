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

/**
 * The string ids of a message's tool calls.
 *
 * Malformed entries are ignored rather than thrown on, matching
 * {@link ɵkeepToolResultsWithCalls}: a null or primitive entry, or an entry
 * without a string `id`, opens no pair instead of failing the repair.
 */
function toolCallIdsOf(message: Message): string[] {
  const calls = (message as { toolCalls?: unknown }).toolCalls;
  if (!Array.isArray(calls)) return [];
  const ids: string[] = [];
  for (const call of calls) {
    if (typeof call !== "object" || call === null) continue;
    const id = (call as { id?: unknown }).id;
    if (typeof id === "string" && id) ids.push(id);
  }
  return ids;
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
  // Pair each result with the nearest unmatched call before it. Providers
  // often reuse call ids across turns, so an id alone cannot identify a pair.
  // The untrimmed thread supplies the order the filter may have removed.
  const pendingIssuersByCallId = new Map<string, Message[]>();
  const issuerIdToResultsByCallId = new Map<string, Map<string, Message[]>>();
  const resultIdToIssuer = new Map<string, Message>();
  for (const message of full) {
    for (const callId of toolCallIdsOf(message)) {
      push(pendingIssuersByCallId, callId, message);
    }
    const resultCallId = resultCallIdOf(message);
    if (resultCallId !== undefined) {
      const pendingIssuers = pendingIssuersByCallId.get(resultCallId);
      const issuer = pendingIssuers?.pop();
      if (issuer) {
        resultIdToIssuer.set(message.id, issuer);
        let resultsByCallId = issuerIdToResultsByCallId.get(issuer.id);
        if (!resultsByCallId) {
          resultsByCallId = new Map();
          issuerIdToResultsByCallId.set(issuer.id, resultsByCallId);
        }
        push(resultsByCallId, resultCallId, message);
      }
    }
  }

  const repaired: Message[] = [];
  const emitted = new Set<string>();
  const expandedMessages = new Set<Message>();

  const emit = (message: Message) => {
    if (emitted.has(message.id)) return;
    emitted.add(message.id);
    repaired.push(message);
  };

  /** Emit an assistant turn together with every result it is owed. */
  const emitWithResults = (message: Message) => {
    emit(message);
    if (expandedMessages.has(message)) return;
    expandedMessages.add(message);
    const resultsByCallId = issuerIdToResultsByCallId.get(message.id);
    for (const callId of toolCallIdsOf(message)) {
      for (const result of resultsByCallId?.get(callId) ?? []) emit(result);
    }
  };

  for (const message of kept) {
    const resultCallId = resultCallIdOf(message);
    if (resultCallId === undefined) {
      emitWithResults(message);
      continue;
    }

    const issuer = resultIdToIssuer.get(message.id);
    if (issuer) {
      // Emits the issuer first, then this result along with its siblings.
      emitWithResults(issuer);
      continue;
    }
    emit(message);
  }

  return repaired;
}

/**
 * Move each detached tool result to sit behind the assistant call that issued
 * it — usually back to an earlier call, and forward only when no earlier call
 * has its id and exactly one call in the list does — and change nothing else.
 * Used for unfiltered sends, and on a configured filter's output only when
 * {@link ɵrepairToolCallPairs}, which filtered sends go through otherwise,
 * throws.
 *
 * The client store can detach a tool result from its call on its own: when a
 * backend's `MESSAGES_SNAPSHOT` carries a tool message under a different id
 * than the streamed `TOOL_CALL_RESULT`, the `@ag-ui/client` merge drops the
 * copy placed after its call and appends the snapshot's copy at the end,
 * leaving `assistant(tool_call), assistant(text), tool(result)`. A backend that
 * rebuilds its state from that payload discards every result it cannot pair.
 *
 * The pairing rule mirrors the `@ag-ui/client` snapshot pass
 * (ag-ui-protocol/ag-ui#3114):
 *
 * - Everything is by list position. The same object or id appearing twice is
 *   two independent slots, including an assistant call the merge duplicated,
 *   so a duplicated call can be left unanswered. Nothing is dropped,
 *   deduplicated, or added, and only tool-role messages ever change position.
 * - Transparent entries are `activity` and `reasoning` messages and anything
 *   that is not a plain object (`null`, arrays, primitives). They are never
 *   the anchor, never separate a call from its result, and stay in place.
 *   Reasoning stored between a call and its result is the next step's: in a
 *   multi-step turn whose calls share one assistant message, Mastra leaves
 *   `assistant(c1, c2), tool(c1), reasoning, tool(c2)`. Moving the result in
 *   front of it leaves the reasoning trailing, and Mastra drops it.
 * - The anchor is the last non-transparent message so far that is not `tool`.
 *   Each tool call an assistant issues opens a slot for its call id, and a
 *   result pairs with slots for its `toolCallId` alone. `subagentRunId` is
 *   ignored: results CopilotKit creates itself (frontend tool results,
 *   interrupt responses) do not carry one, and on a result it names the run
 *   that executed the tool, which may differ from the run that issued the
 *   call. Known limitation: a parent call and a subagent call that reuse one
 *   id are indistinguishable, so their drifted results can be swapped.
 * - Pass 1, left to right: a result with an open slot issued at the anchor is
 *   in place; it takes that slot and stays put. A result with an open slot
 *   issued earlier is detached. A result with no slot for its id issued
 *   earlier at all is early. Any other result — every earlier slot for its id
 *   already answered — stays put. Detached results take no slot in this
 *   pass: they could only ever take a slot issued before the current anchor,
 *   which no later in-place result can want.
 * - Pass 2, backward, per id: the detached results, from the newest back,
 *   each take the newest still-open slot issued before them; one that finds
 *   none stays put. So when several results for a reused id (providers reuse
 *   `call_0` every turn) are all detached, they keep their stored order
 *   across the calls, and a later turn's lone result goes to the later call
 *   rather than to an earlier one that was abandoned.
 * - Pass 3, forward, per id: an early result moves forward only when its id
 *   is unambiguous — exactly one call slot in the whole list has it, that
 *   slot is issued after the result, and it is still open after passes 1-2.
 *   The first early result for the id, left to right, takes it; any other
 *   early result for that id stays put. This repairs a result whose call
 *   was re-issued after it (a snapshot that re-ids the assistant message but
 *   keeps the result's id). With a reused id (providers reuse `call_0` every
 *   turn) nothing moves forward: in `[t0, t1, a1(c), user, a2(c)]` nothing
 *   says t1 answers a2, and a2 may be a pending call (a frontend tool, an
 *   interrupt, a human-in-the-loop call waiting on the user). Only early
 *   results move forward: an extra result for a call that is already
 *   answered never does.
 * - A moved result goes behind its issuer, after the tool and transparent
 *   entries already following it, but in front of any reasoning among those
 *   transparent entries: reasoning belongs to the message after it, so a
 *   moved result never lands between a reasoning message and its owner.
 *   Results moved behind one issuer keep their stored order. Any other
 *   message between a call and its result separates them, so a
 *   backward-moved result moves before it and a forward-moved result moves
 *   past it.
 * - The rule cannot tell a duplicate result from a detached one. A second
 *   result for an already-answered call moves back to an older still-open
 *   slot for its id if there is one, even across user turns; it never moves
 *   forward.
 * - Malformed entries are ignored rather than thrown on. Non-array
 *   `toolCalls`, call entries without a string `id`, and results without a
 *   string `toolCallId` open or take no slot.
 *
 * Returns `messages` itself when nothing moved.
 */
export function ɵkeepToolResultsWithCalls(messages: Message[]): Message[] {
  type Slot = { issuer: number; open: boolean };
  // Per call id, the slots its calls opened, in stored order.
  const slots = new Map<string, Slot[]>();
  // Per call id, how many of its slots are still open.
  const openCount = new Map<string, number>();
  const close = (callId: string, slot: Slot) => {
    slot.open = false;
    openCount.set(callId, openCount.get(callId)! - 1);
  };
  // Per call id, the detached results, in stored order.
  const detached = new Map<string, number[]>();
  // Per call id, the results with no slot for their id issued before them at
  // all, in stored order: the only results that may move forward.
  const early = new Map<string, number[]>();
  let anchor = -1;

  for (let index = 0; index < messages.length; index++) {
    const message: unknown = messages[index];
    if (isTransparent(message)) continue;
    const role = roleOf(message);

    if (role !== "tool") {
      anchor = index;
      const calls =
        role === "assistant"
          ? (message as { toolCalls?: unknown }).toolCalls
          : undefined;
      if (!Array.isArray(calls)) continue;
      for (const call of calls) {
        if (typeof call !== "object" || call === null) continue;
        const callId = (call as { id?: unknown }).id;
        if (typeof callId !== "string") continue;
        push(slots, callId, { issuer: index, open: true });
        openCount.set(callId, (openCount.get(callId) ?? 0) + 1);
      }
      continue;
    }

    const callId = (message as { toolCallId?: unknown }).toolCallId;
    if (typeof callId !== "string") continue;
    const forId = slots.get(callId);
    if (!forId) {
      push(early, callId, index);
      continue;
    }

    // Slots open in stored order and the anchor is the newest issuer, so the
    // anchor's slots sit at the tail: scan only those.
    let atAnchor: Slot | undefined;
    for (let s = forId.length - 1; s >= 0; s--) {
      const slot = forId[s]!;
      if (slot.issuer !== anchor) break;
      if (slot.open) atAnchor = slot;
    }
    if (atAnchor) {
      close(callId, atAnchor);
      continue;
    }
    // Every earlier slot for this id already answered: an extra or stale
    // result. It stays, so it cannot answer a later pending call.
    if (openCount.get(callId)! > 0) push(detached, callId, index);
  }

  const movedBehind = new Map<number, number[]>();
  const moved = new Set<number>();
  const take = (callId: string, slot: Slot, index: number) => {
    close(callId, slot);
    moved.add(index);
    push(movedBehind, slot.issuer, index);
  };

  for (const [callId, results] of detached) {
    const forId = slots.get(callId)!;
    // Results go newest first and each needs a slot issued before it, so the
    // newest usable slot only ever moves left: one cursor per id keeps the
    // pass linear even when every turn reuses the same id.
    let s = forId.length - 1;
    for (let r = results.length - 1; r >= 0; r--) {
      const index = results[r]!;
      while (s >= 0 && (!forId[s]!.open || forId[s]!.issuer >= index)) s--;
      // One that finds none had an earlier call for its id, so it stays.
      if (s < 0) break;
      take(callId, forId[s]!, index);
    }
  }

  for (const [callId, results] of early) {
    // Only an unambiguous id moves forward: exactly one call slot for it in
    // the whole list. With a reused id (providers reuse `call_0` every turn)
    // nothing says which later call an early result answers, and guessing
    // can answer a pending human-in-the-loop call with another turn's
    // result. Every slot is issued after an early result (none came before
    // it), so the one slot only has to be still open; the first early
    // result takes it and the rest stay put.
    const forId = slots.get(callId);
    if (forId?.length !== 1 || !forId[0]!.open) continue;
    take(callId, forId[0]!, results[0]!);
  }

  if (moved.size === 0) return messages;

  const result: Message[] = [];
  let openIssuer = -1;
  const flush = () => {
    const behind = movedBehind.get(openIssuer);
    if (!behind) return;
    // Converters give a reasoning message to the message after it, so the
    // moved results go in front of any reasoning among the transparent
    // entries at the tail, never between a reasoning message and its owner.
    // Activity is stripped before sending, so it is looked past too.
    let at = result.length;
    for (let tail = result.length - 1; tail >= 0; tail--) {
      if (!isTransparent(result[tail])) break;
      if (roleOf(result[tail]) === "reasoning") at = tail;
    }
    // Collected id by id, and within an id in pass order; emit them in
    // stored order.
    result.splice(
      at,
      0,
      ...[...behind]
        .sort((a, b) => a - b)
        .map((index) => messages[index] as Message),
    );
  };
  for (let index = 0; index < messages.length; index++) {
    if (moved.has(index)) continue;
    const message: unknown = messages[index];
    if (!isTransparent(message) && roleOf(message) !== "tool") {
      flush();
      openIssuer = index;
    }
    result.push(message as Message);
  }
  flush();
  return result;
}

function push<K, T>(map: Map<K, T[]>, key: K, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Activity and reasoning messages and anything that is not a plain object
 * (`null`, arrays, primitives) never anchor or separate.
 */
function isTransparent(message: unknown): boolean {
  return (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message) ||
    (message as { role?: unknown }).role === "activity" ||
    (message as { role?: unknown }).role === "reasoning"
  );
}

function roleOf(message: unknown): unknown {
  if (typeof message !== "object" || message === null) return undefined;
  return (message as { role?: unknown }).role;
}
