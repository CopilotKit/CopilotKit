import { shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter, ShallowRef } from "vue";

function shallowEqualObjects(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
): boolean {
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  if (firstKeys.length !== secondKeys.length) return false;

  for (const key of firstKeys) {
    if (first[key] !== second[key]) return false;
  }

  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

/**
 * Keeps reference identity stable for shallow-equal plain-object inputs.
 * Non-plain objects keep strict reference equality semantics.
 */
export function useShallowStableRef<T>(
  value: MaybeRefOrGetter<T>,
): Readonly<ShallowRef<T>> {
  const stable = shallowRef(toValue(value)) as ShallowRef<T>;

  watch(
    () => toValue(value),
    (next) => {
      const previous = stable.value;
      if (previous === next) return;

      if (isPlainObject(previous) && isPlainObject(next)) {
        if (shallowEqualObjects(previous, next)) {
          return;
        }
      }

      stable.value = next;
    },
    { immediate: true },
  );

  return stable;
}
