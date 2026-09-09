/**
 * Bounded-concurrency task runner for the publish loop.
 *
 * Publishing N packages serially costs N x (pack + registry round-trip). After
 * the npx fix (see npm-cli.ts) that is ~4.7s per package, so a 26-package
 * `scope=all` canary still spent ~125s almost entirely waiting on the network.
 *
 * Ordering is deliberately NOT preserved as a correctness property: prerelease.ts
 * documents that the cross-scope dependency graph has cycles (runtime ->
 * channels-intelligence, channels-core -> core), so NO serial order avoids
 * publishing a package before the same-run version it pins. Concurrency
 * therefore does not weaken an invariant that serial execution was providing.
 */

/**
 * Run `fn` over every item with at most `limit` in flight.
 *
 * Every item is attempted even if others reject — a half-published release is
 * unrecoverable either way (npm refuses to republish a version), so the operator
 * is better served by ONE report naming every failure than by a fail-fast that
 * hides which packages still need attention. Results are returned in input
 * order regardless of completion order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<{ item: T; value?: R; error?: unknown }>> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `Concurrency limit must be a positive integer, got ${limit}`,
    );
  }

  const results: Array<{ item: T; value?: R; error?: unknown }> = Array.from(
    { length: items.length },
    () => ({}) as { item: T; value?: R; error?: unknown },
  );
  let cursor = 0;

  async function worker(): Promise<void> {
    // Each worker claims the next index atomically — JS is single-threaded
    // between awaits, so the read-then-increment cannot interleave.
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      try {
        results[index] = { item, value: await fn(item, index) };
      } catch (error) {
        results[index] = { item, error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}
