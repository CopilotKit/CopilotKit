/**
 * Stable, collision-free React keys for lists whose rows carry NO id.
 *
 * A restock plan's `highlights`, `lines` and `schedule` are authored by the
 * MODEL reading an uploaded price sheet, and nothing on the way in makes them
 * distinct: the tool's zod schema only caps their length, the plans route only
 * maps/filters/slices, and `store.filePlan` only slices. So two identical
 * highlight strings, or two rows for the same SKU (a repeated line on the sheet,
 * or the same SKU quoted at two pack sizes), are a NORMAL outcome — and keying
 * such a row by its own value hands React duplicate keys, which silently
 * corrupts reconciliation instead of failing loudly.
 *
 * Keys are the row's identity plus its 1-based occurrence count, so the first
 * occurrence of a value keeps a value-derived (order-independent) key and only
 * repeats are disambiguated. `#` and `%` in the identity are percent-escaped
 * first, which is what makes the result provably unique: the separator cannot
 * appear inside the escaped identity, the escape is injective, and each
 * (identity, occurrence) pair is by construction distinct.
 */

export interface Keyed<T> {
  key: string;
  item: T;
}

const escapeIdentity = (value: string) =>
  value.replace(/[#%]/g, (char) => (char === "#" ? "%23" : "%25"));

/**
 * Pair every item with a unique React key derived from `identity(item)`.
 *
 * @param items    the rows to render, in render order
 * @param identity the row's natural identity — need not be unique
 */
export function keyedList<T>(
  items: readonly T[],
  identity: (item: T) => string,
): Keyed<T>[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = escapeIdentity(identity(item));
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return { key: `${base}#${occurrence}`, item };
  });
}
