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
  /**
   * Signal field names joined to form the bucket key. Order-independent for
   * dedupe (see `buildCompositeDedupeKey`); ordered here only to surface in
   * rendering context.
   *
   * Absent or empty → single bucket per rule. Use this when the rule's
   * `when` clause already partitions traffic (e.g. one rule per dimension)
   * and there's no finer partition to apply. The bucket key collapses to
   * `rule.id` alone.
   */
  groupBy?: string[];
  /** Milliseconds the bucket remains open after the first match before timer-flush. */
  windowMs: number;
  /** Threshold at which the bucket flushes immediately (before windowMs). */
  minMatches: number;
  /** Mustache template for the composite flush text. Rendered by the engine. */
  template: string;
  // B1: `targets` field removed. The engine uses `rule.targets` for
  // aggregation dispatch; a separate aggregation-level targets override was
  // never wired through `onAggregationFlush` and silently dropped.
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

/**
 * A5: onFlush callbacks can return "suppressed" when an engine-side gate
 * (bootstrap window, rate-limit, all-targets-failed) short-circuits
 * dispatch. The store treats "suppressed" as a no-op: the bucket stays
 * live, `flushedAt` is NOT set, and subsequent ingestion that re-crosses
 * threshold will re-fire onFlush. This prevents silent drop of composites
 * that arrive inside the bootstrap window — post-bootstrap ticks still
 * get a chance to deliver.
 */
export type FlushResult = void | "suppressed";

export type OnFlushCallback = (
  bucket: Bucket,
  reason: FlushReason,
) => FlushResult | Promise<FlushResult>;

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
    // A7: groupBy is optional/empty → single bucket per rule.
    const groupBy = agg.groupBy ?? [];
    const groupValues = this.extractGroupValues(groupBy, signal);
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
    //
    // A5: if onFlush returns "suppressed" (engine-side gate), leave the
    // bucket live with flushedAt still null so a subsequent ingestion
    // crossing threshold re-fires onFlush. Non-suppressed synchronous
    // returns mark flushedAt so we don't re-fire within the same window.
    if (bucket.flushedAt == null && bucket.matches.length >= agg.minMatches) {
      const result = this.onFlush(bucket, "threshold");
      this.applyFlushResult(bucket, now, result);
      // Arm the window timer regardless — we still need cleanup at window
      // expiry, and if the flush was suppressed the bucket stays live until
      // either a re-threshold or window-expiry cleanup fires.
      if (!bucket.flushTimer) {
        this.scheduleFlush(bucket, agg.windowMs);
      }
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
   * Apply the synchronous or promise-bearing flush result back onto the
   * bucket. "suppressed" keeps flushedAt null (bucket stays live);
   * anything else marks flushedAt so subsequent ingests don't re-fire.
   * Promise results are awaited in a fire-and-forget path here — the
   * engine's onAggregationFlush returns a pre-resolved "suppressed"
   * sentinel when its gate short-circuits, so the sync branch is the
   * common case; the async branch is belt-and-braces for future gates.
   */
  private applyFlushResult(
    bucket: Bucket,
    now: number,
    result: FlushResult | Promise<FlushResult>,
  ): void {
    if (result && typeof (result as Promise<FlushResult>).then === "function") {
      void (result as Promise<FlushResult>).then((r) => {
        if (r !== "suppressed") {
          bucket.flushedAt = now;
        }
      });
      // Synchronous optimism: assume success for immediate state. The
      // post-resolve `.then` above can still flip flushedAt to a non-null
      // timestamp; for the "suppressed" path we leave flushedAt null so
      // re-ingestion can re-trigger.
      bucket.flushedAt = now;
      return;
    }
    if (result !== "suppressed") {
      bucket.flushedAt = now;
    }
  }

  /**
   * Flushes all in-flight buckets. Called from `beforeExit` / `SIGTERM` on
   * graceful shutdown. SIGKILL / hard-kill path: in-flight buckets are lost
   * by design — the next probe tick rebuilds state naturally, no persistent
   * store required.
   *
   * A4: drain returns a Promise and awaits each onFlush invocation so a
   * SIGTERM handler can `await store.drain()` and be sure in-flight buckets
   * actually dispatch before the process exits. Pre-fix drain() was
   * synchronous and async onFlush promises vanished into .catch() —
   * beforeExit returned before the Slack call completed.
   *
   * Only invokes `onFlush` for buckets that never reached threshold;
   * already-flushed buckets are silently removed so the shutdown path
   * matches the timer-expiry path (both cleanup, at most one callback).
   */
  async drain(): Promise<void> {
    // Snapshot keys first — flushBucket mutates the map while iterating.
    const pending: Promise<FlushResult>[] = [];
    for (const key of [...this.buckets.keys()]) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      if (bucket.flushedAt == null) {
        // Remove first, then invoke onFlush so map mutation during await
        // doesn't matter; we hold the bucket by reference.
        this.removeBucket(bucket);
        const r = this.onFlush(bucket, "timer");
        if (r && typeof (r as Promise<FlushResult>).then === "function") {
          pending.push(r as Promise<FlushResult>);
        }
      } else {
        this.removeBucket(bucket);
      }
    }
    if (pending.length > 0) {
      await Promise.allSettled(pending);
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
    // A7: absent or empty groupValues → bucket scoped to rule.id alone.
    // Sort entries so the key is order-independent w.r.t. groupBy declaration
    // order (defensive — `groupBy` is author-ordered, but a rule author
    // swapping `[a, b]` for `[b, a]` should NOT reassign the bucket).
    //
    // B4: use NUL as the field-separator so a groupBy value containing `&`
    // or `=` can't collide with a distinct grouping. `${k}=${v}` joined on
    // `&` admitted e.g. `{b:"y&c=z"}` colliding with `{b:"y",c:"z"}`; NUL
    // is not a valid character in any JS string literal source, and probes
    // don't emit NUL in signal fields, so the separator stays injection-safe.
    const entries = Object.entries(groupValues);
    if (entries.length === 0) return rule.id;
    const parts = entries.map(([k, v]) => `${k}=${v}`).sort();
    return `${rule.id}::${parts.join("\u0000")}`;
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
 * across `groupValues` entries (sorted `k=v` parts joined with NUL) so
 * two successive buckets for the same logical group collapse to the same
 * dedupe bucket — the engine's rate_limit + stateStore gate then suppresses
 * repeat flushes within the window. Absent/empty groupValues → key scopes
 * to `rule.id` alone, consistent with `buildBucketKey`.
 */
export function buildCompositeDedupeKey(
  rule: CompiledRule,
  groupValues: Record<string, string>,
): string {
  // A7 + B4: match buildBucketKey — absent/empty groupValues → rule.id
  // scope, NUL separator to preclude collision on values containing `&=`.
  const entries = Object.entries(groupValues);
  if (entries.length === 0) return `${rule.id}::composite`;
  const parts = entries.map(([k, v]) => `${k}=${v}`).sort();
  return `${rule.id}::composite::${parts.join("\u0000")}`;
}
