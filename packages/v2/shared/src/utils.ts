import { v4 as uuidv4 } from "uuid";
import * as PartialJSON from "partial-json";

export function randomUUID() {
  return uuidv4();
}

export function partialJSONParse(json: string): unknown {
  try {
    const parsed = PartialJSON.parse(json);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    console.warn(
      `[CopilotKit] Tool arguments parsed to non-object (${typeof parsed}), falling back to empty object`,
    );
    return {};
  } catch (error) {
    return {};
  }
}

/**
 * Safely parses a JSON string into a plain object for tool arguments.
 * Handles two failure modes:
 *  1. Malformed JSON (SyntaxError from JSON.parse)
 *  2. Valid JSON that isn't a plain object (e.g. "", [], null, 42, true)
 * Falls back to an empty object for safety in both cases.
 */
export function safeParseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    console.warn(
      `[CopilotKit] Tool arguments parsed to non-object (${typeof parsed}), falling back to empty object`,
    );
    return {};
  } catch {
    console.warn(
      "[CopilotKit] Failed to parse tool arguments, falling back to empty object",
    );
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
