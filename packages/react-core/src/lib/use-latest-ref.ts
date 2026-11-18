import { useEffect, useLayoutEffect, useRef } from "react";
import type { MutableRefObject } from "react";

// A layout effect does nothing on the server, and React 18 warns about it.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * A ref that holds the latest `value`, for callbacks that run after render
 * (event handlers, controller callbacks). The ref changes in a layout effect,
 * not during render, so a render that React throws away leaves it alone.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
