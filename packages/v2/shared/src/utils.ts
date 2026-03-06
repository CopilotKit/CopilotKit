import { v4 as uuidv4 } from "uuid";
import * as PartialJSON from "partial-json";

export function randomUUID() {
  return uuidv4();
}

export function partialJSONParse(json: string) {
  try {
    return PartialJSON.parse(json);
  } catch (error) {
    return {};
  }
}

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
