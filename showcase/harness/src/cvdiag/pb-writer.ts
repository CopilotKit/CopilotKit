/**
 * pb-writer.ts — DURABLE, CREATE-only persistence for CVDIAG
 * flap-observability events into the `cvdiag_events` PocketBase collection
 * (and DEBUG-tier raw-byte samples into `cvdiag_raw_byte_samples`).
 *
 * WHY a dedicated writer (and not diag-sink.ts): the flap-observability
 * pipeline (showcase/harness/src/cvdiag, flap-observability spec §4/§5)
 * persists a richer 15-field envelope under a STRICTER three-key ACL than
 * the older anonymously-readable `diag_events` trail. This writer wraps the
 * existing harness `PbClient` (storage/pb-client.ts) and writes ONLY via the
 * writer key's CREATE-only surface — it never UPDATEs or DELETEs, so a
 * stolen writer key cannot rewrite or wipe history (purge/migration are
 * separate ops-held keys).
 *
 * BEST-EFFORT GUARANTEE (mirrors diag-sink.ts): every write is pure
 * instrumentation and MUST NEVER throw into the boundary it observes. A
 * missing migration, a PB hiccup, an ACL rejection, or any network error is
 * SWALLOWED and surfaced as a single `CVDIAG`-tagged `console.warn` so the
 * drop is greppable from the same anchor as the events it failed to persist.
 * The probe is NEVER blocked or marked degraded by a CVDIAG write failure
 * (spec §7 R5-F8: CVDIAG failures must never produce a false-red row).
 */

import type { Logger } from "../types/index.js";
import type { PbClient, ListOpts, ListResult } from "../storage/pb-client.js";
import type { CvdiagEnvelope } from "./schema.js";

/** Collection names — mirror the PB migrations (1779990200 / 1779990201). */
export const CVDIAG_EVENTS_COLLECTION = "cvdiag_events";
export const CVDIAG_RAW_BYTE_SAMPLES_COLLECTION = "cvdiag_raw_byte_samples";

/**
 * Minimal PB surface this writer needs — a structural subset of the harness
 * `PbClient` so the real client satisfies it and tests can pass a tiny fake.
 * CREATE-only by design: the writer key's ACL forbids update/delete, so this
 * writer intentionally exposes neither.
 */
export interface CvdiagPbWriterClient {
  create<T>(collection: string, record: Record<string, unknown>): Promise<T>;
  /**
   * Used ONLY by {@link CvdiagPbWriter.assertCollectionExists} to confirm the
   * `cvdiag_events` collection is present + the writer key is accepted. The
   * writer key is CREATE-only (list/view rules are null), so this list is
   * EXPECTED to be rejected (401/403) when the collection exists — that
   * rejection still proves the collection is present and the key authenticated.
   * A 404 means the collection (and its migration) is absent.
   */
  list<T>(collection: string, opts?: ListOpts): Promise<ListResult<T>>;
  health(): Promise<boolean>;
}

/** The real `PbClient` already satisfies `CvdiagPbWriterClient`. */
export type CvdiagWriterClient = Pick<PbClient, "create" | "list" | "health">;

/**
 * The closed 9-key edge-header capture shape.
 *
 * TODO(L0-A integration): import `EdgeHeaders` from `./schema.js` once the
 * schema module lands; this local seam keeps L0-B buildable in isolation.
 */
export interface CvdiagEdgeHeaders {
  "cf-ray": string | null;
  "cf-mitigated": string | null;
  "cf-cache-status": string | null;
  "x-railway-edge": string | null;
  "x-railway-request-id": string | null;
  "x-hikari-trace": string | null;
  "retry-after": string | null;
  via: string | null;
  server: string | null;
}

/**
 * One persisted CVDIAG event. Field names match the `cvdiag_events` PB
 * schema 1:1 so the record is written through verbatim.
 *
 * TODO(L0-A integration): import `CvdiagEnvelope` from `./schema.js` once it
 * lands and replace this local seam.
 */
export interface CvdiagEventRecord {
  schema_version: number;
  test_id: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  layer: string;
  boundary: string;
  slug: string;
  demo: string;
  ts: string;
  mono_ns: number;
  duration_ms: number | null;
  outcome: string;
  edge_headers: CvdiagEdgeHeaders;
  metadata: Record<string, unknown>;
}

/** One DEBUG-tier raw-byte sample row (cvdiag_raw_byte_samples schema 1:1). */
export interface CvdiagRawByteSampleRecord {
  test_id: string;
  slug: string;
  ts: string;
  pipeline_applied: string[];
  head_bytes: string;
  tail_bytes: string;
  elided_count: number;
  metadata_dropped: boolean;
}

/** Inputs for a `cvdiag.purge_audit` accounting event (spec §4 / §5). */
export interface CvdiagPurgeAudit {
  operator_id: string;
  target_predicate: string;
  row_count_events: number;
  row_count_raw_bytes: number;
}

/** Inputs for a `cvdiag.collision_detected` accounting event (spec §4). */
export interface CvdiagCollision {
  test_id: string;
  layer: string;
  boundary: string;
  mono_ns: number;
}

export interface CvdiagPbWriterOptions {
  pb: CvdiagWriterClient;
  logger: Logger;
  /**
   * Max events buffered before overflow eviction (spec §7 R5-F5: 5000).
   * On overflow the oldest are dropped and a `cvdiag.queue_dropped`
   * accounting event is emitted on the next successful write.
   */
  queueCap?: number;
}

const DEFAULT_QUEUE_CAP = 5000;

/**
 * Map a `CvdiagEnvelope` (emit.ts/schema.ts) to a `cvdiag_events` row
 * (`CvdiagEventRecord`). The two shapes share the same 15 persisted fields —
 * the envelope's field TYPES are a narrowing of the record's (enum `layer`/
 * `boundary`/`outcome` vs the record's free-text columns; the closed 9-key
 * `EdgeHeaders` vs `CvdiagEdgeHeaders`), so each value is assignable directly.
 *
 * The envelope's two OPTIONAL diagnostic flags — `_metadata_dropped` (PII
 * closed-world signal) and `_truncated` (byte-cap trim signal) — are NOT
 * `cvdiag_events` columns, so PB would silently drop them on create. To keep
 * them queryable we fold each (when set) into the `metadata` JSON bag under its
 * own `_metadata_dropped` / `_truncated` key, leaving the rest of the bag
 * verbatim. A fresh `metadata` object is built so the caller's envelope is
 * never mutated (pure instrumentation has no caller-visible side effects).
 */
function toEventRecord(envelope: CvdiagEnvelope): CvdiagEventRecord {
  const metadata: Record<string, unknown> = { ...envelope.metadata };
  if (envelope._metadata_dropped) metadata._metadata_dropped = true;
  if (envelope._truncated) metadata._truncated = true;
  return {
    schema_version: envelope.schema_version,
    test_id: envelope.test_id,
    trace_id: envelope.trace_id,
    span_id: envelope.span_id,
    parent_span_id: envelope.parent_span_id,
    layer: envelope.layer,
    boundary: envelope.boundary,
    slug: envelope.slug,
    demo: envelope.demo,
    ts: envelope.ts,
    mono_ns: envelope.mono_ns,
    duration_ms: envelope.duration_ms,
    outcome: envelope.outcome,
    edge_headers: { ...envelope.edge_headers },
    metadata,
  };
}

/** Build a fully-null edge-header set for accounting events that carry none. */
function emptyEdgeHeaders(): CvdiagEdgeHeaders {
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

export class CvdiagPbWriter {
  private readonly pb: CvdiagWriterClient;
  private readonly logger: Logger;
  private readonly queueCap: number;
  // Running count of events evicted by queue overflow since the last
  // `cvdiag.queue_dropped` accounting flush. Surfaced on the next write.
  private droppedSinceFlush = 0;
  // Approximate in-flight queue depth — incremented on enqueue, decremented
  // on settle. Used only to detect overflow; the actual transport is the
  // PbClient's own request pipeline.
  private inFlight = 0;

  constructor(opts: CvdiagPbWriterOptions) {
    this.pb = opts.pb;
    this.logger = opts.logger;
    this.queueCap = opts.queueCap ?? DEFAULT_QUEUE_CAP;
  }

  /**
   * Startup check: confirm the writer can reach PB AND that the
   * `cvdiag_events` collection actually exists + the writer key is accepted.
   * Best-effort — returns false (never throws) so a missing migration
   * degrades to stdout/Railway-logs fallback rather than crashing the harness
   * (and rather than silently dropping 100% of events because a bare health()
   * said "PB is up" while the collection was never migrated).
   *
   * Verification: a minimal authenticated list against `cvdiag_events`
   * (perPage=1). The writer key is CREATE-only — list/view rules are null —
   * so PB REJECTS this read with 401/403 WHEN THE COLLECTION EXISTS. That
   * rejection is the proof we want: it means the collection is present and
   * the writer key authenticated. A 404 means the collection (its migration)
   * is absent → degrade. PB returns these statuses (verified against PB
   * 0.22.21): existing-but-unreadable → 403, missing → 404. Any transport
   * error also degrades (never throws). See pb-client.create/list for the
   * status carried in the thrown Error message.
   */
  async assertCollectionExists(): Promise<boolean> {
    try {
      const healthy = await this.pb.health();
      if (!healthy) {
        this.warn("assert-collection", "pb unhealthy", "—");
        return false;
      }
    } catch (err) {
      this.warn("assert-collection", String(err), "—");
      return false;
    }
    // Probe the collection. A successful list (e.g. via a superuser-backed
    // client) proves existence directly; the writer key's CREATE-only ACL
    // will instead surface a 401/403 rejection, which ALSO proves the
    // collection exists. Only a 404 (collection absent) → false.
    try {
      await this.pb.list(CVDIAG_EVENTS_COLLECTION, { perPage: 1 });
      return true;
    } catch (err) {
      const msg = String(err);
      // 401/403 → key authenticated but the CREATE-only ACL forbids read:
      // the collection EXISTS. This is the expected writer-key path.
      if (/\b(401|403)\b/.test(msg)) return true;
      // 404 → the collection (and its migration) is absent → degrade.
      // Any other error (network/5xx) is also treated as "cannot confirm"
      // → degrade rather than silently drop every event.
      this.warn("assert-collection", msg, "—");
      return false;
    }
  }

  /**
   * Persist one CVDIAG event row, CREATE-only, best-effort. Resolves whether
   * the write succeeded or was swallowed; NEVER rejects.
   */
  async writeEvent(record: CvdiagEventRecord): Promise<void> {
    // Overflow guard: if we're already past the queue cap, evict (drop) this
    // event and account for it. The probe is never blocked.
    if (this.inFlight >= this.queueCap) {
      this.droppedSinceFlush += 1;
      return;
    }
    this.inFlight += 1;
    try {
      await this.pb.create(CVDIAG_EVENTS_COLLECTION, { ...record });
      // A successful write is our chance to flush any pending drop count as
      // a `cvdiag.queue_dropped` accounting event (spec §5).
      await this.flushDropAccounting(record);
    } catch (err) {
      this.warn(record.boundary, String(err), record.test_id);
    } finally {
      this.inFlight -= 1;
    }
  }

  /**
   * Persist a BATCH of CVDIAG envelopes, CREATE-only, best-effort. This is the
   * emit→persist seam the `CvdiagEmitter.flush()` background drain calls
   * (emit.ts `CvdiagPbWriter` interface): the emitter buffers `CvdiagEnvelope`s
   * in its bounded queue and hands a batch here on each flush window. Each
   * envelope is mapped to the `cvdiag_events` row shape ({@link toEventRecord})
   * and CREATEd through the same overflow-guarded {@link writeEvent} path, so
   * the in-flight/queue-overflow accounting machinery is LIVE for batch writes
   * too (a per-event failure degrades to a `CVDIAG`-tagged warn; the batch is
   * never aborted on one bad row).
   *
   * Best-effort contract (mirrors {@link writeEvent}): resolves whether every,
   * some, or no rows persisted; NEVER rejects into the emitter's flush (which
   * itself swallows + warns). A single envelope's persistence failure is
   * isolated to that envelope.
   */
  async writeBatch(events: CvdiagEnvelope[]): Promise<void> {
    for (const envelope of events) {
      // `writeEvent` is itself never-throw (best-effort + finally), but guard
      // the whole iteration so a malformed envelope at the mapping step can
      // never abort the rest of the batch.
      try {
        await this.writeEvent(toEventRecord(envelope));
      } catch (err) {
        this.warn(envelope.boundary, String(err), envelope.test_id);
      }
    }
  }

  /** Persist one DEBUG-tier raw-byte sample row, best-effort. */
  async writeRawByteSample(record: CvdiagRawByteSampleRecord): Promise<void> {
    try {
      await this.pb.create(CVDIAG_RAW_BYTE_SAMPLES_COLLECTION, { ...record });
    } catch (err) {
      this.warn("raw-byte-sample", String(err), record.test_id);
    }
  }

  /**
   * Emit a `cvdiag.purge_audit` accounting event recording an on-demand
   * purge (spec §4). Written into cvdiag_events with boundary set to the
   * accounting literal; envelope-level only (no typed metadata closed-world
   * entry — the payload rides in `metadata`).
   */
  async writePurgeAudit(audit: CvdiagPurgeAudit): Promise<void> {
    await this.writeAccounting("cvdiag.purge_audit", "info", {
      operator_id: audit.operator_id,
      target_predicate: audit.target_predicate,
      row_count_events: audit.row_count_events,
      row_count_raw_bytes: audit.row_count_raw_bytes,
    });
  }

  /**
   * Emit a `cvdiag.collision_detected` accounting event when a second writer
   * observes a duplicate `(test_id, layer, boundary, mono_ns)` tuple (spec
   * §4 test-id collision policy). The colliding tuple is recorded; no merge,
   * no overwrite.
   */
  async writeCollisionDetected(collision: CvdiagCollision): Promise<void> {
    await this.writeAccounting(
      "cvdiag.collision_detected",
      "info",
      {
        colliding_test_id: collision.test_id,
        colliding_layer: collision.layer,
        colliding_boundary: collision.boundary,
        colliding_mono_ns: collision.mono_ns,
      },
      collision.test_id,
      // Record the collision's REAL emitting layer (probe/aimock/backend), not
      // the writeAccounting default of "backend" — otherwise every collision
      // row mis-buckets as backend, hiding probe/aimock collisions.
      collision.layer,
    );
  }

  /**
   * Flush any pending queue-overflow drop count as a `cvdiag.queue_dropped`
   * accounting event. Called opportunistically after a successful write so
   * we don't add a second failure-prone write on the hot path.
   */
  private async flushDropAccounting(context: CvdiagEventRecord): Promise<void> {
    if (this.droppedSinceFlush <= 0) return;
    const dropped = this.droppedSinceFlush;
    this.droppedSinceFlush = 0;
    await this.writeAccounting(
      "cvdiag.queue_dropped",
      "info",
      { _dropped_count: dropped },
      context.test_id,
      context.layer,
    );
  }

  /**
   * Shared accounting-event writer. Accounting events ride in `cvdiag_events`
   * with a `cvdiag.*` boundary literal and envelope-level fields only; their
   * payload lives in `metadata`. Best-effort — a failed accounting write is
   * itself swallowed (we do NOT recurse into more accounting on failure).
   */
  private async writeAccounting(
    boundary: string,
    outcome: string,
    metadata: Record<string, unknown>,
    testId = "00000000-0000-7000-8000-000000000000",
    layer = "backend",
  ): Promise<void> {
    const now = new Date().toISOString();
    const record: CvdiagEventRecord = {
      schema_version: 1,
      test_id: testId,
      trace_id: testId,
      span_id: "0".repeat(16),
      parent_span_id: null,
      layer,
      boundary,
      slug: "cvdiag",
      demo: "cvdiag",
      ts: now,
      mono_ns: 0,
      duration_ms: null,
      outcome,
      edge_headers: emptyEdgeHeaders(),
      metadata,
    };
    try {
      await this.pb.create(CVDIAG_EVENTS_COLLECTION, { ...record });
    } catch (err) {
      this.warn(boundary, String(err), testId);
    }
  }

  /**
   * Single CVDIAG-tagged warn for any swallowed write failure. Tagged so the
   * drop shows up in the same grep as the events it failed to persist;
   * redact nothing beyond what the record already carries.
   */
  private warn(boundary: string, error: string, testId: string): void {
    this.logger.warn("cvdiag.pb-writer.write-failed", {
      boundary,
      test_id: testId,
      error,
    });
    console.warn(
      `CVDIAG pb-writer write failed test_id=${testId} ` +
        `boundary=${boundary} error=${error}`,
    );
  }
}
