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

import { EDGE_HEADER_MAX_LEN } from "./edge-headers.js";
import {
  EDGE_HEADER_KEYS,
  SCHEMA_VERSION,
  isValidTestId,
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

/** Hard entry cap for the free-text `demo` field (spec §3.1). */
export const DEMO_MAX_LEN = 256;
/** Substituted slug when sanitization yields an empty string (spec §3.1). */
export const SLUG_FALLBACK = "unknown";
/** Slug must match the PB/codegen contract `^[a-z][a-z0-9-]{0,63}$`. */
const SLUG_MAX_LEN = 64;
/** 16-hex lowercase span-id shape (spec §5 `span_id` / `parent_span_id`). */
const SPAN_ID_REGEX = /^[0-9a-f]{16}$/;
/**
 * Max length (chars) of a sanitized free-text cross-layer join key adopted from
 * an inbound `x-test-id` header. The probe's per-run id (`d4-<slug>-<runId>` /
 * `d6-<slug>-<runId>`) is well under this; the cap defends against an
 * unbounded/hostile header value while keeping the key usable as a PB filter.
 */
const JOIN_TEST_ID_MAX_LEN = 128;

/**
 * Sanitize an inbound, non-UUIDv7 `x-test-id` into a SAFE, DETERMINISTIC
 * free-text cross-layer join key (spec §5 `test_id`). The transform is pure and
 * deterministic so the probe and the backend, applying it to the SAME inbound
 * header, derive the SAME join key:
 *   1. lowercase + trim surrounding whitespace,
 *   2. drop EVERYTHING except `[a-z0-9._-]` (strips whitespace, control chars,
 *      NUL, and any injection-prone punctuation — the key is used verbatim in a
 *      PB filter string),
 *   3. cap to `JOIN_TEST_ID_MAX_LEN`.
 * Returns `null` when nothing survives (→ caller mints a fresh UUIDv7). A value
 * that is ALREADY a valid UUIDv7 is handled by the caller before this is
 * reached, so this only ever runs on genuinely non-UUIDv7 inputs.
 */
export function sanitizeJoinTestId(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, JOIN_TEST_ID_MAX_LEN);
  return cleaned.length > 0 ? cleaned : null;
}

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
  /**
   * Override the envelope `test_id` — the CROSS-LAYER JOIN KEY (spec §5: the
   * single id that joins one run's rows across probe / backend / aimock). Two
   * shapes are honored:
   *   - a valid UUIDv7 (e.g. probe.start mints one and threads it through), OR
   *   - a probe-minted per-run id forwarded as the inbound `x-test-id` header
   *     (e.g. `d4-<slug>-<runId>` — NOT a UUIDv7). The backend MUST adopt this
   *     verbatim (sanitized to a safe free-text key) so its rows JOIN the
   *     probe's rows. PB stores `test_id` as free text, so a non-UUIDv7 join
   *     key is valid at the storage layer — the cross-layer correlation is the
   *     whole point.
   * An absent / empty / unsanitizable value falls back to a freshly minted
   * UUIDv7.
   */
  testId?: string;
  /**
   * Override the envelope `trace_id` — the emitter's OWN PER-REQUEST id
   * (spec §5: trace/span are per-request, test_id is the shared run id). The
   * backend mints a fresh UUIDv7 per request and passes it here so `trace_id`
   * stays decoupled from an ADOPTED cross-layer `test_id`. When omitted,
   * `trace_id` mirrors `test_id` (the historical probe-path invariant). Honored
   * only when it is a valid UUIDv7 or 16-hex span id; otherwise it falls back
   * to mirroring `test_id`.
   */
  traceId?: string;
}

/**
 * Resolve the deployment-environment label (spec §6 production detection):
 *   SHOWCASE_ENV → RAILWAY_ENVIRONMENT_NAME → NODE_ENV.
 * The raw value is TRIMMED then lowercased before comparison, so a
 * whitespace-padded source (`"production\n"`, `" production "` — common from
 * env files / CI exports) resolves to its canonical label rather than slipping
 * past an exact-match gate. Returns the trimmed lowercase label, or `null` when
 * no source resolves OR the resolved value is whitespace-only (treated as
 * unresolved → the §6 fail-closed gate maps unresolved to production).
 */
export function resolveEnvLabel(env: CvdiagEnv): string | null {
  const raw = env.SHOWCASE_ENV ?? env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV;
  if (raw === undefined || raw === null) return null;
  const label = String(raw).trim().toLowerCase();
  return label === "" ? null : label;
}

/**
 * Explicit allow-list of known NON-production env labels on which DEBUG tier may
 * legitimately run (spec §6 "fail-closed treats UNKNOWN env as production"). The
 * gate is a SAFE-ENV allow-list — not a production deny-list — so any label NOT
 * in this set (a prod alias like `prod`/`live`, a prod-prefixed env like
 * `production-us`, a typo, or `null`/unresolved) fails closed and refuses DEBUG.
 * This covers the showcase's real non-prod environments: `staging` (Railway
 * staging) and `development`/`test` (local + CI, via NODE_ENV). DEBUG arms
 * raw-byte response-body capture, so an unrecognized label MUST be refused.
 */
const DEBUG_SAFE_ENV_LABELS: ReadonlySet<string> = new Set([
  "development",
  "dev",
  "test",
  "staging",
  "local",
  "ci",
  "preview",
]);

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
 * Bound caller-supplied `edge_headers` values at emit entry (spec §3.1 / §1.6).
 * `filterEdgeHeaders` clamps each value to `EDGE_HEADER_MAX_LEN` at its natural
 * capture point, but a caller may hand `buildEnvelope` a pre-built `edgeHeaders`
 * object directly — that path bypasses `filterEdgeHeaders`, so we re-apply the
 * same per-value clamp here. This keeps the envelope SKELETON a genuine constant
 * (every value `null` or ≤256 chars), which is the pre-condition the §3.3
 * byte-cap relies on: without it a large upstream `via:`/`server:` value would
 * push the skeleton over cap while the ladder (which clamps only `metadata` +
 * `demo`) never touches `edge_headers`. Returns a FRESH object — never mutates
 * the caller's. Pure instrumentation: never throws.
 */
function boundEdgeHeaders(headers: EdgeHeaders): EdgeHeaders {
  const bounded = {} as EdgeHeaders;
  for (const key of EDGE_HEADER_KEYS) {
    const value = headers[key];
    if (typeof value !== "string" || value.length <= EDGE_HEADER_MAX_LEN) {
      bounded[key] = value ?? null;
    } else {
      // Reserve one char for the `…` marker so the result is ≤ EDGE_HEADER_MAX_LEN.
      bounded[key] = `${value.slice(0, EDGE_HEADER_MAX_LEN - 1)}…`;
    }
  }
  return bounded;
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
  const byteMask = BigInt(0xff);
  bytes[0] = Number((ts >> BigInt(40)) & byteMask);
  bytes[1] = Number((ts >> BigInt(32)) & byteMask);
  bytes[2] = Number((ts >> BigInt(24)) & byteMask);
  bytes[3] = Number((ts >> BigInt(16)) & byteMask);
  bytes[4] = Number((ts >> BigInt(8)) & byteMask);
  bytes[5] = Number(ts & byteMask);
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

export interface BoundEntryFields {
  slug: string;
  demo: string;
  parentSpanId: string | null;
  /**
   * The cross-layer join key to honor, or undefined to mint a fresh UUIDv7.
   * Either a valid UUIDv7 (passed through unchanged) OR a sanitized non-UUIDv7
   * inbound `x-test-id` adopted verbatim so backend rows JOIN the probe's.
   */
  testId: string | undefined;
  /**
   * The emitter's OWN per-request id (a valid UUIDv7 or 16-hex span id) to use
   * as `trace_id`, or undefined to mirror `test_id` (historical probe-path
   * invariant). Decouples `trace_id` from an ADOPTED non-UUIDv7 `test_id`.
   */
  traceId: string | undefined;
  /** True iff any field was sanitized/bounded (diagnostic; does NOT set _truncated). */
  boundedAny: boolean;
}

/**
 * Validate/bound caller-supplied fields at the EMIT ENTRY (spec §3.1, P1). Pure
 * instrumentation: NEVER throws and NEVER rejects the event — a degraded row is
 * more useful than no row. After this, every format-constrained envelope field
 * is already valid and length-bounded, so `applyByteCap` (§3.3) never needs to
 * touch a constrained field.
 *
 * The slug/parent_span_id/test_id patterns are PB/codegen contracts that TS and
 * `validateEnvelope` do NOT runtime-validate — this function ESTABLISHES them at
 * the TS boundary. The slug result ALWAYS matches `^[a-z][a-z0-9-]{0,63}$`.
 *
 * `boundedAny` is a diagnostic only: it is intentionally NOT wired to the
 * envelope's `_truncated` flag (entry-bounding is input sanitization, not a
 * size-trim; `_truncated` remains the byte-cap's flag per spec §3.1).
 */
export function boundEntryFields(args: CvdiagEmitArgs): BoundEntryFields {
  let boundedAny = false;

  // slug → lowercase, strip illegal chars, ensure leading [a-z], ≤64, fallback.
  const rawSlug =
    typeof args.slug === "string" ? args.slug : String(args.slug ?? "");
  let slug = rawSlug.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (slug.length > 0 && !/^[a-z]/.test(slug)) slug = `x${slug}`;
  if (slug.length > SLUG_MAX_LEN) slug = slug.slice(0, SLUG_MAX_LEN);
  if (slug.length === 0) slug = SLUG_FALLBACK;
  if (slug !== rawSlug) boundedAny = true;

  // demo → coerce to string, hard-cap at DEMO_MAX_LEN with a trailing marker.
  const rawDemo =
    typeof args.demo === "string" ? args.demo : String(args.demo ?? "");
  let demo = rawDemo;
  if (demo.length > DEMO_MAX_LEN) {
    demo = `${demo.slice(0, DEMO_MAX_LEN - 1)}…`;
    boundedAny = true;
  }

  // parent_span_id → 16-hex lowercase or null (a malformed ref falsifies joins).
  let parentSpanId: string | null = args.parentSpanId ?? null;
  if (parentSpanId !== null && !SPAN_ID_REGEX.test(parentSpanId)) {
    parentSpanId = null;
    boundedAny = true;
  }

  // testId override → the CROSS-LAYER JOIN KEY (spec §5). Honor a valid UUIDv7
  // verbatim. For a non-UUIDv7 inbound id (the probe's `d4-/d6-<slug>-<runId>`
  // forwarded as `x-test-id`), ADOPT it via the deterministic sanitizer so the
  // backend's rows join the probe's — PB stores `test_id` as free text, so a
  // non-UUIDv7 join key is valid at storage. Only an absent / empty /
  // fully-stripped value falls through to a freshly minted UUIDv7.
  let testId: string | undefined = args.testId;
  if (testId !== undefined && !isValidTestId(testId)) {
    const adopted = sanitizeJoinTestId(testId);
    if (adopted === null || adopted !== testId) boundedAny = true;
    testId = adopted ?? undefined;
  }

  // traceId override → the emitter's OWN per-request id. Honor a valid UUIDv7
  // or 16-hex span id; anything else falls through to mirroring `test_id`.
  let traceId: string | undefined = args.traceId;
  if (
    traceId !== undefined &&
    !isValidTestId(traceId) &&
    !SPAN_ID_REGEX.test(traceId)
  ) {
    traceId = undefined;
    boundedAny = true;
  }

  return { slug, demo, parentSpanId, testId, traceId, boundedAny };
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
   * DEBUG startup assertions (spec §6 hard bounds). Fail-closed via a SAFE-ENV
   * ALLOW-LIST: DEBUG is permitted ONLY when the (trimmed, lowercased) resolved
   * env label is in `DEBUG_SAFE_ENV_LABELS`. Throws (fail-closed) when:
   *   - no env label resolves at all (treat unknown as production), OR
   *   - the resolved label is NOT a known-non-prod label — this catches
   *     `production`, whitespace-padded prod (`"production\n"` → trimmed), prod
   *     aliases (`prod`, `live`), prod-prefixed envs (`production-us`), and any
   *     unrecognized label — all fail closed, OR
   *   - no `CVDIAG_DEBUG_ALLOW_LIST` slug list is provided.
   * The allow-list (not a prod deny-list) implements the spec's "unknown env →
   * production" intent and avoids the incompleteness of enumerating prod aliases.
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
    if (!DEBUG_SAFE_ENV_LABELS.has(label)) {
      throw new Error(
        `CVDIAG_DEBUG refused: deployment environment "${label}" is not a ` +
          "known-non-prod env (fail-closed treats any unrecognized or " +
          "production-like label as production).",
      );
    }
    const allowList = this.env.CVDIAG_DEBUG_ALLOW_LIST;
    if (allowList === undefined || allowList.trim() === "") {
      throw new Error(
        "CVDIAG_DEBUG refused: CVDIAG_DEBUG_ALLOW_LIST is required " +
          "(comma-separated slug list) before DEBUG may start.",
      );
    }
    // NOTE: the former `CVDIAG_DEBUG_FIELDS === "1" && label === "production"`
    // guard is removed — it relied on the exact-"production" match that the
    // safe-env allow-list above now supersedes (a `production` label, or any
    // prod-like/unrecognized label, already failed closed before reaching here),
    // so it was dead and is NOT the sole protection for the prod path.
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

      const envelope = this.buildEnvelope(args);
      if (envelope === null) return null;

      this.enqueue(envelope);
      return envelope;
    } catch (err) {
      console.warn(
        `CVDIAG emit failed boundary=${args.boundary} error=${String(err)}`,
      );
      return null;
    }
  }

  /**
   * Construct a well-formed, byte-capped envelope from emit args. Shared by
   * `emit()` (which enqueues the result) and `flush()` (which appends the
   * `cvdiag.queue_dropped` accounting envelope directly to the outgoing
   * batch). Returns null when the envelope fails the closed-world key check.
   * Does NOT enqueue. Callers are responsible for the tier filter
   * (`shouldEmit`) and for catching; this method may throw on a construction
   * bug and the caller's try/catch degrades it to a console.warn.
   */
  private buildEnvelope(args: CvdiagEmitArgs): CvdiagEnvelope | null {
    if (this.tier === "debug") this.debugEventCount += 1;

    // P1 (spec §3.1): bound caller-supplied fields at emit entry BEFORE the
    // envelope literal so every format-constrained field is already valid and
    // length-bounded. An invalid testId override is dropped here so the minted
    // fallback keeps `trace_id` (its mirror) valid.
    const bound = boundEntryFields(args);
    const testId = bound.testId ?? mintTestId();
    // `trace_id` is the emitter's OWN per-request id. It MIRRORS `test_id` by
    // default (probe path: one run = one test_id = one trace_id), but the
    // backend supplies a distinct per-request UUIDv7 via `traceId` so it stays
    // decoupled from an ADOPTED cross-layer `test_id` (spec §5).
    const traceId = bound.traceId ?? testId;
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
      // Shallow-clone so `applyByteCap`'s in-place trims (and a Step-3 drop)
      // never mutate the caller's object — pure instrumentation must not have
      // caller-visible side effects. (Data-plane events already get a fresh
      // `survivor` object from `validateMetadata`.)
      metadata = { ...args.metadata };
    }

    const envelope: CvdiagEnvelope = {
      schema_version: SCHEMA_VERSION,
      test_id: testId,
      trace_id: traceId,
      span_id: mintSpanId(),
      parent_span_id: bound.parentSpanId,
      layer: args.layer,
      boundary: args.boundary,
      slug: bound.slug,
      demo: bound.demo,
      ts: new Date().toISOString(),
      mono_ns: this.monoNs(),
      duration_ms: args.durationMs ?? null,
      outcome: args.outcome,
      edge_headers:
        args.edgeHeaders !== undefined
          ? boundEdgeHeaders(args.edgeHeaders)
          : emptyEdgeHeaders(),
      metadata,
    };
    if (metadataDropped) envelope._metadata_dropped = true;

    // Defense in depth: the envelope we build is closed-world by
    // construction, but assert it before use so a future bug surfaces.
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
    return envelope;
  }

  /** Monotonic ns within this process (spec §5 `mono_ns`). */
  private monoNs(): number {
    // performance.now() is ms with sub-ms precision; ns granularity via *1e6.
    return Math.round(performance.now() * 1e6);
  }

  /**
   * Bound the whole serialized envelope to the tier byte cap and stamp
   * `_truncated: true` whenever trimming ACTUALLY occurs (a field is modified),
   * per the §7 R5-F3 flag semantics.
   *
   * REDESIGNED (spec §3.3 / P4 — kills R5-A3 structurally): this ladder clamps
   * ONLY the three genuinely-unbounded inputs — the `metadata` bag, the
   * free-text `demo` string, and the free-string `edge_headers` VALUES — and
   * NEVER touches a format-constrained field. It cannot produce a non-16-hex
   * `span_id`/`parent_span_id`, alter the `test_id`/`trace_id` join keys (they
   * are minted/adopted/entry-bound, never clamped), or write a `slug` that
   * violates the PB/codegen contract
   * `^[a-z][a-z0-9-]{0,63}$`, because those fields are NOT in the clamp set at
   * all. They are bounded by construction:
   *   - `slug`     — entry-bounded to ≤64 pattern-valid chars (`boundEntryFields`)
   *   - `demo`     — entry-bounded to ≤`DEMO_MAX_LEN` (then the only clampable field)
   *   - `parent_span_id` — entry-bounded to 16-hex or `null`
   *   - `test_id` — minted UUIDv7 OR an adopted/sanitized inbound join key
   *     (≤128 chars); `trace_id` — minted UUIDv7 or a mirror of `test_id`
   *   - `span_id`  — minted 16-hex
   *   - `schema_version` (const int), `layer`/`boundary`/`outcome` (enums),
   *     `ts` (ISO-8601), `mono_ns`/`duration_ms` (numbers)
   *   - `edge_headers` — 9-key shape ALWAYS preserved; each value is `null`, a
   *     ≤`EDGE_HEADER_MAX_LEN`-char entry-bound (`filterEdgeHeaders` at capture /
   *     `boundEdgeHeaders` for a caller-supplied object), OR (when the ladder's
   *     Step 5 fires) a byte-clamped short prefix / `""`. The VALUES are free
   *     strings (`string | null`, no schema pattern), so clamping them is
   *     schema-valid — only the closed 9-KEY SHAPE is format-constrained, and
   *     that is never altered.
   * The skeleton MINUS the edge-header values is a bounded constant (slug/ids/
   * enums/numbers/ts) of a few hundred bytes. The entry-bound on edge-header
   * values is a CHAR cap applied PER-VALUE, so 9 populated keys can sum past a
   * tier cap (worst case 9×256 multi-byte chars ≈ 7 KB) — Step 5 is the
   * guarantee that the BYTE post-condition holds for any header encoding.
   *
   * Escalation, cheapest-effective first; re-check size after each, early-return
   * when `<= cap`:
   *   1. Clamp >64-char metadata strings + replace nested objects with a marker.
   *   2. If STILL over cap (many short-string / numeric values step 1 cannot
   *      shrink), clamp ALL metadata string values progressively to a short
   *      length.
   *   3. If STILL over cap (numeric/boolean/key-count-heavy bag), drop the
   *      metadata bag to `{}` entirely.
   *   4. If STILL over cap, clamp ONLY `demo` (it has no schema pattern, so a
   *      truncated `demo` is still valid) progressively to a floor.
   *   5. If STILL over cap (9 near-bound or multi-byte edge-header values),
   *      byte-clamp the `edge_headers` VALUES (free strings) longest-first to a
   *      shrinking byte budget, flooring to `""` (the 9-key shape is kept).
   *
   * `bigint` (or other non-JSON-serializable) metadata leaf: `serializedSize`
   * returns `Number.MAX_SAFE_INTEGER` (treated as over-cap), which DRIVES the
   * ladder forward to Step 3's metadata drop — after which `JSON.stringify`
   * succeeds and the post-condition holds. No separate code path, no throw.
   *
   * Post-condition (by construction): on return, `serializedSize(envelope) <=
   * cap` AND every field is schema-valid. The skeleton is a bounded constant, so
   * dropping `metadata` to `{}` + clamping `demo` to its floor always fits any
   * tier cap (smallest is 2 KB).
   * Pure instrumentation: this method must NEVER throw.
   */
  private applyByteCap(envelope: CvdiagEnvelope): void {
    const cap = BYTE_CAP_BY_TIER[this.tier];
    if (this.serializedSize(envelope) <= cap) return;
    // Track whether any field was actually modified, so `_truncated` reflects
    // real trimming (its documented meaning) rather than mere over-cap
    // detection. A detection that finds nothing trimmable until Step 4 still
    // ends with Step 4 trimming → the flag is set then.
    let trimmed = false;
    const meta = envelope.metadata;

    // Step 1: the legacy pass — clamp >64-char strings, replace nested objects.
    for (const key of Object.keys(meta)) {
      if (this.serializedSize(envelope) <= cap) {
        if (trimmed) envelope._truncated = true;
        return;
      }
      const value = meta[key];
      if (typeof value === "string" && value.length > 64) {
        meta[key] = `${value.slice(0, 61)}...`;
        trimmed = true;
      } else if (typeof value === "object" && value !== null) {
        meta[key] = "[truncated]";
        trimmed = true;
      }
    }

    // Step 2: still over cap (scalar/short-string-heavy bag) — clamp ALL string
    // values progressively to a short length, shortest meaningful first.
    for (const key of Object.keys(meta)) {
      if (this.serializedSize(envelope) <= cap) {
        if (trimmed) envelope._truncated = true;
        return;
      }
      const value = meta[key];
      if (typeof value === "string" && value.length > 8) {
        meta[key] = `${value.slice(0, 5)}...`;
        trimmed = true;
      }
    }

    // Step 3: still over cap (numeric/boolean/key-count-heavy bag) — drop the
    // whole metadata bag. Do NOT set `_metadata_dropped` — that flag is the §6
    // PII closed-world signal (set in `buildEnvelope` when `validateMetadata`
    // dropped unknown keys), and overloading it here would pollute PB drift
    // queries that key on `_metadata_dropped`.
    if (this.serializedSize(envelope) > cap && Object.keys(meta).length > 0) {
      envelope.metadata = {};
      trimmed = true;
    }

    // Step 4: still over cap — the only remaining clampable field is the
    // free-text `demo` (no schema pattern, so a truncated `demo` is still
    // valid). NEVER touch slug/trace_id/test_id/span_id/parent_span_id — those
    // are bounded by construction (boundEntryFields + minting), so the ladder
    // can drive `demo` to its floor and the constrained skeleton always fits.
    for (const budget of [64, 16, 4, 0]) {
      if (this.serializedSize(envelope) <= cap) break;
      const value = envelope.demo;
      if (typeof value !== "string") break;
      if (value.length <= budget) continue;
      envelope.demo =
        budget === 0 ? "[clamped]" : `${value.slice(0, budget)}…[clamped]`;
      trimmed = true;
    }

    // Step 5: still over cap — byte-clamp the `edge_headers` VALUES. The
    // entry-bound (`EDGE_HEADER_MAX_LEN` in `boundEdgeHeaders`/
    // `filterEdgeHeaders`) is a CHAR cap applied PER-VALUE, so 9 populated keys
    // can sum past a tier cap (worst case 9 × 256 multi-byte chars ≈ 7 KB), and
    // multi-byte content can push even an all-ASCII-bounded set over the 2 KB
    // default. The values are free strings (`string | null`, NO schema pattern),
    // so byte-clamping them is schema-valid — this does NOT structurally
    // invalidate a format-constrained field (those — slug/ids/enums — are never
    // in the clamp set). Clamp by BYTE length, longest-first, to a shrinking
    // budget; the final floor (budget 0) drops each value to `""` (the closed
    // 9-key shape is kept — values become `""`, never a missing key / `null`).
    // This makes the post-condition hold for ANY edge_headers content/encoding
    // regardless of `EDGE_HEADER_MAX_LEN`.
    const edge = envelope.edge_headers;
    for (const budget of [128, 32, 8, 0]) {
      if (this.serializedSize(envelope) <= cap) break;
      // Longest-first (by byte length) so the biggest contributors shrink first.
      const keys = EDGE_HEADER_KEYS.filter(
        (key) => typeof edge[key] === "string",
      ).sort(
        (a, b) =>
          Buffer.byteLength(edge[b] as string, "utf8") -
          Buffer.byteLength(edge[a] as string, "utf8"),
      );
      for (const key of keys) {
        if (this.serializedSize(envelope) <= cap) break;
        const value = edge[key] as string;
        if (Buffer.byteLength(value, "utf8") <= budget) continue;
        edge[key] = budget === 0 ? "" : this.byteClamp(value, budget);
        trimmed = true;
      }
    }

    if (trimmed) envelope._truncated = true;

    // Post-condition: serializedSize(envelope) <= cap AND every field is
    // schema-valid. The only unbounded inputs (metadata + demo + edge_headers
    // values) are all clamped above; every other field is entry-bounded
    // (slug/parent_span_id), minted (ids), or an enum/number — a bounded
    // constant. Dropping metadata to `{}`, demo to its floor, AND edge-header
    // values to `""` leaves only the constrained skeleton, which fits any
    // realistic tier cap (smallest is 2 KB).
  }

  /**
   * Truncate `value` to at most `maxBytes` UTF-8 bytes without splitting a
   * multi-byte code unit. Iterates code points (so surrogate pairs / multi-byte
   * chars are kept whole) and stops before the budget would be exceeded. Pure;
   * never throws. Used by `applyByteCap` Step 5 to clamp free-string
   * edge-header values by BYTE length (the post-condition is byte-based).
   */
  private byteClamp(value: string, maxBytes: number): string {
    if (maxBytes <= 0) return "";
    if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
    let out = "";
    let used = 0;
    for (const ch of value) {
      const next = Buffer.byteLength(ch, "utf8");
      if (used + next > maxBytes) break;
      out += ch;
      used += next;
    }
    return out;
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
   * since the last flush, append a `cvdiag.queue_dropped` accounting event
   * carrying `_dropped_count` directly to the outgoing batch (built through
   * the same envelope-construction + validate + byte-cap path as `emit()`,
   * but NOT round-tripped through the queue). Event order within a batch is
   * not load-bearing — the classifier re-sorts by `mono_ns`/`ts` — so append
   * is fine. Crucially, `droppedSinceFlush` is reset to 0 ONLY after the
   * accounting envelope is in the batch, so a construction failure (null
   * return / throw) retains the count for the next flush rather than losing
   * it. Resolves; never rejects.
   */
  async flush(): Promise<void> {
    // No PB writer → flush is a no-op that LEAVES THE QUEUE INTACT (and does
    // NOT touch `droppedSinceFlush`). This honors the documented `pbWriter`
    // contract ("When absent, events stay queued"); draining + discarding here
    // would silently lose all queued telemetry every flush window, which under
    // `{ autoFlush: true }` with no writer is continuous data loss.
    if (this.pbWriter === undefined) return;
    if (this.queue.length === 0 && this.droppedSinceFlush === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    if (this.droppedSinceFlush > 0) {
      try {
        const accounting = this.buildEnvelope({
          layer: this.defaultLayer,
          boundary: "cvdiag.queue_dropped",
          slug: "cvdiag",
          demo: "cvdiag",
          outcome: "info",
          metadata: { _dropped_count: this.droppedSinceFlush },
        });
        if (accounting !== null) {
          batch.push(accounting);
          // Clear the count ONLY now that the accounting record has landed in
          // the batch; otherwise a failed build would silently lose it.
          this.droppedSinceFlush = 0;
        }
      } catch (err) {
        // Build threw — keep the count for the next flush; never reject.
        console.warn(
          `CVDIAG queue_dropped accounting build failed error=${String(err)}`,
        );
      }
    }
    // A writer is guaranteed present here (the no-writer case returned at the
    // top); only an empty batch short-circuits now.
    if (batch.length === 0) return;
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
