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
import { PbHttpError } from "../storage/pb-client.js";
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
   * CVDIAG collections are present + the writer key is accepted. The writer key
   * is CREATE-only (list/view rules are null), so this list is EXPECTED to be
   * rejected with 403 when the collection exists — that authenticated-but-
   * forbidden rejection still proves the collection is present. A 404 means the
   * collection (and its migration) is absent; a 401 means authentication FAILED
   * (bad/missing key) and is NOT proof the collection exists.
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
}

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

  constructor(opts: CvdiagPbWriterOptions) {
    this.pb = opts.pb;
    this.logger = opts.logger;
  }

  /**
   * Startup check: confirm the writer can reach PB AND that BOTH CVDIAG
   * collections (`cvdiag_events` AND the DEBUG-tier `cvdiag_raw_byte_samples`)
   * actually exist + the writer key authenticated. Best-effort — returns false
   * (never throws) so a missing/partial migration degrades to stdout/Railway-
   * logs fallback rather than crashing the harness (and rather than silently
   * dropping 100% of events because a bare health() said "PB is up" while a
   * collection was never migrated).
   *
   * Verification: a minimal authenticated list against EACH collection
   * (perPage=1). The writer key is CREATE-only — list/view rules are null — so
   * PB REJECTS this read with 403 WHEN THE COLLECTION EXISTS but the key may
   * not read it. That 403 rejection is itself proof of presence: the key
   * authenticated and the collection is there. The status→verdict mapping
   * (verified against PB 0.22.21):
   *   - 200/success → true   (collection present + readable)
   *   - 403         → true   (authed, but CREATE-only ACL forbids read = present)
   *   - 404         → false  (collection / its migration absent → degrade)
   *   - 401         → false  (AUTH FAILED — bad/missing writer key. 401 means
   *                           the request was NOT authenticated, NOT that the
   *                           collection exists. Treating it as "exists" would
   *                           inject a writer that then 401-drops EVERY event —
   *                           the exact 100%-silent-drop failure this gate
   *                           exists to prevent. So 401 → degrade.)
   *   - other/5xx/transport → false (cannot confirm → degrade, don't drop)
   *
   * BOTH collections must clear the gate: a partial migration (events present,
   * raw-byte-samples absent) otherwise passes here and then `writeRawByteSample`
   * 404-spams on every DEBUG-tier sample. Never throws (every branch returns).
   * pb-client.list throws a typed `PbHttpError` (carrying `statusCode`) on any
   * non-ok response; this method branches on that status, not on the rendered
   * message string.
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
    // Gate BOTH collections the writer touches. A partial migration (one
    // present, one missing) must NOT be read as healthy.
    return (
      (await this.probeCollection(CVDIAG_EVENTS_COLLECTION)) &&
      (await this.probeCollection(CVDIAG_RAW_BYTE_SAMPLES_COLLECTION))
    );
  }

  /**
   * Probe a single collection for presence + writer-key acceptance. Returns
   * true iff the collection is confirmed present (a successful list, or a 403
   * that proves an authenticated-but-read-forbidden CREATE-only key). Any
   * other outcome — 404 (absent), 401 (auth failed; NOT proof of existence),
   * 5xx, or a transport fault — degrades to false. Never throws.
   */
  private async probeCollection(collection: string): Promise<boolean> {
    try {
      await this.pb.list(collection, { perPage: 1 });
      return true;
    } catch (err) {
      // Branch on the TYPED HTTP status carried by the rejection
      // (`PbHttpError.statusCode`) rather than substring-matching the rendered
      // message — a body that merely CONTAINS "401" must not be misread as
      // "exists". pb-client.list throws PbHttpError on any non-ok response.
      if (err instanceof PbHttpError) {
        // 403 → key authenticated but the CREATE-only ACL forbids read: the
        // collection EXISTS. This is the expected writer-key path.
        if (err.statusCode === 403) return true;
        // 401 → AUTHENTICATION FAILED (bad/missing key). This does NOT prove
        // the collection exists; reading it as "healthy" would inject a writer
        // that 401-drops every event. Degrade.
        // 404 → collection (and its migration) is absent → degrade.
        // Any other HTTP status (5xx etc.) is "cannot confirm" → degrade
        // rather than silently drop every event.
        this.warn("assert-collection", String(err), "—");
        return false;
      }
      // Non-HTTP failure (transport/DNS/abort) → cannot confirm → degrade.
      this.warn("assert-collection", String(err), "—");
      return false;
    }
  }

  /**
   * Persist one CVDIAG event row, CREATE-only, best-effort. Resolves whether
   * the write succeeded or was swallowed; NEVER rejects.
   *
   * The bounded-queue / drop-oldest / `cvdiag.queue_dropped` accounting lives
   * in the emitter (emit.ts `CvdiagEmitter`), which owns the real backpressure
   * queue and hands settled batches here via {@link writeBatch}. This writer is
   * the leaf transport — one CREATE per event — so it carries no queue of its
   * own.
   */
  async writeEvent(record: CvdiagEventRecord): Promise<void> {
    try {
      await this.pb.create(CVDIAG_EVENTS_COLLECTION, { ...record });
    } catch (err) {
      this.warn(record.boundary, String(err), record.test_id);
    }
  }

  /**
   * Persist a BATCH of CVDIAG envelopes, CREATE-only, best-effort. This is the
   * emit→persist seam the `CvdiagEmitter.flush()` background drain calls
   * (emit.ts `CvdiagPbWriter` interface): the emitter buffers `CvdiagEnvelope`s
   * in its bounded queue and hands a settled batch here on each flush window.
   * Each envelope is mapped to the `cvdiag_events` row shape
   * ({@link toEventRecord}) and CREATEd through {@link writeEvent} (a per-event
   * failure degrades to a `CVDIAG`-tagged warn; the batch is never aborted on
   * one bad row).
   *
   * Best-effort contract (mirrors {@link writeEvent}): resolves whether every,
   * some, or no rows persisted; NEVER rejects into the emitter's flush (which
   * itself swallows + warns). A single envelope's persistence failure is
   * isolated to that envelope.
   */
  async writeBatch(events: CvdiagEnvelope[]): Promise<void> {
    for (const envelope of events) {
      // `writeEvent` is itself never-throw, but `toEventRecord` mapping CAN
      // throw on a malformed envelope — guard the iteration so one bad row
      // can never abort persistence of the rest of the batch.
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
