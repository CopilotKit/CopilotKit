export const DEFAULT_AGENT_ID = "default";

/** Phoenix channel event name used for all AG-UI events. */
export const AG_UI_CHANNEL_EVENT = "ag-ui";

/**
 * Returns an exponential backoff function suitable for Phoenix.js
 * `reconnectAfterMs` and `rejoinAfterMs` options.
 *
 * @param baseMs  - Initial delay for the first retry attempt.
 * @param maxMs   - Upper bound — delays are capped at this value.
 *
 * Phoenix calls the returned function with a 1-based `tries` count.
 * The delay doubles on each attempt: baseMs, 2×baseMs, 4×baseMs, …, maxMs.
 */
export function phoenixExponentialBackoff(
  baseMs: number,
  maxMs: number,
): (tries: number) => number {
  return (tries: number) => Math.min(baseMs * 2 ** (tries - 1), maxMs);
}
