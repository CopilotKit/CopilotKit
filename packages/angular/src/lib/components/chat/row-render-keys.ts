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
}

export function createRowKeyStore(): RowKeyStore {
  return { overrides: new Map() };
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
 * Mutates `store` additively — it registers anchors but never removes them, so
 * the call is idempotent for a given message list. That matters because this
 * runs inside a `computed`, which Angular may re-evaluate at will: re-running
 * yields the same keys. Removal happens in `pruneRowKeyStore` after render,
 * never during evaluation, so an anchor the rendered rows still need can't be
 * dropped out from under them.
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

    // First claimant of an anchor owns it, so a re-keyed message resolves to
    // the key the row already had rather than overwriting it.
    for (const anchor of anchors) {
      if (!store.overrides.has(anchor)) store.overrides.set(anchor, key);
    }
  });

  return keys;
}

/**
 * Drops anchors no longer present in `messages`, bounding the store to the tool
 * calls of the currently-rendered messages. Call after render (an
 * `afterRenderEffect`), never during `computed` evaluation.
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
}
