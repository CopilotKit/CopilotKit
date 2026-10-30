/**
 * True when both records have the same own keys and each key holds the same
 * value (compared with `Object.is`). Key order does not matter. Nested
 * objects are compared by reference, not by content.
 */
export function shallowEqualRecord<T>(
  a: Readonly<Record<string, T>>,
  b: Readonly<Record<string, T>>,
) {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]),
  );
}
