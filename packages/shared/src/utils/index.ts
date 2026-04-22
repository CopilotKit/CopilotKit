export * from "./clipboard";
export * from "./conditions";
export * from "./console-styling";
export * from "./errors";
export * from "./json-schema";
export * from "./types";
export * from "./random-id";
export * from "./requests";

import * as PartialJSON from "partial-json";

/**
 * Safely parses a JSON string into an object
 * @param json The JSON string to parse
 * @param fallback Optional fallback value to return if parsing fails. If not provided or set to "unset", returns null
 * @returns The parsed JSON object, or the fallback value (or null) if parsing fails
 */
export function parseJson(json: string, fallback: any = "unset") {
  try {
    return JSON.parse(json);
  } catch (e) {
    return fallback === "unset" ? null : fallback;
  }
}

/**
 * Parses a partial/incomplete JSON string, returning as much valid data as possible.
 * Falls back to an empty object if parsing fails entirely.
 */
export function partialJSONParse(json: string) {
  try {
    const parsed = PartialJSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
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

/**
 * Maps an array of items to a new array, skipping items that throw errors during mapping
 * @param items The array to map
 * @param callback The mapping function to apply to each item
 * @returns A new array containing only the successfully mapped items
 */
export function tryMap<TItem, TMapped>(
  items: TItem[],
  callback: (item: TItem, index: number, array: TItem[]) => TMapped,
): TMapped[] {
  return items.reduce<TMapped[]>((acc, item, index, array) => {
    try {
      acc.push(callback(item, index, array));
    } catch (error) {
      console.error(error);
    }
    return acc;
  }, []);
}

/**
 * Checks if the current environment is macOS
 * @returns {boolean} True if running on macOS, false otherwise
 */
export function isMacOS(): boolean {
  return /Mac|iMac|Macintosh/i.test(navigator.userAgent);
}

/**
 * Safely parses a JSON string into a tool arguments object.
 * Returns the parsed object only if it's a plain object (not an array, null, etc.).
 * Falls back to an empty object for any non-object JSON value or parse failure.
 */
export function safeParseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
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
