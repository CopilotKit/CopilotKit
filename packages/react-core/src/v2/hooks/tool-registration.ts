import { useInsertionEffect, useRef } from "react";

/**
 * Deps comparison shared by `useFrontendTool` (and through it
 * `useHumanInTheLoop` and `useComponent`) and `useRenderTool`. Not part of the
 * public API.
 */

const EMPTY_DEPS: ReadonlyArray<unknown> = [];

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Plain data (primitives, plain objects, arrays, dates) compares by value.
 * Functions always compare equal: these hooks used to compare
 * `JSON.stringify(deps)`, which turns every function into `null`, and a
 * function that counted as changed would re-register on every render when it
 * is written inline (and loop in a component that also reads
 * `useRenderToolCall`). Everything else (class instances, maps, sets) compares
 * by identity. A cycle inside plain data is safe: a pair already being
 * compared counts as equal for that branch.
 */
function depEqual(a: unknown, b: unknown, seen: Map<object, object>): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === "function" && typeof b === "function") return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (a instanceof Date && b instanceof Date) {
    return Object.is(a.getTime(), b.getTime());
  }
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (!aIsArray && !(isPlainObject(a) && isPlainObject(b))) return false;

  if (seen.get(a) === b) return true;
  seen.set(a, b);

  if (aIsArray) {
    const left = a as unknown[];
    const right = b as unknown[];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (!depEqual(left[i], right[i], seen)) return false;
    }
    return true;
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!depEqual(left[key], right[key], seen)) return false;
  }
  return true;
}

/** Whether two deps arrays are equal. A change in length is always a change. */
export function depsEqual(
  prev: ReadonlyArray<unknown>,
  next: ReadonlyArray<unknown>,
): boolean {
  if (prev.length !== next.length) return false;
  const seen = new Map<object, object>();
  for (let i = 0; i < prev.length; i++) {
    if (!depEqual(prev[i], next[i], seen)) return false;
  }
  return true;
}

/**
 * Turns a caller's `deps` array into a number that changes exactly when the
 * deps change, by the rules of {@link depsEqual}. Put the number, not the
 * array, in the registration effect's dependency list: that keeps the list a
 * constant length and never serializes a value.
 *
 * Deps are compared with the last COMMITTED render's. The ref is written in an
 * insertion effect rather than during render, so a render React discards can't
 * move the baseline and make the next commit re-register for nothing.
 */
export function useDepsVersion(deps?: ReadonlyArray<unknown>): number {
  const next = deps ?? EMPTY_DEPS;
  const committedRef = useRef({ deps: next, version: 0 });
  const committed = committedRef.current;
  const current =
    committed.deps === next || depsEqual(committed.deps, next)
      ? committed
      : { deps: next, version: committed.version + 1 };
  useInsertionEffect(() => {
    committedRef.current = current;
  });
  return current.version;
}
