const SETTLE_FAILURE_REASONS = new Set([
  "sse-missing",
  "dom-missing",
  "text-unstable",
  "done-signal-missing",
  "surface-missing",
  // Retain the historical categories while older callers and artifacts
  // still exist. The five entries above are the current runner's exact
  // TurnNotCompleteError reasons.
  "surface-not-ready",
  "no-assistant-message",
  "run-still-active",
]);

/**
 * Reduce a free-form conversation failure to a bounded category suitable for
 * CI logs and artifacts. The source error may contain prompts, generated
 * response text, assertion payloads, or provider messages and must never be
 * logged directly.
 */
export function conversationFailureSummary(error: string | undefined): string {
  if (!error) return "unknown";

  const settleReason = /\breason=([a-z-]+)/.exec(error)?.[1];
  if (settleReason && SETTLE_FAILURE_REASONS.has(settleReason)) {
    return `settle-${settleReason}`;
  }
  if (error.includes("done-signal-missing")) return "done-signal-missing";
  if (error.includes("ui/initialize")) return "mcp-initialization-missing";
  if (error.includes("assistant response was empty")) {
    return "assistant-response-empty";
  }
  if (
    error.includes("Observed:") ||
    error.includes("missing expected marker") ||
    error.includes("wrong pill")
  ) {
    return "rendered-content-mismatch";
  }
  if (error.includes("not found") || error.includes("to appear within")) {
    return "expected-surface-missing";
  }
  if (error.toLowerCase().includes("timeout")) return "timeout";
  return "assertion-failed";
}
