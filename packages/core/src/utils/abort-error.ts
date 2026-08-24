/**
 * Messages the AG-UI run pipeline produces when a run is torn down rather than
 * failing: the fetch layer's own abort wording, and the marker the bindings
 * throw when a component unmounts mid-run. They carry no `AbortError` name, so
 * a name-only check misses every one of them.
 *
 * Kept in sync with `AbstractAgent.onError` in `@ag-ui/client`, which suppresses
 * exactly this set.
 */
const ABORT_MESSAGES: ReadonlySet<string> = new Set([
  "Fetch is aborted",
  "signal is aborted without reason",
  "component unmounted",
]);

/**
 * Detect a cancellation — the user pressed Stop, a component unmounted, or a
 * signal was aborted — as opposed to a genuine failure.
 *
 * Cancellation is signalled two different ways in this codebase: an
 * `AbortError` from the fetch layer, and the fixed message strings above. Both
 * mean "the caller cancelled", so both have to be recognised anywhere a request
 * outcome is classified. The runtime connection health seam depends on this: a
 * cancelled request must never be read as the runtime being unreachable.
 *
 * Detection is by `name`, not `instanceof Error`: a `DOMException` is not an
 * `Error` in Safari and older engines, and this package runs client-side.
 */
export function isAbortError(error: unknown): boolean {
  if (typeof error === "string") {
    return ABORT_MESSAGES.has(error);
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "AbortError") {
    return true;
  }
  return typeof message === "string" && ABORT_MESSAGES.has(message);
}
