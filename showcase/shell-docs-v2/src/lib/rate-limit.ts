/**
 * A sliding-window request limit per key, held in memory. Each server
 * instance keeps its own counts, so behind several instances the effective
 * limit is per instance.
 */
export function createRateLimit({
  limit,
  windowMs,
}: {
  limit: number;
  windowMs: number;
}) {
  const hits = new Map<string, number[]>();

  return function check(key: string): { ok: true } | { ok: false; retryAfter: number } {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

    if (recent.length >= limit) {
      hits.set(key, recent);
      return { ok: false, retryAfter: Math.ceil((recent[0] + windowMs - now) / 1000) };
    }

    recent.push(now);
    hits.set(key, recent);

    // Forget keys that have gone quiet, so the map stays bounded.
    if (hits.size > 10_000) {
      for (const [k, times] of hits) {
        if (now - times[times.length - 1] >= windowMs) hits.delete(k);
      }
    }

    return { ok: true };
  };
}
