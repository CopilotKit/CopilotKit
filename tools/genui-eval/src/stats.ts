/** A pass rate with its 95% Wilson interval. */
export interface Rate {
  passes: number;
  total: number;
  rate: number;
  low: number;
  high: number;
}

/**
 * The 95% Wilson score interval of `passes` out of `total`. It stays inside
 * 0..1 and behaves well for small samples and rates near 0 or 1, which is
 * where model evals live.
 */
export function wilson(passes: number, total: number, z = 1.96): Rate {
  if (total === 0) return { passes, total, rate: 0, low: 0, high: 0 };
  const p = passes / total;
  const z2 = z * z;
  const center = (p + z2 / (2 * total)) / (1 + z2 / total);
  const margin =
    (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) /
    (1 + z2 / total);
  return {
    passes,
    total,
    rate: p,
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

/** True when the intervals of two rates do not overlap: a difference that is not luck. */
export function clearlyDifferent(a: Rate, b: Rate) {
  return a.low > b.high || b.low > a.high;
}
