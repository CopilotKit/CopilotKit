/**
 * An in-process map with a size cap and a per-entry time to live.
 *
 * Entries expire `ttlMs` after they were last written and are dropped when
 * read after that. Past `maxEntries`, the least recently used entry (read or
 * written) is evicted. A `Map` keeps insertion order, so re-inserting an entry
 * on access moves it to the most recently used end.
 */
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(private readonly opts: { maxEntries: number; ttlMs: number }) {
    if (!(opts.maxEntries > 0)) {
      throw new RangeError("BoundedCache maxEntries must be positive");
    }
    if (!(opts.ttlMs > 0)) {
      throw new RangeError("BoundedCache ttlMs must be positive");
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (Date.now() > entry.expiresAt) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.opts.ttlMs });
    while (this.entries.size > this.opts.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
