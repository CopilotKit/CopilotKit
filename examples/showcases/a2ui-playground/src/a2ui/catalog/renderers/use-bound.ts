"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Two-way binding for input renderers.
 *
 * The engine resolves `{ "@path" }` props to a plain value and generates a
 * `setX` writer that writes back to the A2UI data model. If the agent sent a
 * literal instead of a binding, the writer is a no-op, so we also keep local
 * state: the control stays editable either way, and data-model updates from
 * the agent still flow in.
 */
export function useBound<T>(
  value: T | undefined,
  setValue: ((v: T) => void) | undefined,
  fallback: T,
) {
  const [local, setLocal] = useState<T>(value ?? fallback);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      // A removed value resets the control, so it matches the data model.
      setLocal(value === undefined ? fallback : value);
    }
  }, [value, fallback]);
  const set = useCallback(
    (next: T) => {
      setLocal(next);
      setValue?.(next);
    },
    [setValue],
  );
  return [local, set] as const;
}
