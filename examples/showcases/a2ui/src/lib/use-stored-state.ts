import { useEffect, useState } from "react";

/**
 * State kept in localStorage under `key`. It starts at `fallback` (so the
 * server render and the first client render agree) and takes the stored
 * value after mount when `accept` says it is still valid.
 */
export function useStoredState<T>(
  key: string,
  fallback: T,
  accept: (value: unknown) => value is T,
) {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(
        window.localStorage.getItem(key) ?? "null",
      );
      if (accept(stored)) setValue(stored);
    } catch {
      // Unreadable storage keeps the fallback.
    }
  }, [key, accept]);
  const update = (next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Blocked or full storage must not interrupt the current choice or the
      // caller's next action, such as starting a question in the new format.
    }
  };
  return [value, update] as const;
}

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";
