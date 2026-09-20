import type { AssistantMessage, Message } from "@ag-ui/core";

/**
 * Stable `@for` track keys for chat rows, across backends that re-key a message
 * mid-stream.
 *
 * ## The problem
 *
 * A message's canonical `id` is not stable within a turn. LangChain stamps a
 * placeholder id on the first streamed chunk when the provider didn't supply
 * one (`chat_models.py`: `if chunk.message.id is None: chunk.message.id =
 * "lc_run-" + "-" + run_id`), then prefers any provider-assigned id it sees
 * while merging chunks (`messages/ai.py`, "Ranks are defined by the order of
 * preference"). The `MESSAGES_SNAPSHOT` therefore carries the provider's final
 * id (e.g. `resp_…`) for a message the client already knows as `lc_run--…`.
 *
 * Because `@for` destroys and recreates a row whose track value changes, that
 * swap produced the visible HITL chat flash, where a rendered approval card
 * appears to reset during a tool's `executing → complete` transition.
 *
 * This is provider-conditional: providers that stamp an id on every chunk (so
 * `chunk.message.id is None` never holds) never trigger a rename.
 *
 * ## The approach
 *
 * Tool-call ids survive the rename, so they are used as *anchors*: the first
 * message seen carrying a given tool call records the row key it was assigned,
 * and any later message carrying that same tool call reuses it. The store is an
 * override table consulted before falling back to `message.id`:
 *
 * ```text
 * render 1  id=lc_run--1  no tools    key = message.id = lc_run--1     store {}
 * render 2  id=lc_run--1  tc call_A   key = message.id = lc_run--1     store { tc:call_A -> lc_run--1 }
 * render 3  id=resp_1     tc call_A   key = store[tc:call_A]           store unchanged
 *                                         = lc_run--1  (row survives)
 * ```
 *
 * Registering the anchor at render 2 — while the id is still stable — is what
 * makes render 3 resolvable. The fix does not depend on render 2 existing: a
 * message born already carrying a tool call registers its anchor on the render
 * that first shows it, under whatever id it holds then.
 *
 * ## Why an override table rather than tracking by tool-call id
 *
 * Deriving the key from the tool call directly (`tc:<id>` whenever a tool call
 * is present) needs no state, but changes the key the moment a tool call
 * *appears* — so an assistant message that streams text and then calls a tool
 * is destroyed and recreated on that transition, for every provider, whether or
 * not it renames. That trades a conditional flash for an unconditional one.
 * Recording an override keeps the key the row already had.
 *
 * ## Keys are returned by position, not by message id
 *
 * Unlike the React and Vue ports, this returns an array parallel to the input
 * list. Those ports deduplicate messages by id before rendering; this component
 * does not, so a duplicate id would collapse two rows into one map entry and
 * hand `@for` the same track value twice (which Angular reports as an error).
 * Indexing by position sidesteps that, and every returned key is unique by
 * construction.
 *
 * ## Cost
 *
 * The store holds only `tc:<toolCallId>` entries, so a conversation with no tool
 * calls keeps an empty store and behaviour identical to tracking by `id`. Size
 * is bounded to the tool calls of the currently-rendered messages (see
 * `pruneRowKeyStore`), not the conversation length.
 *
 * ## Known gaps
 *
 * - A text-only assistant message has no anchor, so its row is still recreated
 *   when re-keyed. No client-side correlation signal exists for it; the fix is
 *   stable ids upstream.
 * - If the tool call's arrival and the id swap land in the same change-detection
 *   pass, the intermediate state never renders, the anchor is never registered,
 *   and the row is recreated as before.
 *
 * Kept per-package (rather than shared) to match how message-view helpers are
 * handled across the framework packages. The React and Vue ports carry the same
 * logic; changes here should be mirrored there.
 */

const TOOL_ANCHOR_PREFIX = "tc:";

export interface RowKeyStore {
  /**
   * `tc:<toolCallId>` → the row key first assigned to a message carrying that
   * tool call. Populated only for assistant messages that carry tool calls.
   */
  overrides: Map<string, string>;
  /**
   * Anchors carried by more than one message in the last rendered list. Such an
   * anchor identifies no single row, so it is never used to vend a key.
   */
  ambiguous: Set<string>;
}

export function createRowKeyStore(): RowKeyStore {
  return { overrides: new Map(), ambiguous: new Set() };
}

/**
 * Anchors a message contributes. Only assistant tool calls qualify: LangChain's
 * id preference applies when merging `AIMessageChunk`s, so user message ids are
 * not renamed, and `role: "tool"` messages are not rendered as rows. Every tool
 * call is used (not just the first) so the anchor survives tool-call reordering
 * between snapshots.
 */
function toolAnchorsOf(message: Message | undefined): string[] {
  if (message?.role !== "assistant") return [];
  const toolCalls = (message as AssistantMessage).toolCalls;
  if (!toolCalls?.length) return [];

  const anchors: string[] = [];
  for (const toolCall of toolCalls) {
    if (toolCall?.id) anchors.push(`${TOOL_ANCHOR_PREFIX}${toolCall.id}`);
  }
  return anchors;
}

/**
 * Resolves the track key for every message, returned by position.
 *
 * Pure: it reads `store` and never writes to it. This runs inside a
 * `computed`, which Angular may evaluate without that value ever reaching the
 * DOM. An anchor recorded by such an evaluation would vend its key to the pass
 * that does render, re-keying a row the user is looking at — which is the
 * teardown this module exists to prevent. Anchors are recorded by
 * `commitRowKeyStore`, in an `afterRenderEffect`.
 *
 * Iteration order is significant — the first message to claim a key keeps it.
 */
export function resolveRowRenderKeys(
  store: RowKeyStore,
  messages: readonly (Message | undefined)[],
): string[] {
  const keys: string[] = [];
  const claimed = new Set<string>();

  messages.forEach((message, index) => {
    const anchors = toolAnchorsOf(message);

    // Reuse the key recorded for any of this message's anchors. An override
    // pointing at a key another row already claimed this pass is skipped: two
    // messages can share a tool-call id (upstream bug, or replayed state), and
    // the later one falls back to its own id instead.
    let key: string | undefined;
    for (const anchor of anchors) {
      if (store.ambiguous.has(anchor)) continue;
      const recorded = store.overrides.get(anchor);
      if (recorded !== undefined && !claimed.has(recorded)) {
        key = recorded;
        break;
      }
    }

    // Mirrors the previous trackBy fallback for a message with no usable id.
    key ??= message?.id || `index-${index}`;

    // Uniqueness is structural rather than assumed: this component does not
    // deduplicate, so two rows can legitimately arrive with the same id, and an
    // override can vend a key equal to a later message's own id.
    if (claimed.has(key)) {
      let suffix = 2;
      while (claimed.has(`${key}:${suffix}`)) suffix += 1;
      key = `${key}:${suffix}`;
    }

    keys.push(key);
    claimed.add(key);
  });

  return keys;
}

/**
 * Records the anchors of a rendered list, then bounds the store to it. Call
 * from an `afterRenderEffect`, never during `computed` evaluation — see
 * `resolveRowRenderKeys`.
 *
 * Re-resolving here reproduces the keys the rows were rendered with, because
 * the store cannot change between an evaluation and the render effect that
 * follows it.
 *
 * An anchor carried by two rows in the same list is marked ambiguous rather
 * than recorded. Recording it would give the first row's key to whichever row
 * outlived the other, and with it that row's DOM and component state.
 */
export function commitRowKeyStore(
  store: RowKeyStore,
  messages: readonly (Message | undefined)[],
): void {
  const keys = resolveRowRenderKeys(store, messages);

  const anchorCounts = new Map<string, number>();
  for (const message of messages) {
    for (const anchor of toolAnchorsOf(message)) {
      anchorCounts.set(anchor, (anchorCounts.get(anchor) ?? 0) + 1);
    }
  }

  // Ambiguity is a property of the rendered list, so it is recomputed rather
  // than accumulated: an anchor left alone by the row that shadowed it becomes
  // usable again.
  store.ambiguous.clear();
  for (const [anchor, count] of anchorCounts) {
    if (count > 1) {
      store.ambiguous.add(anchor);
      store.overrides.delete(anchor);
    }
  }

  // First claimant of an anchor owns it, so a re-keyed message resolves to
  // the key the row already had rather than overwriting it.
  messages.forEach((message, index) => {
    const key = keys[index];
    if (key === undefined) return;
    for (const anchor of toolAnchorsOf(message)) {
      if (store.ambiguous.has(anchor)) continue;
      if (!store.overrides.has(anchor)) store.overrides.set(anchor, key);
    }
  });

  pruneRowKeyStore(store, messages);
}

/**
 * Drops anchors no longer present in `messages`, bounding the store to the tool
 * calls of the currently-rendered messages. Called by `commitRowKeyStore`;
 * like it, this writes to the store and so belongs in an `afterRenderEffect`,
 * never in `computed` evaluation.
 *
 * Pruned entries are unreachable by construction: `resolveRowRenderKeys` only
 * looks up anchors belonging to messages in the list it is given.
 */
export function pruneRowKeyStore(
  store: RowKeyStore,
  messages: readonly (Message | undefined)[],
): void {
  const live = new Set<string>();
  for (const message of messages) {
    for (const anchor of toolAnchorsOf(message)) live.add(anchor);
  }

  for (const anchor of store.overrides.keys()) {
    if (!live.has(anchor)) store.overrides.delete(anchor);
  }
  for (const anchor of store.ambiguous) {
    if (!live.has(anchor)) store.ambiguous.delete(anchor);
  }
}
