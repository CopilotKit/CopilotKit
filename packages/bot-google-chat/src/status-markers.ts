/**
 * Single source of truth for the status markers the bot posts to the Google
 * Chat surface but must NOT round-trip back into agent history.
 *
 * These markers are emitted by `event-renderer.ts` (tool-status rows) and
 * `chunked-message-stream.ts` (stream placeholders), and recognised by the
 * history filter in `conversation-store.ts` / `adapter.getMessages`. Keeping
 * the definitions here ensures the emitters and the filter can never drift
 * (which is exactly how the `⏹ ` interrupt marker once leaked into history).
 */

/**
 * Prefixes of bot-authored tool-status rows emitted by `event-renderer.ts`:
 *   🔧 `<tool>`…  — tool-call start row    (onToolCallStartEvent)
 *   ✅ `<tool>`   — tool-call end row      (onToolCallEndEvent)
 *   ⏹ `<tool>`   — interrupted tool row   (markInterrupted)
 *
 * Each entry includes its trailing space so callers can both prefix-match
 * incoming text and build outgoing rows directly from the constant.
 */
export const TOOL_STATUS_PREFIXES = ["🔧 ", "✅ ", "⏹ "] as const;

/**
 * Full text of the `ChunkedMessageStream` placeholders:
 *   _thinking…_    — first-chunk placeholder
 *   _…(continued)_ — continuation placeholder
 */
export const STREAM_PLACEHOLDERS = ["_thinking…_", "_…(continued)_"] as const;

/**
 * True when `text` is a run-renderer status row or stream placeholder that the
 * bot posts to the surface but must NOT round-trip back into agent history.
 *
 * Caller must verify the message is from the bot before applying this filter
 * (a human may legitimately type text that looks like a marker).
 */
export function isBotStatusOrPlaceholder(text: string): boolean {
  return (
    TOOL_STATUS_PREFIXES.some((prefix) => text.startsWith(prefix)) ||
    STREAM_PLACEHOLDERS.some((placeholder) => text === placeholder)
  );
}

/**
 * True when a Google Chat message `sender` is the bot. A sender is the bot when
 * its `type` is `"BOT"`, or — as a secondary guard — when its `name` matches a
 * non-empty `botUserId`.
 *
 * This is the single source of truth shared by `conversation-store.translate`
 * and `adapter.getMessages` so the two history read-paths can never diverge on
 * bot detection. The `!!botUserId` guard ensures an empty `botUserId` never
 * matches a sender whose `name` is also empty/undefined.
 */
export function isBotSender(
  sender: { type?: string; name?: string } | undefined,
  botUserId: string,
): boolean {
  return sender?.type === "BOT" || (!!botUserId && sender?.name === botUserId);
}
