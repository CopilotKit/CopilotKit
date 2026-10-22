import { useInsertionEffect, useRef } from "react";
import type { MutableRefObject } from "react";

/**
 * Returns a ref that always holds the latest committed `value`, for reading
 * inside callbacks and effects without adding `value` to their deps.
 *
 * The ref is updated in an insertion effect rather than during render, so a
 * render React discards (Suspense, concurrent rendering, StrictMode) can't
 * leak its value. In the commit, the insertion effect runs before layout
 * effect setups, ref attaches and passive effects anywhere in the tree, so
 * those, plus event handlers and async callbacks, see the new value.
 *
 * Earlier in the same commit the ref still holds the previous value: during
 * render, and in descendants' (or earlier siblings') insertion effects,
 * layout effect cleanups and ref detaches. Don't read it from those.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}
