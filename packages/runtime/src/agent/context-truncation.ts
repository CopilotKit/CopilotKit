/**
 * Maximum length (in characters) of a single application-context value before it
 * is truncated in the assembled system prompt.
 *
 * Application context (`useAgentContext`) is injected verbatim into the prompt.
 * Oversized values (a full document, a large JSON blob) can blow the context
 * window and inflate cost, so we clamp each value to this limit.
 */
export const MAX_CONTEXT_VALUE_LENGTH = 20_000;

const TRUNCATION_MARKER = "\n… [truncated by CopilotKit]";

/**
 * The returned value (including the truncation marker) stays within
 * `MAX_CONTEXT_VALUE_LENGTH`, so the output limit is a hard contract rather
 * than a payload-only one. A trailing UTF-16 surrogate is also trimmed so the
 * value never ends on a lone high surrogate (which stricter providers reject).
 */
export function truncateContextValue(value: string): string {
  if (value.length <= MAX_CONTEXT_VALUE_LENGTH) return value;
  let head = value.slice(0, MAX_CONTEXT_VALUE_LENGTH - TRUNCATION_MARKER.length);

  // `slice` can land between a surrogate pair, leaving a lone high surrogate at
  // the end. Drop it so the value doesn't end on an unpaired codepoint.
  if (head.length > 0) {
    const last = head.charCodeAt(head.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
      head = head.slice(0, -1);
    }
  }

  return `${head}${TRUNCATION_MARKER}`;
}
