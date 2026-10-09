/**
 * schema.ts — CANONICAL CVDIAG flap-observability schema (single source of
 * truth). All language emitters (Python `_shared`, .NET, Java, TS) codegen
 * their per-boundary types from the JSON Schema derived from THIS file via
 * `bin/showcase cvdiag codegen`. If you change a boundary, a metadata field,
 * or the envelope here, you MUST regenerate `schema.json` and the per-language
 * bindings or CI lint fails on drift.
 *
 * Spec: 2026-06-18-flap-observability.md §5 (schema) + §6 (tiers/PII). Plan
 * unit: L0-A.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SCHEMA-EVOLUTION POLICY (spec §5 envelope `schema_version`, Q5/MQ1):
 *   - ADDITIVE-MINOR (new boundary literal, new optional metadata field) =
 *     COMPATIBLE. Consumers tolerate unknown-but-additive shapes; the
 *     `schema_version` int does NOT bump for additive changes within v1.
 *   - FIELD-RENAME or TYPE-CHANGE = MAJOR. Producers MUST bump
 *     `SCHEMA_VERSION` and tag every emitted row with the new value. Phase-7
 *     reviews evolution. (R3-F1)
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PII_POLICY (spec §6, inline per R7-Q5):
 *   - CLOSED-WORLD allow-list at EMIT time (not ingestion): any envelope key
 *     not declared here, and any per-boundary `metadata` key not declared in
 *     the per-boundary interfaces below, is DROPPED before the row is written.
 *     Dropping a metadata key stamps `_metadata_dropped: true` on the survivor
 *     so the drift is observable in PB queries.
 *   - EDGE HEADERS: only the 9 keys in `EdgeHeaders` are ever captured; the
 *     12-name DENY list in `edge-headers.ts` is rejected even if a key
 *     accidentally appears in the allow-list (exact-match deny wins). NO
 *     `cf-ip*` wildcard inclusion — the `cf-ip*` family is blocked by exact
 *     deny-list entries, never matched by a prefix wildcard.
 *   - SECRET SCRUB: `Bearer\s+\S+`, `sk-[A-Za-z0-9]{16,}`, and URL-userinfo
 *     (`scheme://user:pass@` AND bare-token `scheme://token@`) are scrubbed
 *     from EVERY surviving string metadata value by `validateMetadata` (below)
 *     before it leaves this module — see `scrub.ts` for the regex constants.
 *   - NO request/response bodies in default or verbose tier. DEBUG-tier
 *     raw-byte capture (spec §11.4) is a separate, time-bounded, redacted
 *     pipeline owned by a later slot — never by this module.
 */

import { scrubDeep, scrubSecrets } from "./scrub";

/** Current schema version. Bumps only on a breaking (rename/type) change. */
export const SCHEMA_VERSION = 1 as const;

/**
 * Layer that emitted the event. CLOSED enum (spec §5 envelope `layer`, R3-F2).
 * `aimock` is a VALID value for forward-compat with the aimock fast-follow
 * (separate repo) even though no in-repo emitter writes `layer=aimock` rows
 * yet — keeping it here means the fast-follow needs no schema bump.
 */
export const CVDIAG_LAYERS = ["probe", "backend", "aimock"] as const;
export type CvdiagLayer = (typeof CVDIAG_LAYERS)[number];

/** Terminal outcome of a boundary (spec §5 envelope `outcome`, R3-F9). */
export const CVDIAG_OUTCOMES = ["ok", "err", "timeout", "info"] as const;
export type CvdiagOutcome = (typeof CVDIAG_OUTCOMES)[number];

/**
 * 12 probe-layer (Layer 1) data-plane boundaries (spec §3 + §5/§6).
 */
export const PROBE_BOUNDARIES = [
  "probe.start",
  "probe.navigate.complete",
  "probe.message.send",
  "probe.dom.container.mount",
  "probe.dom.firsttoken",
  "probe.dom.alternate_content",
  "probe.sse.event",
  "probe.sse.aborted",
  "probe.network.error",
  "probe.network.response",
  "probe.console.error",
  "probe.exit",
] as const;

/**
 * 11 backend-layer (Layer 2) data-plane boundaries (spec §3 + §5/§6).
 */
export const BACKEND_BOUNDARIES = [
  "backend.request.ingress",
  "backend.agent.enter",
  "backend.llm.call.start",
  "backend.llm.call.heartbeat",
  "backend.llm.call.response",
  "backend.sse.first_byte",
  "backend.sse.event",
  "backend.sse.aborted",
  "backend.agent.exit",
  "backend.response.complete",
  "backend.error.caught",
] as const;

/**
 * 6 aimock-layer (Layer 3) data-plane boundaries (spec §3 + §5/§6). These STAY
 * in the closed enum even though no in-repo emitter writes them — the aimock
 * fast-follow (separate repo) needs the schema to already enumerate them.
 */
export const AIMOCK_BOUNDARIES = [
  "aimock.request.ingress",
  "aimock.match.decision",
  "aimock.response.start",
  "aimock.sse.chunk",
  "aimock.response.aborted",
  "aimock.response.complete",
] as const;

/**
 * The 29 DATA-PLANE boundaries (12 probe + 11 backend + 6 aimock). These carry
 * typed per-boundary `metadata` and are the "29 named boundaries" the envelope
 * `boundary` field and the §6 tier matrix refer to (spec §5 "Two namespaces").
 */
export const CVDIAG_DATA_PLANE_BOUNDARIES = [
  ...PROBE_BOUNDARIES,
  ...BACKEND_BOUNDARIES,
  ...AIMOCK_BOUNDARIES,
] as const;
export type CvdiagDataPlaneBoundary =
  (typeof CVDIAG_DATA_PLANE_BOUNDARIES)[number];

/**
 * 4 `cvdiag.*` ACCOUNTING events (operationally distinct, NOT counted in "the
 * 29"). They describe the telemetry pipeline's own behavior, carry
 * envelope-level fields only (no typed per-boundary `metadata` closed-world
 * entry), and are ALWAYS emitted regardless of tier. They ARE part of the
 * closed `boundary` enum so CI lint still rejects unknown literals. (spec §5
 * "Two namespaces"). Any new accounting event MUST be added here AND to the
 * boundary enum; it does NOT change the data-plane 29-count.
 */
export const CVDIAG_ACCOUNTING_BOUNDARIES = [
  "cvdiag.purge_audit",
  "cvdiag.collision_detected",
  "cvdiag.queue_dropped",
  "cvdiag.metadata_dropped",
] as const;
export type CvdiagAccountingBoundary =
  (typeof CVDIAG_ACCOUNTING_BOUNDARIES)[number];

/**
 * The FULL closed `boundary` enum: 29 data-plane + 4 accounting = 33 literals.
 * Mirrored to TS union, Pydantic enum, .NET enum, Java enum, Go const set. CI
 * lint fails on an unknown literal. (spec §5 envelope `boundary`, R3-F2)
 */
export const CVDIAG_BOUNDARIES = [
  ...CVDIAG_DATA_PLANE_BOUNDARIES,
  ...CVDIAG_ACCOUNTING_BOUNDARIES,
] as const;
export type CvdiagBoundary = (typeof CVDIAG_BOUNDARIES)[number];

/**
 * Closed edge-header key set (spec §5 `edge_headers` shape). All 9 keys are
 * ALWAYS present on a written row; an absent header is `null`, a
 * present-but-empty header is `""`. (R3-F3)
 */
export interface EdgeHeaders {
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

/** The 9 allow-listed edge-header keys, in canonical envelope order. */
export const EDGE_HEADER_KEYS = [
  "cf-ray",
  "cf-mitigated",
  "cf-cache-status",
  "x-railway-edge",
  "x-railway-request-id",
  "x-hikari-trace",
  "retry-after",
  "via",
  "server",
] as const;
export type EdgeHeaderKey = (typeof EDGE_HEADER_KEYS)[number];

/**
 * Common termination kinds for abnormal stream aborts (spec §3
 * `probe.sse.aborted` / `backend.sse.aborted` / `aimock.response.aborted`).
 */
export const TERMINATION_KINDS = [
  "fin_clean",
  "fin_premature",
  "rst",
  "chunk_error",
  "timeout",
] as const;
export type TerminationKind = (typeof TERMINATION_KINDS)[number];

// ── Per-boundary metadata interfaces (typed; spec §5 metadata tables) ───────
//
// `sequence_num` SEMANTICS (spec §5 R3-F16): per-(test_id, layer,
// boundary-family), starting at 0. Cross-layer comparison of sequence numbers
// (e.g. probe.sse.event[seq=N] joined with backend.sse.event[seq=N]) is the
// discriminator for dropped/reordered events. Each `*.sse.event` /
// `*.sse.chunk` boundary therefore carries its own monotonic `sequence_num`.

// Layer 1 (probe) ───────────────────────────────────────────────────────────

export interface ProbeStartMeta {
  url: string;
  viewport: { width: number; height: number };
}
export interface ProbeNavigateCompleteMeta {
  /** ≤256B */
  url: string;
  /** ms, ≥0 */
  nav_ms: number | null;
  /** HTTP status */
  http_status: number | null;
}
export interface ProbeMessageSendMeta {
  /** ≥0 */
  message_index: number;
  /** chars, ≥0 */
  char_count: number;
  demo: string;
}
export interface ProbeDomContainerMountMeta {
  /** ms, ≥0 */
  delta_ms_from_start: number;
}
export interface ProbeDomFirsttokenMeta {
  /** ms, ≥0 */
  delta_ms_from_start: number;
  /** chars, ≥0 */
  text_length: number;
}
export interface ProbeDomAlternateContentMeta {
  child_type_histogram: Record<string, number>;
}
export interface ProbeSseEventMeta {
  event_type: string;
  payload_size_bytes: number;
  sequence_num: number;
}
export interface ProbeSseAbortedMeta {
  termination_kind: TerminationKind;
  bytes_before_abort: number;
}
export interface ProbeNetworkErrorMeta {
  url: string;
  error_class: string;
  response_status: number | null;
}
export interface ProbeNetworkResponseMeta {
  url: string;
  /** HTTP status */
  status: number;
  content_length: number | null;
  duration_ms: number;
}
export interface ProbeConsoleErrorMeta {
  level: "warning" | "error";
  /** ≤512B */
  message_scrubbed: string;
  source_file: string | null;
  line_col: string | null;
}
/**
 * Why a probe run failed, mirroring `waitForTurnComplete`'s reject `reason`
 * union (conversation-runner `TurnNotCompleteError.reason`) plus
 * `selector-mismatch` (a readiness/selector failure the d6 pill flow surfaces).
 * Stamped on `probe.exit` ONLY when `terminal_outcome` is non-`ok` so reds are
 * labeled directly in cvdiag probe data instead of being inferred from the
 * absence of SSE / first-token rows.
 */
export const CVDIAG_FAILURE_CLASSIFIERS = [
  "sse-missing",
  "dom-missing",
  "text-unstable",
  "surface-missing",
  "selector-mismatch",
] as const;
export type CvdiagFailureClassifier =
  (typeof CVDIAG_FAILURE_CLASSIFIERS)[number];

export interface ProbeExitMeta {
  terminal_outcome: CvdiagOutcome;
  total_duration_ms: number;
  sse_event_count: number;
  first_token_delta_ms: number | null;
  /**
   * Present ONLY on a non-`ok` terminal outcome. Classifies which turn-complete
   * signal was missing (the `waitForTurnComplete` reject reason, or a derived
   * best-effort classifier from the probe's own observed signals).
   */
  failure_classifier?: CvdiagFailureClassifier;
}

// Layer 2 (backend) ──────────────────────────────────────────────────────────

export interface BackendRequestIngressMeta {
  method: string;
  path: string;
  content_length: number | null;
}
export interface BackendAgentEnterMeta {
  agent_name: string;
  model_id: string;
}
export interface BackendLlmCallStartMeta {
  provider: string;
  model: string;
  prompt_token_count_estimate: number;
}
export interface BackendLlmCallHeartbeatMeta {
  elapsed_ms_since_start: number;
}
export interface BackendLlmCallResponseMeta {
  provider: string;
  model: string;
  response_token_count: number | null;
  latency_ms: number;
  error_class: string | null;
}
export interface BackendSseFirstByteMeta {
  delta_ms_from_ingress: number;
}
export interface BackendSseEventMeta {
  event_type: string;
  payload_size_bytes: number;
  sequence_num: number;
}
export interface BackendSseAbortedMeta {
  termination_kind: TerminationKind;
  bytes_before_abort: number;
}
export interface BackendAgentExitMeta {
  terminal_outcome: CvdiagOutcome;
  total_duration_ms: number;
}
export interface BackendResponseCompleteMeta {
  http_status: number;
  content_length: number | null;
  total_duration_ms: number;
  sse_event_count: number;
}
export interface BackendErrorCaughtMeta {
  exception_type: string;
  /** ≤512B */
  message_scrubbed: string;
  /** ≤8 frames, total ≤2048B */
  stack_brief: Array<{ file: string; line: number }>;
  truncated?: boolean;
}

// Layer 3 (aimock) ────────────────────────────────────────────────────────────

export interface AimockRequestIngressMeta {
  path: string;
  content_length: number;
  /** R2-NF1: sha256_16 (128-bit) to defeat preimage attacks on the corpus. */
  match_keys: Array<{ key_name: string; sha256_16: string }>;
}
export interface AimockMatchDecisionMeta {
  /** regex ^[a-z0-9-]+$ */
  fixture_id: string | null;
  /** 0.0-1.0 */
  match_score: number;
  reject_reasons: Array<{ key: string; expected: string; actual: string }>;
}
export interface AimockResponseStartMeta {
  delta_ms_from_ingress: number;
}
export interface AimockSseChunkMeta {
  chunk_size_bytes: number;
  sequence_num: number;
}
export interface AimockResponseAbortedMeta {
  termination_kind: TerminationKind;
  bytes_before_abort: number;
}
export interface AimockResponseCompleteMeta {
  http_status: number;
  total_bytes: number;
  total_duration_ms: number;
  chunk_count: number;
}

/**
 * The closed envelope (spec §5). Per-boundary `metadata` is typed by the
 * interfaces above; at runtime it is validated against the declared key set
 * for the `(layer, boundary)` pair by `validateMetadata`.
 */
export interface CvdiagEnvelope {
  /** const 1 in v1. */
  schema_version: typeof SCHEMA_VERSION;
  /**
   * The CROSS-LAYER JOIN KEY: the single id that joins one run's rows across
   * probe / backend / aimock (spec §5). Normally a UUIDv7 (the probe mints one
   * and threads it through). On the BACKEND adoption path it is the probe's
   * per-run id forwarded as the inbound `x-test-id` (sanitized free text, e.g.
   * `d4-<slug>-<runId>`) so backend rows join the probe's — PB stores this
   * column as free text, so a non-UUIDv7 join key is valid at storage.
   */
  test_id: string;
  /**
   * The emitter's OWN PER-REQUEST id. MIRRORS `test_id` by default (probe path:
   * one run = one test_id = one trace_id). The backend supplies a distinct
   * per-request UUIDv7 so `trace_id` stays decoupled from an ADOPTED
   * cross-layer `test_id`.
   */
  trace_id: string;
  /** 16-hex, unique per emit. */
  span_id: string;
  /** null at root boundaries; references the parent boundary's span_id. */
  parent_span_id: string | null;
  layer: CvdiagLayer;
  boundary: CvdiagBoundary;
  slug: string;
  demo: string;
  /** ISO-8601 with `Z` at millisecond precision. */
  ts: string;
  /** emitter-local monotonic ns (within-layer ordering). */
  mono_ns: number;
  /** present-and-null = "this boundary does not measure duration." */
  duration_ms: number | null;
  outcome: CvdiagOutcome;
  edge_headers: EdgeHeaders;
  metadata: Record<string, unknown>;
  /** Stamped true when the metadata validator dropped unknown keys. */
  _metadata_dropped?: boolean;
  /** Stamped true when an over-budget field was truncated. */
  _truncated?: boolean;
}

/**
 * UUIDv7 (lowercase, hyphenated) validation regex (spec §5 `test_id`, R3-F5).
 * Version nibble is `7`; variant nibble is one of 8/9/a/b.
 */
export const TEST_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** True iff `value` is a well-formed lowercase UUIDv7. */
export function isValidTestId(value: unknown): value is string {
  return typeof value === "string" && TEST_ID_REGEX.test(value);
}

/** The closed set of envelope keys (the only top-level keys permitted). */
export const ENVELOPE_KEYS = [
  "schema_version",
  "test_id",
  "trace_id",
  "span_id",
  "parent_span_id",
  "layer",
  "boundary",
  "slug",
  "demo",
  "ts",
  "mono_ns",
  "duration_ms",
  "outcome",
  "edge_headers",
  "metadata",
  // Emitter-stamped flags are permitted on the envelope:
  "_metadata_dropped",
  "_truncated",
] as const;
const ENVELOPE_KEY_SET: ReadonlySet<string> = new Set(ENVELOPE_KEYS);

export interface EnvelopeValidationResult {
  ok: boolean;
  unknownKeys: string[];
}

/**
 * Closed-world envelope validation (spec §6 PII closed-world). Returns the set
 * of unknown top-level keys; `ok` is true iff none are present. Callers MUST
 * reject (`ok === false`) — unknown keys are NEVER written to PB.
 */
export function validateEnvelope(
  obj: Record<string, unknown>,
): EnvelopeValidationResult {
  const unknownKeys = Object.keys(obj).filter((k) => !ENVELOPE_KEY_SET.has(k));
  return { ok: unknownKeys.length === 0, unknownKeys };
}

/**
 * Declared metadata key sets per data-plane boundary (closed-world coverage,
 * spec §6 R2-NF4). The emit-time validator drops any metadata key not in the
 * declared set for the `(layer, boundary)` pair and stamps `_metadata_dropped`.
 * Accounting (`cvdiag.*`) boundaries carry envelope-level fields only and have
 * NO entry here.
 */
export const BOUNDARY_METADATA_KEYS: Record<
  CvdiagDataPlaneBoundary,
  readonly string[]
> = {
  // probe
  "probe.start": ["url", "viewport"],
  "probe.navigate.complete": ["url", "nav_ms", "http_status"],
  "probe.message.send": ["message_index", "char_count", "demo"],
  "probe.dom.container.mount": ["delta_ms_from_start"],
  "probe.dom.firsttoken": ["delta_ms_from_start", "text_length"],
  "probe.dom.alternate_content": ["child_type_histogram"],
  "probe.sse.event": ["event_type", "payload_size_bytes", "sequence_num"],
  "probe.sse.aborted": ["termination_kind", "bytes_before_abort"],
  "probe.network.error": ["url", "error_class", "response_status"],
  "probe.network.response": ["url", "status", "content_length", "duration_ms"],
  "probe.console.error": [
    "level",
    "message_scrubbed",
    "source_file",
    "line_col",
  ],
  "probe.exit": [
    "terminal_outcome",
    "total_duration_ms",
    "sse_event_count",
    "first_token_delta_ms",
    "failure_classifier",
  ],
  // backend
  "backend.request.ingress": ["method", "path", "content_length"],
  "backend.agent.enter": ["agent_name", "model_id"],
  "backend.llm.call.start": [
    "provider",
    "model",
    "prompt_token_count_estimate",
  ],
  "backend.llm.call.heartbeat": ["elapsed_ms_since_start"],
  "backend.llm.call.response": [
    "provider",
    "model",
    "response_token_count",
    "latency_ms",
    "error_class",
  ],
  "backend.sse.first_byte": ["delta_ms_from_ingress"],
  "backend.sse.event": ["event_type", "payload_size_bytes", "sequence_num"],
  "backend.sse.aborted": ["termination_kind", "bytes_before_abort"],
  "backend.agent.exit": ["terminal_outcome", "total_duration_ms"],
  "backend.response.complete": [
    "http_status",
    "content_length",
    "total_duration_ms",
    "sse_event_count",
  ],
  "backend.error.caught": [
    "exception_type",
    "message_scrubbed",
    "stack_brief",
    "truncated",
  ],
  // aimock
  "aimock.request.ingress": ["path", "content_length", "match_keys"],
  "aimock.match.decision": ["fixture_id", "match_score", "reject_reasons"],
  "aimock.response.start": ["delta_ms_from_ingress"],
  "aimock.sse.chunk": ["chunk_size_bytes", "sequence_num"],
  "aimock.response.aborted": ["termination_kind", "bytes_before_abort"],
  "aimock.response.complete": [
    "http_status",
    "total_bytes",
    "total_duration_ms",
    "chunk_count",
  ],
};

const DATA_PLANE_BOUNDARY_SET: ReadonlySet<string> = new Set(
  CVDIAG_DATA_PLANE_BOUNDARIES,
);

export interface MetadataValidationResult {
  metadata: Record<string, unknown>;
  metadataDropped: boolean;
  droppedKeys: string[];
}

/**
 * Closed-world per-boundary metadata validation (spec §6 R2-NF4). Drops any
 * metadata key not declared for the `(layer, boundary)` pair, returns the
 * surviving metadata, and reports whether any key was dropped. The emitter
 * stamps `_metadata_dropped: true` on the survivor when `metadataDropped` is
 * true. For an unknown boundary (not in the data-plane set) all metadata is
 * dropped (fail-closed).
 */
export function validateMetadata(
  _layer: CvdiagLayer,
  boundary: CvdiagDataPlaneBoundary,
  metadata: Record<string, unknown>,
): MetadataValidationResult {
  if (!DATA_PLANE_BOUNDARY_SET.has(boundary)) {
    // Unknown boundary: drop everything, fail-closed.
    const droppedKeys = Object.keys(metadata);
    return {
      metadata: {},
      metadataDropped: droppedKeys.length > 0,
      droppedKeys,
    };
  }
  const allowed = new Set(BOUNDARY_METADATA_KEYS[boundary]);
  const survivor: Record<string, unknown> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (allowed.has(key)) {
      // §6 secret scrub: free-text / URL metadata values (e.g.
      // `*.message_scrubbed`, `probe.*.url`) can carry `Bearer …` tokens,
      // `sk-…` keys, or URL userinfo — at ANY depth, since some allow-listed
      // values are arrays/objects (e.g. `backend.error.caught.stack_brief`,
      // `aimock.match.decision.reject_reasons`). Scrub string LEAVES at every
      // depth; non-string leaves (numbers/booleans/null) are untouched.
      if (typeof value === "string") {
        survivor[key] = scrubSecrets(value);
      } else if (value !== null && typeof value === "object") {
        // §6 deep secret-scrub. `scrubDeep` BUILDS a fresh scrubbed copy of the
        // nested value — it NEVER mutates the caller's object, for ANY input
        // shape including unclonable leaves like functions / class instances
        // (spec §3.2.5 P3). There is therefore NO `structuredClone` defensive
        // copy and NO try/catch fallback: the clone was itself the source of the
        // R5-A4 unclonable-leaf mutation trap (clone throws → fall back to
        // scrubbing the ORIGINAL in place). Calling `scrubDeep` directly is both
        // simpler and strictly non-mutating by construction.
        survivor[key] = scrubDeep(value);
      } else {
        survivor[key] = value;
      }
    } else {
      droppedKeys.push(key);
    }
  }
  return {
    metadata: survivor,
    metadataDropped: droppedKeys.length > 0,
    droppedKeys,
  };
}
