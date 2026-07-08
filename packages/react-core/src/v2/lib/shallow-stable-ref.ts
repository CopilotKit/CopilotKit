import { useRef } from "react";

// Tailwind-free reference-stability helpers. Kept in their own leaf module (not
// in ./slots, which imports `tailwind-merge`) so that DOM/CSS-free consumers —
// e.g. CopilotChatConfigurationProvider, which is re-exported from the lean
// `@copilotkit/react-core/v2/headless` entry — can reach them without pulling
// `tailwind-merge` into the bundle (issue #4893).

/**
 * Shallow equality comparison for objects.
 */
export function shallowEqual<T extends Record<string, unknown>>(
  obj1: T,
  obj2: T,
): boolean {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (obj1[key] !== obj2[key]) return false;
  }

  return true;
}

/**
 * Returns true only for plain JS objects (`{}`), excluding arrays, Dates,
 * class instances, and other exotic objects that happen to have typeof "object".
 */
function isPlainObject(obj: unknown): obj is Record<string, unknown> {
  return (
    obj !== null &&
    typeof obj === "object" &&
    Object.prototype.toString.call(obj) === "[object Object]"
  );
}

/**
 * Returns the same reference as long as the value is shallowly equal to the
 * previous render's value.
 *
 * - Identical references bail out immediately (O(1)).
 * - Plain objects ({}) are shallow-compared key-by-key.
 * - Arrays, Dates, class instances, functions, and primitives are compared by
 *   reference only — shallowEqual is never called on non-plain objects, which
 *   avoids incorrect equality for e.g. [1,2] vs [1,2] (different arrays).
 *
 * Typical use: stabilize inline slot props so MemoizedSlotWrapper's shallow
 * equality check isn't defeated by a new object reference on every render.
 */
export function useShallowStableRef<T>(value: T): T {
  const ref = useRef(value);

  // 1. Identical reference — bail early, no comparison needed.
  if (ref.current === value) return ref.current;

  // 2. Both are plain objects — shallow-compare to detect structural equality.
  if (isPlainObject(ref.current) && isPlainObject(value)) {
    if (shallowEqual(ref.current, value)) return ref.current;
  }

  // 3. Different values (or non-comparable types) — update the ref.
  ref.current = value;
  return ref.current;
}
