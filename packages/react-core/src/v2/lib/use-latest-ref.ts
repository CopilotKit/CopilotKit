import { useInsertionEffect, useRef } from "react";
import type { MutableRefObject } from "react";

/**
 * Returns a ref that always holds the latest committed `value`, for reading
 * inside callbacks and effects without adding `value` to their deps.
 *
 * The ref is updated in an insertion effect rather than during render, so a
 * render React discards (Suspense, concurrent rendering, StrictMode) can't
 * leak its value. Insertion effects run before every layout and passive
 * effect in the commit, so effects and event handlers see the same value they
 * saw when the ref was assigned during render. Don't read the ref during
 * render: on updates it still holds the previous committed value there.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}
