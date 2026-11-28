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

  return function check(
    key: string,
  ): { ok: true } | { ok: false; retryAfter: number } {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

    if (recent.length >= limit) {
      hits.set(key, recent);
      return {
        ok: false,
        retryAfter: Math.ceil((recent[0] + windowMs - now) / 1000),
      };
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

/**
 * A reader's rate-limit key: the IP from the X-Real-IP header Railway's edge
 * sets. X-Forwarded-For is whatever the client sent, so it isn't read. An
 * IPv6 address counts by its /64, the block one connection usually holds, so
 * rotating addresses inside it doesn't reset a limit.
 */
export function clientKey(request: Request): string {
  const ip = request.headers.get("x-real-ip")?.trim() || "unknown";
  if (!ip.includes(":")) return ip;
  const [address] = ip.split("%");
  const [head, tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return `${groups.slice(0, 4).join(":")}::/64`;
}
