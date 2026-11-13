/**
 * Helpers shared by the React Native generative UI components. Not part of
 * the public entry.
 */
import { useEffect, useRef } from "react";

export const isDevelopment = () => process.env.NODE_ENV !== "production";

/**
 * Warns in development, once for each distinct message of this component
 * instance: a message that stays the same across renders warns once, and so
 * does one that goes away and comes back (A, B, A warns A once and B once).
 * When `resetKey` changes (a new input, such as another activity message or
 * another catalog), every message can warn once again. Each entry of
 * `messages` is checked on its own; undefined entries are skipped.
 */
export function useDevelopmentWarnings(
  messages: ReadonlyArray<string | undefined>,
  resetKey?: unknown,
) {
  const warned = useRef<{ resetKey: unknown; messages: Set<string> }>({
    resetKey,
    messages: new Set(),
  });
  const key = messages.join("\u0000");
  useEffect(() => {
    if (!isDevelopment()) return;
    if (!Object.is(warned.current.resetKey, resetKey)) {
      warned.current = { resetKey, messages: new Set() };
    }
    for (const message of messages) {
      if (message === undefined || warned.current.messages.has(message)) {
        continue;
      }
      warned.current.messages.add(message);
      console.warn(message);
    }
    // `key` stands for `messages`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, resetKey]);
}

/**
 * A value for a warning, as JSON when it has a JSON form (a string comes out
 * quoted), so an object does not print as "[object Object]".
 */
export function describeValue(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // A cycle or a BigInt: fall through to String().
  }
  return String(value);
}
