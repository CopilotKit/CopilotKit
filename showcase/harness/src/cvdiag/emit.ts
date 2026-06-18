/**
 * emit.ts — `CvdiagEmitter`: tier resolution, §6 tier-matrix boundary filter,
 * DEBUG hard-bounds, per-event byte caps, bounded in-memory queue, span/id
 * minting, and a background-flush seam (the actual PocketBase write is wired by
 * L0-B's `pb-writer.ts`, which this module imports as a TYPE ONLY — there is no
 * PB client implemented here). Plan unit: L0-A.
 *
 * Spec: 2026-06-18-flap-observability.md §6 (tiers + DEBUG bounds + prod
 * fail-closed), §7 (per-event byte caps + queue depth/overflow). Pure
 * instrumentation: a CVDIAG failure must NEVER throw into the boundary it
 * observes (spec §7 R5-F8) — except the constructor's fail-closed DEBUG guard,
 * which is a startup assertion (spec §6).
 */

import crypto from "node:crypto";

import {
  SCHEMA_VERSION,
  validateEnvelope,
  validateMetadata,
} from "./schema.js";
import type {
  CvdiagBoundary,
  CvdiagDataPlaneBoundary,
  CvdiagEnvelope,
  CvdiagLayer,
  CvdiagOutcome,
  EdgeHeaders,
} from "./schema.js";

/** Resolved verbosity tier (cumulative). */
export type CvdiagTier = "default" | "verbose" | "debug";

/**
 * Per-boundary tier inclusion (spec §6 tier matrix). `true` = the boundary is
 * emitted at that tier. Accounting (`cvdiag.*`) boundaries are ALWAYS emitted
 * regardless of tier and are NOT listed here.
 */
const TIER_MATRIX: Record<
  CvdiagDataPlaneBoundary,
  { default: boolean; verbose: boolean; debug: boolean }
> = {
  "probe.start": { default: false, verbose: true, debug: true },
  "probe.navigate.complete": { default: false, verbose: true, debug: true },
  "probe.message.send": { default: true, verbose: true, debug: true },
  "probe.dom.container.mount": { default: true, verbose: true, debug: true },
  "probe.dom.firsttoken": { default: true, verbose: true, debug: true },
  "probe.dom.alternate_content": { default: true, verbose: true, debug: true },
  "probe.sse.event": { default: false, verbose: true, debug: true },
  "probe.sse.aborted": { default: true, verbose: true, debug: true },
  "probe.network.error": { default: true, verbose: true, debug: true },
  "probe.network.response": { default: true, verbose: true, debug: true },
  "probe.console.error": { default: true, verbose: true, debug: true },
  "probe.exit": { default: true, verbose: true, debug: true },
  "backend.request.ingress": { default: false, verbose: true, debug: true },
  "backend.agent.enter": { default: true, verbose: true, debug: true },
  "backend.llm.call.start": { default: false, verbose: true, debug: true },
  "backend.llm.call.heartbeat": { default: false, verbose: true, debug: true },
  "backend.llm.call.response": { default: false, verbose: true, debug: true },
  "backend.sse.first_byte": { default: false, verbose: true, debug: true },
  "backend.sse.event": { default: false, verbose: false, debug: true },
  "backend.sse.aborted": { default: true, verbose: true, debug: true },
  "backend.agent.exit": { default: true, verbose: true, debug: true },
  "backend.response.complete": { default: true, verbose: true, debug: true },
  "backend.error.caught": { default: true, verbose: true, debug: true },
  "aimock.request.ingress": { default: false, verbose: true, debug: true },
  "aimock.match.decision": { default: false, verbose: true, debug: true },
  "aimock.response.start": { default: false, verbose: true, debug: true },
  "aimock.sse.chunk": { default: false, verbose: false, debug: true },
  "aimock.response.aborted": { default: true, verbose: true, debug: true },
  "aimock.response.complete": { default: true, verbose: true, debug: true },
};

/** Accounting (`cvdiag.*`) boundaries are emitted at every tier. */
const ACCOUNTING_PREFIX = "cvdiag.";

/** Per-event byte caps by tier (spec §7 R5-F3). */
export const BYTE_CAP_BY_TIER: Record<CvdiagTier, number> = {
  default: 2 * 1024,
  verbose: 4 * 1024,
  debug: 16 * 1024,
};

/** In-memory queue cap (spec §7 R5-F5). */
export const QUEUE_CAP = 5000;
/** DEBUG hard bounds (spec §6 R5-F7/R6-F10). */
export const DEBUG_MAX_WALLCLOCK_MS = 10 * 60 * 1000;
export const DEBUG_MAX_EVENTS = 10_000;
/** Background flush window (spec §7 R5-F12). The real PB write is L0-B. */
export const FLUSH_WINDOW_MS = 1000;

/**
 * The PB-writer seam. L0-B implements `pb-writer.ts`; this module imports only
 * the SHAPE so the emitter compiles standalone and the integration is a single
 * injected dependency. There is NO PB client implemented in L0-A.
 */
export interface CvdiagPbWriter {
  /** Best-effort CREATE of a batch of envelopes. Resolves; never rejects. */
  writeBatch(events: CvdiagEnvelope[]): Promise<void>;
}

/** Env bag the emitter reads for tier resolution (injectable for tests). */
export type CvdiagEnv = Record<string, string | undefined>;

export interface CvdiagEmitterOptions {
  /** Force DEBUG tier (subject to the fail-closed prod guard). */
  debug?: boolean;
  /** Force VERBOSE tier (DEBUG wins if both set). */
  verbose?: boolean;
  /** Environment bag; defaults to `process.env`. */
  env?: CvdiagEnv;
  /** Injected PB writer seam (L0-B). When absent, events stay queued. */
  pbWriter?: CvdiagPbWriter;
  /** Owning layer for default envelope fields. */
  layer?: CvdiagLayer;
  /** Start the background flush timer (default false; opt-in for tests). */
  autoFlush?: boolean;
}

export interface CvdiagEmitArgs {
  layer: CvdiagLayer;
  boundary: CvdiagBoundary;
  slug: string;
  demo: string;
  outcome: CvdiagOutcome;
  /** Optional pre-filtered edge headers; defaults to all-null. */
  edgeHeaders?: EdgeHeaders;
  /** Raw per-boundary metadata (validated + closed-world filtered on emit). */
  metadata?: Record<string, unknown>;
  durationMs?: number | null;
  parentSpanId?: string | null;
  /** Override test_id (e.g. probe.start mints one and threads it through). */
  testId?: string;
}

/**
 * Resolve the deployment-environment label (spec §6 production detection):
 *   SHOWCASE_ENV → RAILWAY_ENVIRONMENT_NAME → NODE_ENV.
 * Returns the lowercase label or `null` if none resolves.
 */
export function resolveEnvLabel(env: CvdiagEnv): string | null {
  const raw = env.SHOWCASE_ENV ?? env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV;
  if (raw === undefined || raw === null || raw === "") return null;
  return String(raw).toLowerCase();
}

/** All-null edge headers (the default when none are captured). */
function emptyEdgeHeaders(): EdgeHeaders {
  return {
    "cf-ray": null,
    "cf-mitigated": null,
    "cf-cache-status": null,
    "x-railway-edge": null,
    "x-railway-request-id": null,
    "x-hikari-trace": null,
    "retry-after": null,
    via: null,
    server: null,
  };
}

/**
 * Mint a UUIDv7 (time-ordered, lowercase hyphenated) per RFC 9562: 48-bit
 * Unix-ms timestamp, version nibble 7, variant bits 10. Node's `randomUUID`
 * only emits v4, so we build v7 from random bytes + the wall clock.
 */
export function mintTestId(nowMs: number = Date.now()): string {
  const bytes = crypto.randomBytes(16);
  // 48-bit big-endian timestamp in bytes 0..5.
  const ts = BigInt(nowMs);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  // Version 7 in the high nibble of byte 6.
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variant 10 in the high bits of byte 8.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}

/** Mint a 16-hex span id (8 random bytes). */
export function mintSpanId(): string {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * `CvdiagEmitter` — the shared TS emitter. Resolves tier (fail-closed on
 * DEBUG+prod), filters by the §6 tier matrix, caps per-event bytes, buffers in
 * a bounded queue (drop-oldest with a `cvdiag.queue_dropped` accounting
 * event), and flushes to the injected PB writer seam on a background window.
 */
export class CvdiagEmitter {
  readonly tier: CvdiagTier;
  private readonly env: CvdiagEnv;
  private readonly pbWriter: CvdiagPbWriter | undefined;
  private readonly defaultLayer: CvdiagLayer;
  private readonly queue: CvdiagEnvelope[] = [];
  private droppedSinceFlush = 0;
  private debugDeadlineMs = 0;
  private debugEventCount = 0;
  private debugDisarmed = false;
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: CvdiagEmitterOptions = {}) {
    this.env = options.env ?? (process.env as CvdiagEnv);
    this.pbWriter = options.pbWriter;
    this.defaultLayer = options.layer ?? "probe";

    const wantsDebug = options.debug === true || this.env.CVDIAG_DEBUG === "1";
    const wantsVerbose =
      options.verbose === true || this.env.CVDIAG_VERBOSE === "1";

    if (wantsDebug) {
      this.assertDebugAllowed();
      this.tier = "debug";
      this.debugDeadlineMs = Date.now() + DEBUG_MAX_WALLCLOCK_MS;
    } else if (wantsVerbose) {
      this.tier = "verbose";
    } else {
      this.tier = "default";
    }

    if (options.autoFlush) {
      this.startBackgroundFlush();
    }
  }

  /**
   * DEBUG startup assertions (spec §6 hard bounds). Throws (fail-closed) when:
   *   - the resolved env label is `production`, OR
   *   - no env label resolves at all (treat unknown as production), OR
   *   - no `CVDIAG_DEBUG_ALLOW_LIST` slug list is provided.
   * This is the ONE place the emitter is permitted to throw — it is a startup
   * guard, not a hot-path side effect.
   */
  private assertDebugAllowed(): void {
    const label = resolveEnvLabel(this.env);
    if (label === null) {
      throw new Error(
        "CVDIAG_DEBUG refused: deployment environment is unresolved " +
          "(SHOWCASE_ENV → RAILWAY_ENVIRONMENT_NAME → NODE_ENV all unset); " +
          "fail-closed treats unknown env as production.",
      );
    }
    if (label === "production") {
      throw new Error(
        "CVDIAG_DEBUG refused: deployment environment is production.",
      );
    }
    const allowList = this.env.CVDIAG_DEBUG_ALLOW_LIST;
    if (allowList === undefined || allowList.trim() === "") {
      throw new Error(
        "CVDIAG_DEBUG refused: CVDIAG_DEBUG_ALLOW_LIST is required " +
          "(comma-separated slug list) before DEBUG may start.",
      );
    }
    if (this.env.CVDIAG_DEBUG_FIELDS === "1" && label === "production") {
      throw new Error(
        "CVDIAG_DEBUG_FIELDS=1 is incompatible with a production-promote.",
      );
    }
  }

  /** True iff the boundary is included at the current tier. */
  shouldEmit(boundary: CvdiagBoundary): boolean {
    if (boundary.startsWith(ACCOUNTING_PREFIX)) {
      // Accounting events are always emitted regardless of tier.
      return true;
    }
    if (this.tier === "debug" && this.isDebugExpired()) {
      // DEBUG auto-disarmed: fall back to default-tier inclusion.
      const row = TIER_MATRIX[boundary as CvdiagDataPlaneBoundary];
      return row !== undefined && row.default;
    }
    const row = TIER_MATRIX[boundary as CvdiagDataPlaneBoundary];
    if (row === undefined) return false;
    return row[this.tier];
  }

  /** Whether DEBUG has exceeded its 10min / 10k-event bounds. */
  private isDebugExpired(): boolean {
    if (this.debugDisarmed) return true;
    if (
      Date.now() >= this.debugDeadlineMs ||
      this.debugEventCount >= DEBUG_MAX_EVENTS
    ) {
      this.debugDisarmed = true;
      return true;
    }
    return false;
  }

  /**
   * Emit one event. Pure instrumentation: catches all errors and degrades to a
   * single `CVDIAG`-tagged `console.warn`, never throwing into the caller.
   * Returns the queued envelope (or null when filtered out / on failure).
   */
  emit(args: CvdiagEmitArgs): CvdiagEnvelope | null {
    try {
      if (!this.shouldEmit(args.boundary)) return null;

      if (this.tier === "debug") this.debugEventCount += 1;

      const testId = args.testId ?? mintTestId();
      const isDataPlane = !args.boundary.startsWith(ACCOUNTING_PREFIX);
      let metadata: Record<string, unknown> = {};
      let metadataDropped = false;
      if (isDataPlane) {
        const v = validateMetadata(
          args.layer,
          args.boundary as CvdiagDataPlaneBoundary,
          args.metadata ?? {},
        );
        metadata = v.metadata;
        metadataDropped = v.metadataDropped;
      } else {
        // Accounting events ride their payload in the envelope's metadata bag
        // verbatim (no closed-world entry); they are trusted internal records.
        metadata = args.metadata ?? {};
      }

      const envelope: CvdiagEnvelope = {
        schema_version: SCHEMA_VERSION,
        test_id: testId,
        trace_id: testId,
        span_id: mintSpanId(),
        parent_span_id: args.parentSpanId ?? null,
        layer: args.layer,
        boundary: args.boundary,
        slug: args.slug,
        demo: args.demo,
        ts: new Date().toISOString(),
        mono_ns: this.monoNs(),
        duration_ms: args.durationMs ?? null,
        outcome: args.outcome,
        edge_headers: args.edgeHeaders ?? emptyEdgeHeaders(),
        metadata,
      };
      if (metadataDropped) envelope._metadata_dropped = true;

      // Defense in depth: the envelope we build is closed-world by
      // construction, but assert it before enqueue so a future bug surfaces.
      const check = validateEnvelope(
        envelope as unknown as Record<string, unknown>,
      );
      if (!check.ok) {
        console.warn(
          `CVDIAG emit dropped: unknown envelope keys ${check.unknownKeys.join(",")} ` +
            `boundary=${args.boundary}`,
        );
        return null;
      }

      this.applyByteCap(envelope);
      this.enqueue(envelope);
      return envelope;
    } catch (err) {
      console.warn(
        `CVDIAG emit failed boundary=${args.boundary} error=${String(err)}`,
      );
      return null;
    }
  }

  /** Monotonic ns within this process (spec §5 `mono_ns`). */
  private monoNs(): number {
    // performance.now() is ms with sub-ms precision; ns granularity via *1e6.
    return Math.round(performance.now() * 1e6);
  }

  /**
   * Bound the whole serialized envelope to the tier byte cap and stamp
   * `_truncated: true` whenever any trimming occurs (spec §7 R5-F3). The
   * `metadata` bag holds the only unbounded-shape values, so it is the trim
   * target; the envelope's fixed scalar fields (ids/ts/boundary/flags/etc.) are
   * bounded by construction. Escalation, cheapest-effective first:
   *   1. Clamp >64-char string values + replace nested objects with a marker.
   *   2. If STILL over cap (e.g. many short-string / numeric / boolean values
   *      that step 1 cannot shrink), clamp ALL string values progressively to a
   *      short length.
   *   3. If STILL over cap, drop the metadata bag to `{}` entirely — the fixed
   *      fields fit any realistic cap, so this is the hard guarantee that the
   *      enqueued row never exceeds the cap.
   * Pure instrumentation: this method must NEVER throw.
   */
  private applyByteCap(envelope: CvdiagEnvelope): void {
    const cap = BYTE_CAP_BY_TIER[this.tier];
    if (this.serializedSize(envelope) <= cap) return;
    // Trimming is happening: stamp truncated so the over-budget row is
    // observable as a bounded row in PB queries.
    envelope._truncated = true;
    const meta = envelope.metadata;

    // Step 1: the legacy pass — clamp >64-char strings, replace nested objects.
    for (const key of Object.keys(meta)) {
      if (this.serializedSize(envelope) <= cap) return;
      const value = meta[key];
      if (typeof value === "string" && value.length > 64) {
        meta[key] = `${value.slice(0, 61)}...`;
      } else if (typeof value === "object" && value !== null) {
        meta[key] = "[truncated]";
      }
    }

    // Step 2: still over cap (scalar/short-string-heavy bag) — clamp ALL string
    // values progressively to a short length, shortest meaningful first.
    for (const key of Object.keys(meta)) {
      if (this.serializedSize(envelope) <= cap) return;
      const value = meta[key];
      if (typeof value === "string" && value.length > 8) {
        meta[key] = `${value.slice(0, 5)}...`;
      }
    }

    // Step 3: still over cap (numeric/boolean/key-count-heavy bag) — drop the
    // whole metadata bag. The fixed scalar fields are bounded by construction,
    // so an empty metadata bag guarantees the enqueued row fits the cap.
    if (this.serializedSize(envelope) > cap) {
      envelope.metadata = {};
      envelope._metadata_dropped = true;
    }

    // Post-condition: either we are at or under cap, or metadata is already {}
    // (so we never silently enqueue over-budget with trimmable content left).
  }

  private serializedSize(envelope: CvdiagEnvelope): number {
    try {
      return Buffer.byteLength(JSON.stringify(envelope), "utf8");
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  }

  /**
   * Enqueue with drop-oldest overflow (spec §7 R5-F5). On eviction, increments
   * a counter surfaced as a `cvdiag.queue_dropped` accounting event on the
   * next flush.
   */
  private enqueue(envelope: CvdiagEnvelope): void {
    this.queue.push(envelope);
    while (this.queue.length > QUEUE_CAP) {
      this.queue.shift();
      this.droppedSinceFlush += 1;
    }
  }

  /** Start the background flush timer (≤1s window). */
  startBackgroundFlush(): void {
    if (this.flushTimer !== undefined) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_WINDOW_MS);
    // Do not keep the event loop alive solely for CVDIAG flushing.
    if (typeof this.flushTimer.unref === "function") this.flushTimer.unref();
  }

  /** Stop the background flush timer (idempotent). */
  stopBackgroundFlush(): void {
    if (this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  /**
   * Drain the queue to the PB writer seam (best-effort). If a drop occurred
   * since the last flush, prepend a `cvdiag.queue_dropped` accounting event
   * carrying `_dropped_count`. Resolves; never rejects.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0 && this.droppedSinceFlush === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    if (this.droppedSinceFlush > 0) {
      const dropped = this.droppedSinceFlush;
      this.droppedSinceFlush = 0;
      const accounting = this.emit({
        layer: this.defaultLayer,
        boundary: "cvdiag.queue_dropped",
        slug: "cvdiag",
        demo: "cvdiag",
        outcome: "info",
        metadata: { _dropped_count: dropped },
      });
      if (accounting) batch.push(...this.queue.splice(0, this.queue.length));
    }
    if (this.pbWriter === undefined || batch.length === 0) return;
    try {
      await this.pbWriter.writeBatch(batch);
    } catch (err) {
      console.warn(
        `CVDIAG flush failed count=${batch.length} error=${String(err)}`,
      );
    }
  }

  /** Test/inspection helper: current queue depth. */
  queueDepth(): number {
    return this.queue.length;
  }
}
