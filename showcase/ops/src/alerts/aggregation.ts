import type { CompiledRule } from "../rules/rule-loader.js";

/**
 * Cross-service alert aggregation (plan Item 4).
 *
 * When a rule declares `aggregation: { groupBy, windowMs, minMatches, template }`,
 * matching signals are collected into in-memory buckets keyed on the join of
 * `groupBy` field values. A bucket flushes via `onFlush` in two ways:
 *
 *   - `threshold` — bucket.matches.length >= minMatches (immediate flush)
 *   - `timer`     — windowMs elapsed since the first match (setTimeout fires)
 *
 * The store is transport-agnostic: it owns bucket lifecycle, composite key
 * derivation, and timer management. It does NOT render templates, gate on
 * rate-limit / dedupe / bootstrap, or dispatch to targets — all of that is
 * the alert-engine's responsibility to apply inside its `onFlush` closure.
 *
 * This separation keeps the store easy to unit-test in isolation (see
 * alert-engine.test.ts "AggregationBucketStore" block) and keeps engine
 * control-flow gates localized to one place.
 */

/** Shape of an aggregated signal. Engine callers can pass anything matching
 *  the signal shape their probes emit; the store only reads `groupBy` fields
 *  off it by name. Kept permissive so aggregation doesn't require widening
 *  the ProbeResult signal contract. */
export type Signal = Record<string, unknown>;

export interface AggregationConfig {
  /** Signal field names joined to form the bucket key. Order-independent for
   *  dedupe (see `buildCompositeDedupeKey`); ordered here only to surface in
   *  rendering context. */
  groupBy: string[];
  /** Milliseconds the bucket remains open after the first match before timer-flush. */
  windowMs: number;
  /** Threshold at which the bucket flushes immediately (before windowMs). */
  minMatches: number;
  /** Mustache template for the composite flush text. Rendered by the engine. */
  template: string;
  /** Optional target aliases; when absent the host rule's targets are used. */
  targets?: string[];
}

export interface Bucket {
  key: string;
  ruleId: string;
  groupValues: Record<string, string>;
  matches: Signal[];
  firstMatchAt: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Timestamp (ms) at which a threshold flush fired, or null if the bucket
   * has not yet flushed. Once set, subsequent ingests still append to
   * `matches` (so the `onFlush` receiver's bucket reference reflects the
   * full window's worth of signals) but do NOT re-fire `onFlush`. The
   * window-expiry timer then just cleans the bucket out of the map
   * without a second callback.
   */
  flushedAt: number | null;
}

export type FlushReason = "threshold" | "timer";

export type OnFlushCallback = (bucket: Bucket, reason: FlushReason) => void;

export class AggregationBucketStore {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly onFlush: OnFlushCallback) {}

  /** Number of in-flight buckets. Test-facing invariant (TTL eviction). */
  get size(): number {
    return this.buckets.size;
  }

  /**
   * Ingest a matching signal against an aggregated rule. Finds-or-creates a
   * bucket keyed on the rule's `groupBy` join, pushes the signal, and fires
   * `onFlush` the first time the bucket reaches `minMatches`.
   *
   * Flush semantics (plan Item 4 red-phase contract):
   *   - Threshold flush: `onFlush(bucket, "threshold")` fires ONCE on the
   *     ingest that takes `matches.length` to or past `minMatches`. Subsequent
   *     matches within the same window still append to `matches` (so the
   *     receiver's captured bucket reference reflects the full count), but
   *     do NOT re-fire `onFlush`.
   *   - Timer flush: if the bucket never reaches threshold, a `windowMs`
   *     timer fires `onFlush(bucket, "timer")` at expiry. Either way the
   *     bucket is removed from the map exactly once — by whichever path
   *     runs cleanup.
   *
   * The window timer is armed once per bucket (NOT reset on each match) so a
   * steady trickle of signals can't postpone flush indefinitely.
   */
  ingest(rule: CompiledRule, signal: Signal, now: number): void {
    const agg = rule.aggregation;
    if (!agg) return;
    const groupValues = this.extractGroupValues(agg.groupBy, signal);
    const key = this.buildBucketKey(rule, groupValues);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        ruleId: rule.id,
        groupValues,
        matches: [],
        firstMatchAt: now,
        flushTimer: null,
        flushedAt: null,
      };
      this.buckets.set(key, bucket);
    }
    bucket.matches.push(signal);

    // Fire the threshold flush exactly once per bucket, the first time the
    // match count reaches minMatches. Additional matches within the window
    // continue to append to the already-flushed bucket so the `onFlush`
    // receiver (which holds the bucket by reference) sees the full set.
    if (bucket.flushedAt == null && bucket.matches.length >= agg.minMatches) {
      bucket.flushedAt = now;
      this.onFlush(bucket, "threshold");
      return;
    }

    // Arm the window timer exactly once per bucket. The timer always fires
    // — its job is cleanup — but only invokes `onFlush` again if the bucket
    // never reached threshold (i.e. flushedAt is still null at expiry).
    if (!bucket.flushTimer) {
      this.scheduleFlush(bucket, agg.windowMs);
    }
  }

  /**
   * Flushes all in-flight buckets. Called from `beforeExit` on graceful
   * shutdown. SIGKILL / hard-kill path: in-flight buckets are lost by design
   * — the next probe tick rebuilds state naturally, no persistent store
   * required.
   *
   * Only invokes `onFlush` for buckets that never reached threshold;
   * already-flushed buckets are silently removed so the shutdown path
   * matches the timer-expiry path (both cleanup, at most one callback).
   */
  drain(): void {
    // Snapshot keys first — flushBucket mutates the map while iterating.
    for (const key of [...this.buckets.keys()]) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      if (bucket.flushedAt == null) {
        this.flushBucket(bucket, "timer");
      } else {
        this.removeBucket(bucket);
      }
    }
  }

  private extractGroupValues(
    groupBy: string[],
    signal: Signal,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const field of groupBy) {
      const v = signal[field];
      out[field] = typeof v === "string" ? v : String(v ?? "");
    }
    return out;
  }

  private buildBucketKey(
    rule: CompiledRule,
    groupValues: Record<string, string>,
  ): string {
    // Sort entries so the key is order-independent w.r.t. groupBy declaration
    // order (defensive — `groupBy` is author-ordered, but a rule author
    // swapping `[a, b]` for `[b, a]` should NOT reassign the bucket).
    const parts = Object.entries(groupValues)
      .map(([k, v]) => `${k}=${v}`)
      .sort();
    return `${rule.id}::${parts.join("&")}`;
  }

  /** Flush + remove. Used for below-threshold timer expiry and drain. */
  private flushBucket(bucket: Bucket, reason: FlushReason): void {
    this.removeBucket(bucket);
    this.onFlush(bucket, reason);
  }

  /** Remove from map + clear timer WITHOUT invoking onFlush. Used to clean
   *  up already-threshold-flushed buckets whose window has now expired. */
  private removeBucket(bucket: Bucket): void {
    if (bucket.flushTimer) {
      clearTimeout(bucket.flushTimer);
      bucket.flushTimer = null;
    }
    this.buckets.delete(bucket.key);
  }

  private scheduleFlush(bucket: Bucket, delayMs: number): void {
    bucket.flushTimer = setTimeout(() => {
      // Defensive: confirm we're still the owner of this key. A race is
      // impossible today (single-threaded) but the check costs nothing.
      if (this.buckets.get(bucket.key) !== bucket) return;
      if (bucket.flushedAt != null) {
        // Threshold already fired — timer's only job now is cleanup.
        this.removeBucket(bucket);
      } else {
        this.flushBucket(bucket, "timer");
      }
    }, delayMs);
  }
}

/**
 * Stable composite dedupe key for a rule's aggregation flush. Order-independent
 * across `groupValues` entries (sorted `k=v` parts joined with `&`) so
 * two successive buckets for the same logical group collapse to the same
 * dedupe bucket — the engine's rate_limit + stateStore gate then suppresses
 * repeat flushes within the window.
 */
export function buildCompositeDedupeKey(
  rule: CompiledRule,
  groupValues: Record<string, string>,
): string {
  const parts = Object.entries(groupValues)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  return `${rule.id}::composite::${parts.join("&")}`;
}
