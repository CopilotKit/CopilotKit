/**
 * `Promise.all(items.map(fn))` with at most `limit` calls in flight. Loading
 * every live page at once (llms-full.txt, the search index) would compile
 * hundreds of MDX files in parallel on a dev server.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}
