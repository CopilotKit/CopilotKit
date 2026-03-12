/**
 * Robust JSON parsing utilities for handling malformed JSON strings,
 * particularly useful when dealing with AI-generated JSON that may not be properly escaped.
 */

/**
 * Robust JSON parser that handles both properly stringified JSON and malformed strings.
 * Attempts multiple parsing strategies to handle AI-generated JSON that may not be properly escaped.
 *
 * @param input - The string to parse as JSON
 * @returns The parsed JSON value
 * @throws Error with detailed message if all parsing strategies fail
 *
 * @example
 * // Properly escaped JSON
 * parseRobustJSON('{"foo": "bar"}') // ✅ Works
 *
 * @example
 * // Malformed JSON with unescaped quotes
 * parseRobustJSON('"{ "foo": "bar" }"') // ✅ Works - removes outer quotes
 *
 * @example
 * // Single-quoted wrapper
 * parseRobustJSON("'{ \"foo\": \"bar\" }'") // ✅ Works
 *
 * @example
 * // Already an object (defensive programming)
 * parseRobustJSON({ foo: "bar" }) // ✅ Returns as-is
 */
export function parseRobustJSON(input: string | unknown): unknown {
  // If already an object (shouldn't happen but be defensive)
  if (typeof input !== "string") {
    return input;
  }

  // Trim whitespace
  const trimmed = input.trim();

  // Strategy 1: Try standard JSON.parse
  try {
    return JSON.parse(trimmed);
  } catch (firstError) {
    // Strategy 2: Check if it's a malformed string that looks like JSON but has unescaped quotes
    // This happens when AI sends: "{ "foo": "bar" }" instead of '{ "foo": "bar" }' or "{ \"foo\": \"bar\" }"

    // If the string starts and ends with quotes, try removing the outer quotes
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      try {
        const withoutOuterQuotes = trimmed.slice(1, -1);
        return JSON.parse(withoutOuterQuotes);
      } catch {
        // Strategy 3: Try to unescape common escape sequences that might be double-escaped
        try {
          const unescaped = trimmed
            .slice(1, -1)
            .replace(/\\\\/g, "\\")
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'");
          return JSON.parse(unescaped);
        } catch {
          // All strategies for quoted strings failed, continue to final error
        }
      }
    }

    // Strategy 4: Try parsing if it looks like JSON but without outer quotes
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // Fall through to final error
      }
    }

    // All strategies failed
    throw new Error(
      `Failed to parse JSON. Original error: ${firstError instanceof Error ? firstError.message : String(firstError)}. Input preview: ${trimmed.substring(0, 100)}...`,
    );
  }
}

/**
 * Safely attempts to parse JSON and returns a default value on failure.
 *
 * @param input - The string to parse as JSON
 * @param defaultValue - The value to return if parsing fails
 * @returns The parsed JSON value or the default value
 *
 * @example
 * parseRobustJSONSafe('{"foo": "bar"}', {}) // Returns { foo: "bar" }
 * parseRobustJSONSafe('invalid json', {}) // Returns {}
 */
export function parseRobustJSONSafe<T = unknown>(
  input: string | unknown,
  defaultValue: T,
): T | unknown {
  try {
    return parseRobustJSON(input);
  } catch {
    return defaultValue;
  }
}
