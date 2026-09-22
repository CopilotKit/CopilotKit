import { hostname } from "node:os";

import type {
  TypedEventBus,
  WriterFailureReason,
} from "../events/event-bus.js";
import { detectTransition } from "../events/transition-detector.js";
import type { PbClient } from "../storage/pb-client.js";
import { asKnownState } from "../types/index.js";
import type {
  Logger,
  ProbeResult,
  State,
  StatusHistoryRecord,
  StatusRecord,
  WriteOutcome,
} from "../types/index.js";

/**
 * PER-PROCESS WRITE SERIALIZATION (B5 lineage — formerly the
 * "SINGLE-WRITER INVARIANT")
 * ---------------------------------------------------------------------
 * Per-key writes are serialized by `makeKeyedMutex()` below — but ONLY
 * within this process. Cross-process, the system is multi-writer BY
 * DESIGN during the legacy/fleet coexistence window: the legacy
 * monolith, the fleet control-plane, and the CLI all write `status`
 * rows concurrently (see orchestrator.ts, "probe-loader wiring" — both
 * scheduler paths run in parallel until Phase 4.1 retires the legacy
 * one). So there is no single-writer invariant; the mutex guarantees
 * per-key serialization per process, nothing more.
 *
 * Consequence: under cross-process contention the `outcome` emitted on
 * `status.changed` (`previousState` / `failCount`) reflects THIS
 * writer's view at write time and may diverge from the row another
 * writer persisted moments later. We do not re-read the row to confirm.
 *
 * Detection, not prevention: every write stamps `written_by` (writer
 * role+service identity, migration 1779990200), and this writer emits a
 * structured WARN when a DIFFERENT writer flips a key green<->red
 * within the fight window — that's the dual-writer ("flap comb")
 * detection mechanism. Observability only; nothing blocks.
 *
 * The error-path already guards this correctly (F2.2): `status.changed`
 * is only emitted when the observed_at write persisted. The success
 * path doesn't need the same guard because the upsert's throw bubbles
 * out of `doWrite` before we reach the emit — so there's no silent
 * bus/DB divergence even on failure (within this process).
 */

// Bound on the warn-dedupe Sets so a broken probe producing a stream of
// distinct keys (thousands of one-shot probe-keys) can't OOM the process
// over its lifetime. The malformed-key set is drop-oldest (LRU-ish
// insertion order). The legacy-failure set: recovery deletes the entry
// (legacyWarnGate.clear), but a red→green→red cycle through THIS writer can
// never re-trip the warn anyway — our own green_to_red stamps
// first_failure_at, making the legacy branch unreachable. The deletion
// matters for FOREIGN partial writes (an old-image writer re-reddening the
// row WITHOUT stamping first_failure_at): those re-warn immediately on
// their next sustained_red tick. The TTL governs SUSTAINED red only,
// re-warning a row that never recovers once the TTL lapses. (B4, B8;
// comment corrected in round 7 A3 — the immediate re-warn was previously
// claimed for our own red→green→red cycles, which can't reach the branch.)
const MAX_WARNED_KEYS = 1024;
// Round-9 #6: renamed from LEGACY_WARN_TTL_MS — it now governs every
// TTL'd warn gate (legacy missing-first_failure_at, foreign-write
// fighting, flip-unparseable-timestamp), not just the legacy one.
const WARN_TTL_MS = 60 * 60 * 1000; // 1h

// See PocketBase error shape — PB emits validation errors as
// `{ data: { <field>: { code, message } } }` on 400s. Bare String(err)
// collapses the object to "[object Object]" and erases the reason.
// R21 bucket-a: PbHttpError (pb-client.ts) exposes the HTTP code as
// `statusCode`, but the historical PB SDK error shape uses `status`.
// errorInfo reads whichever is present so classifyWriterError can
// route 401/403/429/5xx correctly regardless of the error source.
interface MaybePbError {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  data?: unknown;
}

export interface WriterErrorInfo {
  message: string;
  /**
   * Round-8 #4: the error's `name` when it carries a meaningful one (e.g.
   * a fetch-abort DOMException's "AbortError" — whose MESSAGE matches no
   * abort phrasing, so the name is the only classifiable signal). Omitted
   * for the default "Error" name, which adds nothing.
   */
  name?: string;
  status?: number;
  /**
   * Preserved whenever the error carries object-shaped `data` — most
   * commonly PB's 400 validation shape, but errorInfo copies it regardless
   * of status (A6(iii): the old "only when 400" wording was wrong).
   */
  data?: Record<string, unknown>;
}

/**
 * Best-effort extractor for PB error bodies (B7). Returns a structured
 * descriptor carrying the useful parts (message, HTTP status, validation
 * payload) so downstream emitters don't have to string-match.
 */
export function errorInfo(err: unknown): WriterErrorInfo {
  // R21 bucket-a: pb-client.ts's PbHttpError uses `statusCode`, while the
  // historical PB SDK error shape used `status`. Prefer `statusCode` when
  // present (it's the newer source), fall back to `status` for back-compat.
  // Previously errorInfo ignored `statusCode` entirely, so a retry-exhausted
  // PbHttpError with statusCode=429 fell through to classifyWriterError's
  // `unknown` branch instead of `pb_rate_limited`.
  const pickStatus = (maybe: MaybePbError): number | undefined => {
    if (typeof maybe.statusCode === "number") return maybe.statusCode;
    if (typeof maybe.status === "number") return maybe.status;
    return undefined;
  };
  // Round-8 #4: carry a meaningful error NAME so classifyWriterError can
  // match shapes whose message carries no signal (DOMException AbortError).
  const pickName = (maybe: MaybePbError): string | undefined =>
    typeof maybe.name === "string" && maybe.name && maybe.name !== "Error"
      ? maybe.name
      : undefined;
  if (err instanceof Error) {
    const { message } = err;
    const maybe = err as unknown as MaybePbError;
    const info: WriterErrorInfo = { message };
    const n = pickName(maybe);
    if (n !== undefined) info.name = n;
    const s = pickStatus(maybe);
    if (s !== undefined) info.status = s;
    if (
      maybe.data &&
      typeof maybe.data === "object" &&
      !Array.isArray(maybe.data)
    ) {
      info.data = maybe.data as Record<string, unknown>;
    }
    return info;
  }
  if (typeof err === "string") return { message: err };
  if (err && typeof err === "object") {
    const maybe = err as MaybePbError;
    const info: WriterErrorInfo = {
      message:
        typeof maybe.message === "string"
          ? maybe.message
          : (safeJson(err) ?? String(err)),
    };
    const n = pickName(maybe);
    if (n !== undefined) info.name = n;
    const s = pickStatus(maybe);
    if (s !== undefined) info.status = s;
    if (
      maybe.data &&
      typeof maybe.data === "object" &&
      !Array.isArray(maybe.data)
    ) {
      info.data = maybe.data as Record<string, unknown>;
    }
    return info;
  }
  return { message: String(err) };
}

function safeJson(v: unknown): string | undefined {
  try {
    return JSON.stringify(v);
  } catch {
    return undefined;
  }
}

/**
 * Serialize a WriterErrorInfo into a single string for the `err` field
 * on WriterFailedEvent — keeps backward compat with subscribers that
 * treat `err` as opaque text, while still carrying the structured
 * payload. Consumers that need the structure can re-parse this JSON.
 */
export function serializeErr(info: WriterErrorInfo): string {
  const payload: Record<string, unknown> = { message: info.message };
  // Round-9 #3: carry `name` — round-8 #4 added it as the only
  // classifiable signal for abort shapes whose message matches nothing;
  // dropping it here broke the documented structured round-trip.
  if (info.name !== undefined) payload.name = info.name;
  if (info.status !== undefined) payload.status = info.status;
  if (info.data !== undefined) payload.data = info.data;
  return safeJson(payload) ?? info.message;
}

/**
 * Map a WriterErrorInfo onto a WriterFailureReason (B6). We map on
 * HTTP status first (the primary classifier) and fall back to message
 * inspection for network-level errors that never reached PB.
 */
export function classifyWriterError(
  info: WriterErrorInfo,
): WriterFailureReason {
  const { status, message } = info;
  if (status === 401) return "pb_auth_error";
  if (status === 403) return "pb_permission";
  if (status === 429) return "pb_rate_limited";
  // A3: a 404 means the target row vanished (e.g. deleted between a read
  // and a field-scoped update — TOCTOU). Previously this fell through to
  // "unknown", so callers couldn't degrade gracefully on a row-miss.
  if (status === 404) return "pb_not_found";
  if (status !== undefined && status >= 500 && status < 600) {
    return "pb_server_error";
  }
  // All PB 400s route to `pb_schema_error` — the WriterFailureReason union
  // (see event-bus.ts) has no narrower bad-request bucket, and in practice
  // every PB 400 we see is a validation/schema shape error.
  if (status === 400) return "pb_schema_error";
  // No HTTP status — fetch-level error or thrown from outside PB.
  // A5(i): match the SPECIFIC error tokens as whole words, not bare
  // substrings — `includes("econn")` matched "preconnect" and
  // `includes("abort")` matched "abortive", misrouting unrelated messages
  // into network_error. A5 (round 6): cover the full node/undici
  // network-error token family (ETIMEDOUT, EAI_AGAIN, EPIPE, EHOSTUNREACH,
  // "socket hang up") and replace the bare `includes("network")` substring
  // with a word-boundary check so e.g. "networking" doesn't match.
  // A6(i) (round 7): abort matching is by ERROR SHAPE, not the bare word —
  // `\babort(ed|error)?\b` still matched "aborted" in unrelated domain
  // prose (e.g. a probe's "deploy aborted by operator"), misrouting it
  // into network_error. Only the actual abort error shapes classify: the
  // DOMException/undici error NAME ("AbortError"), the node fetch abort
  // message ("operation was aborted"), and undici's RequestAbortedError
  // message ("request aborted"). Round-8 #4: the NAME coverage is real —
  // errorInfo carries err.name (a DOMException AbortError's message, "The
  // user aborted a request.", matches none of the message phrasings), so
  // the haystack is name+message, not message alone.
  const lower = [info.name, message]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" ")
    .toLowerCase();
  if (
    lower.includes("fetch failed") ||
    lower.includes("socket hang up") ||
    /\beconn(refused|reset|aborted)\b/.test(lower) ||
    /\baborterror\b/.test(lower) ||
    lower.includes("operation was aborted") ||
    lower.includes("request aborted") ||
    /\b(enotfound|etimedout|eai_again|epipe|ehostunreach)\b/.test(lower) ||
    /\bnetwork\b/.test(lower)
  ) {
    return "network_error";
  }
  if (
    lower.includes("validation_not_unique") ||
    lower.includes("is not unique")
  ) {
    return "pb_schema_error";
  }
  return "unknown";
}

// A4 (round 4) / A6 (round 6): `state` values read back from PB are
// validated via `asKnownState` — now imported from its canonical home in
// types/index.ts (which sits below both this module and result-aggregator,
// dissolving the import cycle that forced each to carry a private replica).

/**
 * Round-8 #1: "parseable" is NOT "PB-safe". PB's date validation accepts
 * ISO-8601/RFC3339-style strings only, while V8's Date.parse is far more
 * lenient — RFC-1123 ("Sun, 20 Apr 2026 …") and US-style ("04/20/2026")
 * parse fine but 400 in a PB date field. The earlier guards classified
 * PB-safe as `Number.isFinite(Date.parse(v))`, so those shapes passed the
 * guard and still 400'd the tick — recreating the exact failure class the
 * guards exist to prevent. Every value bound for a PB date field goes
 * through {@link toPbSafeDate}: PB-safe-AND-unambiguous values pass
 * through verbatim (no rewrite churn on the common path), merely-parseable
 * values are normalized via toISOString(), unparseable values return
 * undefined and take the documented skip-and-warn paths.
 *
 * Round-9 #1: the UTC-offset arm requires the RFC-3339 colon
 * (`[+-]\d{2}:\d{2}`). A colonless offset ("+0230") is V8-parseable but
 * PB-rejected — the previous `:?` accepted it for verbatim passthrough,
 * recreating the round-8 failure class; it now falls into the
 * toISOString() branch.
 *
 * Round-9 #2 — DECISION: verbatim passthrough requires an EXPLICIT zone
 * designator (Z or ±hh:mm), so the shape below is deliberately NARROWER
 * than what PB accepts. PB accepts zone-less date-times ("2026-04-20
 * 12:00:00", T-form without offset) and stores/compares them as UTC,
 * while V8's Date.parse reads the same literal as HOST-LOCAL time. A
 * zone-less value passed through verbatim therefore persisted a DIFFERENT
 * instant than every Date.parse-based comparison in this file computed
 * (error-path stale guard, overlay monotonic guard, cross-writer flip
 * window) — each skewed by the host's UTC offset. Normalizing zone-less
 * (and date-only — instant-preserving, since Date.parse reads date-only
 * as UTC) shapes via toISOString() makes the persisted instant the
 * compared instant on every host. This intentionally accepts rewrite
 * churn on zone-less inputs: ambiguity-free persistence wins.
 */
const PB_DATE_SHAPE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function toPbSafeDate(value: string): string | undefined {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  return PB_DATE_SHAPE.test(value) ? value : new Date(ms).toISOString();
}

/**
 * A1 (round 5): safe substitute timestamp for a history row when the
 * incoming observedAt is unparseable. status_history.observed_at is a
 * REQUIRED PB date field, so writing the raw garbage value 400s the history
 * create — killing the audit trail (and, on the overlay path, the whole
 * overlay attempt). Substitute the row's current observed_at when that is
 * itself PB-safe (round-8 #1: normalized, not merely parseable), else fall
 * back to "now".
 */
function safeHistoryObservedAt(existingObservedAt: string | undefined): string {
  const safe = existingObservedAt
    ? toPbSafeDate(existingObservedAt)
    : undefined;
  return safe ?? new Date().toISOString();
}

/**
 * B8 / A6(iv) round 7 / round-8 #2: TTL'd per-key warn-dedup gate, shared
 * by every warn that fires on a PERSISTENT cross-tick condition where
 * "once per process lifetime" hides sustained recurrence (legacy
 * missing-first_failure_at, foreign-write fighting, flip-unparseable
 * timestamps). `shouldWarn` returns true (and records the warn time) when
 * no warn fired for the key within WARN_TTL_MS. Value is the
 * last-warned-at timestamp. A5 (round 3): delete-then-set, because
 * Map.set on an EXISTING key keeps its original insertion position — a
 * TTL-expired re-warn would otherwise leave the key at its old (oldest)
 * slot and the drop-oldest cap eviction below could evict the
 * most-recently-re-warned key under cap pressure. Bounded to
 * MAX_WARNED_KEYS (B4 posture, same drop-oldest discipline as
 * warnedMalformedKeys).
 */
function makeTtlWarnGate(): {
  shouldWarn(key: string, now: number): boolean;
  clear(key: string): void;
} {
  const lastWarnedAtByKey = new Map<string, number>();
  return {
    shouldWarn(key, now) {
      const lastWarnedAt = lastWarnedAtByKey.get(key);
      if (lastWarnedAt !== undefined && now - lastWarnedAt < WARN_TTL_MS) {
        return false;
      }
      lastWarnedAtByKey.delete(key);
      while (lastWarnedAtByKey.size >= MAX_WARNED_KEYS) {
        const oldest = lastWarnedAtByKey.keys().next().value;
        if (oldest === undefined) break;
        lastWarnedAtByKey.delete(oldest);
      }
      lastWarnedAtByKey.set(key, now);
      return true;
    },
    clear(key) {
      lastWarnedAtByKey.delete(key);
    },
  };
}

/**
 * Bounded set that drops the oldest entry on overflow. `Set<string>`
 * iterates in insertion order, so `next().value` on keys() is the
 * oldest — same LRU-ish pattern as useLastTransition.ts's rowCache.
 * Not a true LRU (no move-to-end on re-insertion) because we only `add`
 * keys not currently resident in the set — an evicted key can re-enter
 * (and re-warn) later under eviction churn, so the dedup is "once while
 * resident", NOT exactly once (A6(iii)).
 */
function boundedAdd(set: Set<string>, key: string, max: number): void {
  while (set.size >= max) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
  set.add(key);
}

export interface StatusWriter {
  write(result: ProbeResult<unknown>): Promise<WriteOutcome>;
  /**
   * H1: attach signal-overlay fields (e.g. the REQ-B comm-error overlay) onto
   * an EXISTING status row WITHOUT re-writing its durable state. This is the
   * dedicated path for the carry-forward legs that previously re-wrote a
   * row's prior state through `write()` purely to land an overlay — a
   * same-state durable write that (1) restamped `written_by` with an identity
   * that never produced the state (attribution transfer → fabricated
   * cross-writer-flip warns during legacy/fleet coexistence), (2) bumped
   * `fail_count` via the sustained_red classification (early alert
   * escalation), and (3) re-classified a transition + emitted a spurious
   * `status.changed`.
   *
   * Semantics (modelled on the error path's discipline — see `doWrite`'s
   * `result.state === "error"` branch): the overlay is merged over the row's
   * existing signal and `observed_at` is refreshed ("we tried at this time"),
   * but `state`, `written_by`, `fail_count`, `first_failure_at` and
   * `transitioned_at` are all preserved, no transition is classified, and
   * `status.changed` is NOT emitted. A history row (transition "error") keeps
   * the overlay auditable. When NO row exists there is nothing to overlay:
   * the writer returns `applied: false` and persists nothing — callers route
   * never-observed keys through the error-state `write()` path (history-only,
   * never a fabricated row).
   */
  writeOverlay(overlay: OverlayWrite): Promise<OverlayWriteOutcome>;
}

/** Input for {@link StatusWriter.writeOverlay}. */
export interface OverlayWrite {
  /** Status-row key (e.g. "d6:langgraph-python"). */
  key: string;
  /** Overlay fields merged over the existing row's signal (object spread). */
  signal: Record<string, unknown>;
  /** Refreshes the row's `observed_at` ("we tried at this time"). */
  observedAt: string;
}

/** Outcome of {@link StatusWriter.writeOverlay}. */
export interface OverlayWriteOutcome {
  /** True when an existing status row was found and the overlay persisted. */
  applied: boolean;
  /**
   * The preserved durable state when applied; null when no row existed —
   * or (A4) when the row's `state` read back from PB failed validation
   * (not green|red|degraded), in which case the overlay still applies but
   * the corrupt value is not echoed back.
   */
  state: State | null;
  /**
   * A2 (round 4): discriminator set to `false` ONLY by best-effort wrappers
   * (e.g. the CLI's `bestEffortWriter.writeOverlay`) when the inner overlay
   * write threw and this outcome is synthesized — so a swallowed PB outage
   * (`applied: false` because nothing reached PB; row existence unknown) is
   * distinguishable from a genuine row-miss (`applied: false` from the real
   * writer, which never sets this field).
   */
  persisted?: false;
  /**
   * A4 (round 6): whether the overlay's audit history row landed. The write
   * ordering is update-first, history-second, so the real writer stamps
   * this truthfully on EVERY outcome:
   *
   *   - `applied: true,  historyPersisted: true` — overlay + audit row landed.
   *   - `applied: true,  historyPersisted: false` — overlay landed on the
   *     live row but the audit-row create failed (writer.failed phase
   *     history_create; the comm error still lives on the row's signal).
   *   - `applied: false, historyPersisted: false` — nothing persisted: a
   *     genuine row-miss, or the row vanished between read and update
   *     (404 TOCTOU).
   *
   * Caller contract: on `applied: false`, fall back to the error-state
   * `write()` path UNLESS this is `true`. With update-first ordering the
   * real writer never produces `applied: false` + `historyPersisted: true`,
   * so the fallback always proceeds and lands exactly ONE history row; the
   * skip guard remains for compat with synthesized outcomes. Optional at
   * the type level only for best-effort wrappers that synthesize outcomes
   * (e.g. the CLI's `bestEffortWriter`) — the real writer always stamps it.
   */
  historyPersisted?: boolean;
}

// Fallback writer-identity prefix when a caller doesn't wire `writtenBy`. We
// stamp a fallback rather than omitting the field so an unwired writer is
// still visible in the data (an "unknown-*" stamp is an observable
// misconfiguration; an absent stamp is indistinguishable from a
// pre-migration row). The prefix stays the literal "unknown" so
// misconfiguration remains greppable in rows and logs.
const DEFAULT_WRITTEN_BY_PREFIX = "unknown";

// Per-host fallback identity: `unknown-<host>`, derived once at writer
// construction from $HOSTNAME (containers stamp it) with an os.hostname()
// fallback. A shared constant "unknown" would make two DIFFERENT unwired
// writers mutually invisible to cross-writer flip detection
// (`"unknown" !== "unknown"` is false) — exactly the likeliest
// misconfiguration class this feature exists to catch; the host suffix
// keeps unwired writers on different hosts mutually visible. A6(iv)
// (round 7): the suffix must be STABLE across restarts — the previous
// per-construction RANDOM suffix changed on every restart, so an unwired
// writer flipping its own key across a restart looked like TWO writers
// fighting (fabricated cross-writer-flip warn) and broke the foreign-write
// heuristic's `written_by === self` premise. Sanitized to the same
// lowercase token class as the wired identities so the stamp stays
// greppable and log-safe.
function makeDefaultWrittenBy(): string {
  const raw = process.env.HOSTNAME?.trim() || hostname();
  const sanitized = raw
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");
  return `${DEFAULT_WRITTEN_BY_PREFIX}-${sanitized || "host"}`;
}

// Cross-writer flip window: a green<->red flip by a different writer than
// the previous durable state's writer only counts as a "fight" when the
// previous write is recent — two writers alternating within a couple of
// refresh cycles. 30min comfortably covers ~2x the 15min cadence the
// dual-scheduler incident flapped at, while a months-stale row changing
// hands (a probe family migrating writers) stays silent.
const DEFAULT_CROSS_WRITER_FLIP_WINDOW_MS = 30 * 60 * 1000;

export interface StatusWriterDeps {
  pb: PbClient;
  bus: TypedEventBus;
  logger: Logger;
  /**
   * Writer identity stamped onto every durable status-row write as
   * `written_by` (anti-dual-writer hardening). Role+service of the owning
   * process: `legacy` (monolith boot), `fleet-cp` (fleet control-plane
   * aggregator — the only authoritative fleet writer; workers never write
   * status directly), `cli` (manual results tooling). Defaults to a
   * stable per-host `unknown-<host>` when unset (see
   * makeDefaultWrittenBy) and WARNs once at construction.
   */
  writtenBy?: string;
  /**
   * Window for cross-writer flip detection: a green<->red flip whose
   * previous durable state was written by a DIFFERENT writer within this
   * window emits `status-writer.cross-writer-flip`. Default 30min (~2x the
   * 15min refresh cadence the dual-scheduler incident flapped at).
   */
  crossWriterFlipWindowMs?: number;
}

/**
 * Keyed mutex: per-key serialization of writes WITHIN THIS PROCESS,
 * preventing upsert races on fast consecutive probes for the same key and
 * guarding in-process TOCTOU between the read-current-row and the upsert
 * for the same key. No cross-process guarantee — see the module header
 * (PER-PROCESS WRITE SERIALIZATION): the system is multi-writer by design
 * during the legacy/fleet coexistence window.
 */
function makeKeyedMutex(): (
  key: string,
  fn: () => Promise<void>,
) => Promise<void> {
  const queues = new Map<string, Promise<void>>();
  return (key, fn) => {
    const prev = queues.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // Swallow rejections on the tracked chain so a single thrown write
    // doesn't surface as an unhandled rejection on the queue-head
    // promise; the caller still sees the failure via the `next` we
    // return below.
    const tracked = next
      .catch(() => {})
      .finally(() => {
        if (queues.get(key) === tracked) queues.delete(key);
      });
    queues.set(key, tracked);
    return next;
  };
}

export function createStatusWriter(deps: StatusWriterDeps): StatusWriter {
  const { pb, bus, logger } = deps;
  // A4 (round 5): trim + truthiness, not just nullish — `writtenBy: ""` (or
  // whitespace-only, e.g. an unset env var interpolated into config)
  // previously bypassed the fallback and stamped EMPTY attribution silently,
  // which the cross-writer-flip guard then treated as unattributable.
  const configuredWrittenBy = deps.writtenBy?.trim() || undefined;
  const writtenBy = configuredWrittenBy ?? makeDefaultWrittenBy();
  if (configuredWrittenBy === undefined) {
    // One-time (per construction) WARN: no production path constructs a
    // writer without `writtenBy`, so this only fires on a future wiring
    // mistake — making the misconfiguration loud at boot instead of
    // discoverable only from "unknown-*" stamps in the data.
    logger.warn("status-writer.default-written-by", {
      writtenBy,
      hint: "writtenBy not configured — stamping per-process fallback identity; wire writtenBy (legacy|fleet-cp|cli)",
    });
  }
  // Round-8 #3: construction-time validation. The window feeds
  // `deltaMs <= crossWriterFlipWindowMs` — with NaN that comparison is
  // always false, and with zero/negative it only holds for non-positive
  // deltas, so an invalid configured value SILENTLY disabled flip
  // detection entirely. Non-finite or non-positive → fall back to the
  // default and warn once (same loud-at-boot posture as the
  // default-written-by warn below).
  const configuredFlipWindowMs = deps.crossWriterFlipWindowMs;
  const flipWindowValid =
    configuredFlipWindowMs !== undefined &&
    Number.isFinite(configuredFlipWindowMs) &&
    configuredFlipWindowMs > 0;
  const crossWriterFlipWindowMs = flipWindowValid
    ? configuredFlipWindowMs
    : DEFAULT_CROSS_WRITER_FLIP_WINDOW_MS;
  if (configuredFlipWindowMs !== undefined && !flipWindowValid) {
    logger.warn("status-writer.invalid-cross-writer-flip-window", {
      configuredWindowMs: configuredFlipWindowMs,
      fallbackWindowMs: DEFAULT_CROSS_WRITER_FLIP_WINDOW_MS,
      hint: "crossWriterFlipWindowMs must be a finite positive number — falling back to the default window so flip detection stays enabled",
    });
  }
  const runKeyed = makeKeyedMutex();

  // Dedupe for the malformed-key warn so a persistently broken probe
  // doesn't fill logs with the same message each tick. Bounded (B4):
  // drop-oldest on overflow so a pathological probe emitting a stream of
  // distinct malformed keys can't OOM us. A5(iii): NOT strictly
  // once-per-key — the dedupe only holds while the key stays resident in
  // the bounded set; under eviction churn (>MAX_WARNED_KEYS distinct
  // malformed keys) an evicted key re-warns on its next write.
  const warnedMalformedKeys = new Set<string>();
  // TTL'd dedupe (makeTtlWarnGate) for the legacy-missing-first-failure
  // warn — legacy rows can persist for days until a red_to_green cycle
  // clears them, and a per-tick warn would drown operators. Recovery
  // (red_to_green) DELETES the entry via legacyWarnGate.clear — though a
  // red→green→red cycle through THIS writer never re-trips the warn anyway
  // (our own green_to_red stamps first_failure_at, making the legacy
  // branch unreachable); the deletion matters for FOREIGN partial writes
  // that re-redden the row WITHOUT stamping first_failure_at, which
  // re-warn immediately on their next sustained_red tick. The TTL governs
  // SUSTAINED red, re-warning a never-recovering row once 1h lapses
  // (round-7 A3 comment fix — the immediate re-warn was previously claimed
  // for our own red→green→red cycles).
  const legacyWarnGate = makeTtlWarnGate();
  // A6(i) (round 5): per-(warn,key) dedup for warns that fire on PERSISTENT
  // per-tick conditions (corrupt-state-read and the unparseable-observedAt
  // family) — without it a persistently broken row/probe re-warns every
  // tick indefinitely. Same B4 bounded drop-oldest posture as
  // warnedMalformedKeys: not strictly once — eviction churn re-warns (see
  // boundedAdd).
  const dedupedWarnKeys = new Set<string>();
  function warnDeduped(
    msg: string,
    key: string,
    meta: Record<string, unknown>,
  ): void {
    const dedupeKey = `${msg}\u0000${key}`;
    if (dedupedWarnKeys.has(dedupeKey)) return;
    boundedAdd(dedupedWarnKeys, dedupeKey, MAX_WARNED_KEYS);
    logger.warn(msg, meta);
  }
  function deriveDimensionWithWarn(key: string): string {
    const idx = key.indexOf(":");
    if (idx > 0) return key.slice(0, idx);
    if (!warnedMalformedKeys.has(key)) {
      boundedAdd(warnedMalformedKeys, key, MAX_WARNED_KEYS);
      logger.warn("status-writer.malformed-key", {
        key,
        hint: "expected <dimension>:<slug> — dimension will be recorded as 'unknown'",
      });
    }
    return "unknown";
  }

  // A6(iv) (round 7): TTL'd dedup for the foreign-write warn — same posture
  // (and same 1h TTL) as legacyWarnGate above. The previous
  // warnDeduped-based dedup fired ONCE per key for the process lifetime, so
  // a foreign writer CONTINUOUSLY fighting a key was visible exactly once
  // and then invisible forever; sustained fighting must re-warn once the
  // TTL lapses.
  const foreignWriteWarnGate = makeTtlWarnGate();

  // Round-8 #2: TTL'd dedup for the flip-unparseable-timestamp warn. Its
  // trigger condition — a cross-writer green<->red fight over a row whose
  // windowed timestamp is unparseable — PERSISTS across ticks in a
  // sustained dual-writer fight (the exact scenario the warn targets), so
  // the previously-undeduped warn fired on every flip tick indefinitely.
  const flipUnparseableWarnGate = makeTtlWarnGate();

  // A1 (round 6): bounded in-memory map of the last durable state THIS
  // writer persisted per key. The cross-writer flip detector compares
  // `existing.written_by` against our identity — but an old-image legacy
  // writer's PARTIAL update (state without written_by, PB updates only the
  // fields provided) leaves OUR stale stamp on a state we never wrote, so
  // the next write sees written_by === self and the flip detector is BLIND
  // to exactly the legacy-vs-fleet flap-comb this feature targets. This map
  // is the within-process-lifetime mitigation: remember what we last
  // durably wrote, and if the row's state read back under our own stamp
  // differs, a foreign writer mutated the row under our identity. A memory
  // miss (key absent — e.g. process restart) stays SILENT: no false
  // positives, at the cost of restart blindness. Bounded like the
  // warn-dedup sets (B4 posture).
  const lastDurableStateByKey = new Map<string, State>();
  // A6(v) (round 7): one-time warn when the bounded map FIRST evicts.
  // Evicted keys become foreign-write-detection blind, and without a signal
  // the cap-induced blindness was indistinguishable from "no foreign
  // writes". One warn (not per-eviction — a fleet legitimately above the
  // cap would spam every write) makes the blindness diagnosable.
  let warnedDurableStateEviction = false;
  function rememberDurableState(key: string, state: State): void {
    // Delete-then-set so a refresh moves the key to the back of the
    // drop-oldest eviction order (same posture as the TTL warn gates).
    lastDurableStateByKey.delete(key);
    while (lastDurableStateByKey.size >= MAX_WARNED_KEYS) {
      const oldest = lastDurableStateByKey.keys().next().value;
      if (oldest === undefined) break;
      lastDurableStateByKey.delete(oldest);
      if (!warnedDurableStateEviction) {
        warnedDurableStateEviction = true;
        logger.warn("status-writer.durable-state-memory-evicting", {
          key,
          evictedKey: oldest,
          max: MAX_WARNED_KEYS,
          hint: "self-write memory hit its cap — evicted keys are blind to foreign-write detection until rewritten; further evictions will not re-warn",
        });
      }
    }
    lastDurableStateByKey.set(key, state);
  }

  /**
   * A4: validated read of a row's durable state. A corrupt/legacy PB value
   * (anything outside green|red|degraded) degrades to null ("no prior
   * observation") with a warn — it must reach neither detectTransition
   * (bogus baseline) nor a status_history create (required select → 400).
   */
  function readValidatedState(
    key: string,
    existing: StatusRecord | null | undefined,
  ): State | null {
    if (!existing) return null;
    const known = asKnownState(existing.state);
    if (known !== undefined) return known;
    // A6(i): deduped — a corrupt durable state persists across ticks (an
    // overlay never repairs it), so this fired indefinitely.
    warnDeduped("status-writer.corrupt-state-read", key, {
      key,
      state: existing.state,
      hint: "durable state read back from PB is not green|red|degraded — treating as no prior observation",
    });
    return null;
  }

  async function doWrite(result: ProbeResult<unknown>): Promise<WriteOutcome> {
    const existing = await pb.getFirst<StatusRecord>(
      "status",
      `key = ${JSON.stringify(result.key)}`,
    );
    const prevState: State | null = readValidatedState(result.key, existing);
    const transition = detectTransition(prevState, result.state);

    if (result.state === "error") {
      // F2b: on a first-ever-error tick (no prior row) the history row's
      // `state` is a PLACEHOLDER, not an observation. We cannot skip the
      // row: the no-data contract relies on the error-state write() path
      // recording the tick to status_history ONLY (result-aggregator's
      // comm-error routing documents "writes to status_history only and
      // never fabricates a status row") — this row is the sole persisted
      // trace of the
      // error. And we cannot write null: status_history.state is a
      // required select green|red|degraded (migration
      // 1776789100_recreate_collections_v2). So `carriedState` falls back
      // to "green" purely to satisfy the schema. Consumers must not read
      // a transition:"error" row's `state` as a baseline — the
      // F2a-corrected WriteOutcome.errorStatePrev (null when never
      // observed) is the honest signal, and the status-row side never
      // seeds anything (F2.1 below).
      const carriedState: State = prevState ?? "green";
      // A1 (round 5): the unparseable-observedAt check is HOISTED ABOVE the
      // history create. status_history.observed_at is a required PB date
      // field, so the raw garbage value 400'd the history create FIRST and
      // the round-3 guard (which sat below, on the observed_at refresh) was
      // dead code — the whole error tick threw before reaching it. The
      // history row now lands with a safe substituted timestamp and the
      // documented skip-the-patch behavior proceeds below.
      // Round-8 #1: PB-safety is decided by toPbSafeDate (PB shape or
      // normalized ISO), not bare Date.parse — see the PB_DATE_SHAPE note.
      const incomingObservedMs = Date.parse(result.observedAt);
      const safeIncomingObservedAt = toPbSafeDate(result.observedAt);
      if (safeIncomingObservedAt === undefined) {
        // A6(i): deduped — a broken probe feeds garbage every tick.
        warnDeduped("status-writer.error-unparseable-observed-at", result.key, {
          key: result.key,
          observedAt: result.observedAt,
          currentObservedAt: existing?.observed_at,
          hint: "incoming error-tick observedAt is unparseable — landing the history row with a substituted timestamp and skipping the observed_at refresh (PB would 400 on a non-date value)",
        });
      }
      const history: StatusHistoryRecord = {
        key: result.key,
        dimension: deriveDimensionWithWarn(result.key),
        state: carriedState,
        transition: "error",
        signal: result.signal,
        observed_at:
          safeIncomingObservedAt ??
          safeHistoryObservedAt(existing?.observed_at),
      };
      // Append history first. If this throws, we haven't yet touched
      // the status row — emit writer.failed and let the caller decide.
      try {
        await pb.create(
          "status_history",
          history as unknown as Record<string, unknown>,
        );
      } catch (err) {
        const info = errorInfo(err);
        bus.emit("writer.failed", {
          key: result.key,
          phase: "history_create",
          err: serializeErr(info),
          reason: classifyWriterError(info),
          status: info.status,
          observedAt: result.observedAt,
        });
        throw err;
      }

      // Update `observed_at` on the status row even on error so the
      // dashboard reflects "we tried at this time", but leave state /
      // fail_count untouched so an error tick doesn't reset the flap
      // counter.
      //
      // F2.1: previously, when there was no existing row (first-ever
      // observation of a key is an error), we synthesized a seed row with
      // `state: carriedState` (defaulting to "green"). That created a
      // false baseline: the next real red observation would fire a
      // `green_to_red` transition despite never having observed green.
      // Fix: skip the seed write entirely. The first real, non-error
      // observation becomes the baseline and the transition detector
      // emits `"first"` — which is correct. Persistent probe errors are
      // still captured in status_history (above, with a placeholder
      // `state` when never observed — see F2b at the top of this branch)
      // and still emit `writer.failed` if history_create fails, so
      // operators retain full visibility into error ticks without
      // state-machine lies.
      //
      // F2.2: status.changed must only fire when a persisted transition
      // actually occurred. On the error path, the status row is either
      // touched (observed_at refresh) or skipped (first-ever error).
      // Emitting status.changed without persistence causes the alert
      // engine to treat a synthesized transition as real — a later
      // recovery's red_to_green would never fire because the "prev" was
      // never written. We now track whether a write was persisted and
      // only emit status.changed when it was.
      // A4 (round 3): same monotonic + unparseable discipline as the
      // overlay path's F2f guard. aggregateCommError's no-data fallback
      // feeds a reclaim-time (potentially stale) observedAt into this
      // path, and an unguarded refresh could rewind a live row's
      // observed_at; an unparseable incoming value would 400 in PB's date
      // field (checked above the history create — A1 round 5). Skips leave
      // `persisted=false`, so status.changed is not emitted (F2.2: emit
      // only what was persisted).
      let persisted = false;
      if (existing?.id && safeIncomingObservedAt !== undefined) {
        const currentObservedMs = Date.parse(existing.observed_at);
        if (
          Number.isFinite(currentObservedMs) &&
          incomingObservedMs < currentObservedMs
        ) {
          logger.debug("status-writer.error-stale-observed-at", {
            key: result.key,
            observedAt: result.observedAt,
            currentObservedAt: existing.observed_at,
          });
        } else {
          try {
            await pb.update("status", existing.id, {
              observed_at: safeIncomingObservedAt,
            });
            persisted = true;
          } catch (err) {
            // Best-effort: the history row is already written, so we
            // still emit writer.failed but swallow the throw so callers
            // don't see an error for a non-critical field update. Leave
            // `persisted=false` so we skip the status.changed emit below.
            const info = errorInfo(err);
            const reason = classifyWriterError(info);
            bus.emit("writer.failed", {
              key: result.key,
              phase: "status_upsert",
              err: serializeErr(info),
              reason,
              status: info.status,
              observedAt: result.observedAt,
            });
            logger.warn("status-writer.error-observed-at-update-failed", {
              key: result.key,
              err: info.message,
              status: info.status,
              reason,
            });
          }
        }
      }
      if (!existing) {
        // First-ever observation of this key is an error. We deliberately
        // do NOT seed a status row — see F2.1 above. The history entry is
        // sufficient for audit; the first non-error observation will
        // establish the baseline correctly.
        //
        // A6(ii) (round 5): the skip previously left NO log line — a key
        // whose first observations are persistent errors was an alerting
        // blind spot (no row, no status.changed, nothing in logs). Deduped
        // warn so the blind spot is observable without per-tick spam.
        //
        // Round-8 #6: gate on `!existing`, NOT `!existing?.id` — an
        // existing row missing its (optional) id also skips the refresh
        // above (nothing to update), but a "first-ever observation" warn
        // for it would be a lie: a row exists.
        warnDeduped("status-writer.error-first-ever-skip", result.key, {
          key: result.key,
          observedAt: result.observedAt,
          hint: "first-ever observation of this key is an error — no status row seeded (F2.1); the history row is the only persisted trace",
        });
      }

      // HF13-B2: the error branch used to return `newState: carriedState`
      // (the prior State), which meant downstream consumers branching on
      // `outcome.newState === "error"` never fired for live-write errors
      // — only dispatchCronAlert's synthesized outcomes did. Now we
      // return `"error"` uniformly, and carry the prior State via the
      // new optional `errorStatePrev` so dashboards that need to keep
      // rendering the last-known colour still have it.
      //
      // F2a: errorStatePrev is `prevState ?? null`, NEVER the carried
      // "green" default — the WriteOutcome contract (types/index.ts)
      // documents null as "no prior observation (first-ever tick is an
      // error)", and the CLI bestEffortWriter honors that. Fabricating a
      // never-observed green here would lie to dashboards the same way
      // the F2.1 seed row lied to the transition detector.
      // A2 (round 4): `persisted` is stamped truthfully — false on the
      // three non-persisted exits above (first-ever error with no row,
      // stale/unparseable skip, swallowed pb.update failure), true only
      // when the observed_at refresh actually landed. The status.changed
      // gate below keys off the same flag (F2.2).
      const outcome: WriteOutcome = {
        previousState: prevState,
        newState: "error",
        errorStatePrev: prevState,
        transition: "error",
        persisted,
        // Truthiness (`||`), NOT nullish coalescing (A1): PocketBase
        // serializes an UNSET date field as "" (see
        // StatusRecord.first_failure_at in types/index.ts), and the
        // WriteOutcome contract documents null as the no-failure sentinel
        // — "" must never surface to consumers.
        firstFailureAt: existing?.first_failure_at || null,
        failCount: existing?.fail_count ?? 0,
      };
      // Only emit status.changed when the DB write was persisted. If
      // the observed_at update failed, or we didn't write anything
      // (first-ever error), skip the emit so the alert engine and bus
      // don't diverge from durable storage.
      if (persisted) {
        bus.emit("status.changed", { outcome, result });
      }
      return outcome;
    }

    const newState: State = result.state;

    // A5 (round 5): the durable upsert writes result.observedAt into
    // observed_at / transitioned_at / state_written_at — all PB date fields
    // — so an unparseable incoming value 400s the upsert (and, before the
    // A1 hoist, 400'd the history create first). Same skip-and-warn posture
    // as the error/overlay paths: the history row lands with a safe
    // substituted timestamp so the tick stays auditable, the durable upsert
    // is skipped, `persisted` stays honest (false), and status.changed is
    // not emitted (F2.2 — emit only what was persisted). Deliberately NO
    // monotonic/backdated guard here: backdated durable writes are accepted
    // by design (at-least-once delivery — a late-arriving result is still a
    // real observation of durable state). Round-8 #1: PB-safety is decided
    // by toPbSafeDate (PB shape or normalized ISO), not bare Date.parse.
    const safeObservedAt = toPbSafeDate(result.observedAt);
    if (safeObservedAt === undefined) {
      // A6(i): deduped — a broken probe feeds garbage every tick.
      warnDeduped("status-writer.durable-unparseable-observed-at", result.key, {
        key: result.key,
        observedAt: result.observedAt,
        currentObservedAt: existing?.observed_at,
        hint: "incoming durable-write observedAt is unparseable — landing the history row with a substituted timestamp and skipping the durable upsert (PB would 400 on a non-date value)",
      });
      const skippedHistory: StatusHistoryRecord = {
        key: result.key,
        dimension: deriveDimensionWithWarn(result.key),
        state: newState,
        // A3 (round 6): NOT the computed transition. The durable row never
        // changed (the upsert is skipped below), so a history row claiming
        // green_to_red etc. is a PHANTOM transition — repeated broken ticks
        // accumulate identical "transitions" and auditors counting
        // status_history flips see flaps that never happened. "error" is the
        // established non-persisted posture (F2e — see types/index.ts).
        transition: "error",
        signal: result.signal,
        observed_at: safeHistoryObservedAt(existing?.observed_at),
      };
      try {
        await pb.create(
          "status_history",
          skippedHistory as unknown as Record<string, unknown>,
        );
      } catch (err) {
        const info = errorInfo(err);
        bus.emit("writer.failed", {
          key: result.key,
          phase: "history_create",
          err: serializeErr(info),
          reason: classifyWriterError(info),
          status: info.status,
          observedAt: result.observedAt,
        });
        throw err;
      }
      // A2 (round 7): the outcome matches its own history row, not the
      // write that never happened. The durable row is UNCHANGED, so the
      // computed transition (e.g. green_to_red) would describe a flip the
      // row never made — transition:"error" is the non-persisted posture
      // (F2e), exactly what the skippedHistory row above records.
      // `newState` stays the OBSERVED (non-persisted) colour, matching the
      // history row's `state`; `persisted: false` says it never landed.
      // Round-9 #4: errorStatePrev is stamped exactly like the error-state
      // path (HF13-B2 convention: transition "error" → errorStatePrev
      // carries the last-known durable colour, null when never observed) —
      // consumers branching on that convention previously missed this exit.
      return {
        previousState: prevState,
        newState,
        errorStatePrev: prevState,
        transition: "error",
        firstFailureAt: existing?.first_failure_at || null,
        failCount: existing?.fail_count ?? 0,
        persisted: false,
      };
    }

    const nowRed = newState === "red" || newState === "degraded";
    const wasRed = prevState === "red" || prevState === "degraded";

    let failCount = existing?.fail_count ?? 0;
    if (nowRed) failCount = wasRed ? failCount + 1 : 1;
    else failCount = 0;

    // Truthiness (`||`), NOT nullish coalescing (A1): PocketBase serializes
    // an UNSET date field as "" (the same bug class fixed for
    // state_written_at above). A post-migration legacy row therefore carries
    // `first_failure_at: ""`, and `"" ?? null` is "" — so the B8
    // legacy-row detection below (`firstFailureAt === null`) never fired in
    // production, and "" leaked into WriteOutcome.firstFailureAt in
    // violation of its documented null sentinel.
    let firstFailureAt: string | null = existing?.first_failure_at || null;
    if (transition === "green_to_red" || transition === "first") {
      firstFailureAt = nowRed ? safeObservedAt : null;
    } else if (transition === "red_to_green") {
      firstFailureAt = null;
    } else if (transition === "sustained_red" && firstFailureAt === null) {
      // Legacy record: status row exists and is red, but has no
      // first_failure_at. Adopting `result.observedAt` would understate
      // the true duration — the failure started at some earlier tick,
      // not now. Leave it null and log so operators can spot the
      // orphaned legacy row; the dashboard's "red for N minutes" widget
      // will render blank until a red_to_green cycle resets the row.
      // Rate-limited per key with a 1h TTL (B8) — the old unbounded Set
      // suppressed forever. Note (round-7 A3): legacyWarnGate.clear (on
      // recovery below) matters only for FOREIGN partial writes — a
      // red→green→red cycle through THIS writer can't reach this branch
      // again, because our own green_to_red stamps first_failure_at. A
      // foreign writer re-reddening the row without stamping it re-warns
      // immediately on its next sustained_red tick; the TTL governs
      // SUSTAINED red only, re-warning a row that never recovers once the
      // hour lapses.
      if (legacyWarnGate.shouldWarn(result.key, Date.now())) {
        logger.warn("status-writer.legacy-missing-first-failure", {
          key: result.key,
          observedAt: result.observedAt,
        });
      }
    }

    // Truthiness (`||`), NOT nullish coalescing (A2 round 5 — third
    // instance of the `""` PB-date class): PocketBase serializes an UNSET
    // date field as "" (see StatusRecord.transitioned_at in types/index.ts),
    // so a legacy row with transitioned_at:"" propagated "" forward on
    // every sustained tick. Fall back to the tick's observedAt instead.
    const transitionedAt =
      transition === "sustained_red" || transition === "sustained_green"
        ? existing?.transitioned_at || safeObservedAt
        : safeObservedAt;

    const statusRecord: Omit<StatusRecord, "id"> = {
      key: result.key,
      dimension: deriveDimensionWithWarn(result.key),
      state: newState,
      signal: result.signal,
      observed_at: safeObservedAt,
      transitioned_at: transitionedAt,
      fail_count: failCount,
      first_failure_at: firstFailureAt,
      // Writer-identity stamp: attributes this durable state to the process
      // that wrote it. NOT stamped on the error path above — error ticks
      // refresh observed_at while preserving the prior durable state, so the
      // attribution must keep following the writer that produced that state.
      written_by: writtenBy,
      // Timestamp of this durable state write. Updated ONLY here (the
      // error path's observed_at refresh deliberately leaves it alone) so
      // it stays coupled to `written_by` — the cross-writer flip window
      // below is measured against it, not against observed_at.
      state_written_at: safeObservedAt,
    };

    const history: StatusHistoryRecord = {
      key: result.key,
      dimension: statusRecord.dimension,
      state: newState,
      transition,
      signal: result.signal,
      observed_at: safeObservedAt,
    };

    // A1 (round 7): UPSERT FIRST, history second — the same flip A4
    // (round 6) made for the overlay path, for the same reason. Under the
    // old history-first ordering, a persistent upsert failure re-landed
    // one audit history row per caller retry (the reject-and-retry
    // contract) — each retry created a history row claiming a transition
    // the durable row never made (a phantom flip), accumulating unbounded
    // in status_history. Upsert-first persists nothing on an upsert
    // failure, so retries are clean.
    //
    // The tradeoff (mirroring the overlay path's A4 note): on
    // upsert-success + history-fail the durable row has transitioned with
    // no matching audit row. Acceptable: the transition itself is not
    // lost (the durable row carries it and status.changed fires), the gap
    // is loud on both channels (writer.failed + warn below), and the next
    // tick's history row re-anchors the audit trail. The old
    // history-first rationale ("a history row with no status row
    // self-heals on the next tick") traded that debuggability for
    // unbounded duplicate phantom-transition growth.
    try {
      await pb.upsertByField(
        "status",
        "key",
        result.key,
        statusRecord as unknown as Record<string, unknown>,
      );
    } catch (err) {
      const info = errorInfo(err);
      bus.emit("writer.failed", {
        key: result.key,
        phase: "status_upsert",
        err: serializeErr(info),
        reason: classifyWriterError(info),
        status: info.status,
        observedAt: result.observedAt,
      });
      throw err;
    }

    // B8: a red→green recovery clears the legacy warn so the next red on
    // this key re-emits the warn. A5(ii): `!nowRed && wasRed` IS the
    // red_to_green condition by detectTransition's table (prev
    // red/degraded → next green), so the previous
    // `transition === "red_to_green" || (!nowRed && wasRed)` disjunction
    // was redundant — kept as the state-flag form to stay local to the
    // flags computed above. Round-9 #5: cleared AFTER the upsert PERSISTED
    // (it previously sat above the upsert, so a REJECTED recovery write
    // still re-armed the warn) — a rejected write is not a recovery; same
    // warn-after-persist discipline as the flip/foreign-write warns below.
    if (!nowRed && wasRed) {
      legacyWarnGate.clear(result.key);
    }

    // History second (see the A1 ordering note above): the audit row for a
    // durable write that DID land. A failure here does NOT rethrow — the
    // durable transition persisted, and a caller retry would re-write an
    // identical durable row just to chase the audit row. Loud on both
    // channels instead; the audit gap is bounded to this tick.
    try {
      await pb.create(
        "status_history",
        history as unknown as Record<string, unknown>,
      );
    } catch (err) {
      const info = errorInfo(err);
      bus.emit("writer.failed", {
        key: result.key,
        phase: "history_create",
        err: serializeErr(info),
        reason: classifyWriterError(info),
        status: info.status,
        observedAt: result.observedAt,
      });
      logger.warn("status-writer.history-create-failed", {
        key: result.key,
        err: info.message,
        status: info.status,
        hint: "durable status upsert persisted but its audit history row failed — the transition is live on the status row; the audit trail has a gap for this tick",
      });
    }

    // A1 (round 6): foreign-write detection for the old-image blind spot.
    // The row carries OUR stamp, but its state differs from what we
    // remember last durably writing for this key — a foreign writer (an
    // old-image legacy process doing a partial update that doesn't restamp
    // written_by) mutated the row under our identity. The cross-writer flip
    // detector below can never see this case (written_by === self), so this
    // heuristic is the only signal during the legacy coexistence window.
    // Checked AFTER the upsert persisted (consistent with the flip warn — a
    // rejected write is not evidence) and deduped per key with a 1h TTL
    // (A6(iv) round 7 — sustained fighting re-warns; see
    // foreignWriteWarnGate). A memory miss is silent (no false positives
    // across restarts).
    // Round-8 #5 (degrade-don't-trust): the comparison uses the VALIDATED
    // prior state (`prevState`, from readValidatedState above), never the
    // raw existing.state. A corrupt value under our own stamp is treated as
    // "no prior observation" — it already emitted the corrupt-state-read
    // warn, and double-warning it here would also leak a non-State value
    // into `foundState`. The cost: a foreign writer that CORRUPTS (rather
    // than flips) the state surfaces as corrupt-state-read only — a
    // deliberate trade, since that warn already points at the row.
    if (existing?.written_by === writtenBy) {
      const remembered = lastDurableStateByKey.get(result.key);
      if (
        remembered !== undefined &&
        prevState !== null &&
        prevState !== remembered &&
        foreignWriteWarnGate.shouldWarn(result.key, Date.now())
      ) {
        logger.warn("status-writer.foreign-write-detected", {
          key: result.key,
          writtenBy,
          rememberedState: remembered,
          foundState: prevState,
          newState,
          hint: "row state changed under our own written_by stamp — a foreign writer (likely an old-image partial update) mutated this key without restamping attribution, or another replica is misconfigured with the SAME writtenBy identity",
        });
      }
    }
    rememberDurableState(result.key, newState);

    // Cross-writer flip detection (anti-dual-writer hardening): this write
    // just persisted a green<->red flip over a durable state that a
    // DIFFERENT writer produced recently — the signature of two schedulers
    // fighting over one key (the dual-scheduler "flap comb" incident).
    // Observability only: we warn AFTER the upsert persisted (a rejected
    // write is not a fight) and never block or reject. An absent previous
    // `written_by` (pre-migration row / old image) is unattributable, so it
    // never warns; the same writer flipping its own key is a legitimate
    // state change.
    //
    // The window is measured against the previous DURABLE STATE write
    // (`state_written_at`), NOT `observed_at`: the error path refreshes
    // observed_at without restamping written_by, so windowing on
    // observed_at decouples the timestamp from the attribution and
    // fabricates fights (writer A's months-old durable state + any
    // writer's recent error tick + writer B's flip). Pre-migration rows
    // lack state_written_at; falling back to observed_at there is
    // conservative — it can still false-positive on the error-tick
    // scenario for legacy rows, but only until the next durable write
    // stamps the field. The explicit `>= 0` lower bound rejects
    // backdated observations (clock skew / replays), which previously
    // always satisfied the upper bound alone. Timestamps come from the
    // probes' clocks, so the check is clock-skew-tolerant per writer
    // pair only to the extent the probes themselves are — good enough
    // for a warn.
    if (
      (transition === "green_to_red" || transition === "red_to_green") &&
      existing?.written_by &&
      existing.written_by !== writtenBy
    ) {
      // Truthiness (`||`), NOT nullish coalescing: PocketBase serializes an
      // UNSET date field as "" (never null/undefined — see StatusRecord's
      // `state_written_at?: string` in types/index.ts), so post-migration
      // legacy rows carry `state_written_at: ""`. `"" ?? x` is "" and
      // Date.parse("") is NaN, which silently disabled flip detection for
      // exactly the legacy-row population this fallback targets. Same
      // truthiness posture as the `existing?.written_by &&` guard above.
      const prevStateWrittenAt =
        existing.state_written_at || existing.observed_at;
      const prevWriteMs = Date.parse(prevStateWrittenAt);
      const thisWriteMs = Date.parse(result.observedAt);
      const deltaMs = thisWriteMs - prevWriteMs;
      // A5 (round 6): only prevStateWrittenAt can be unparseable here — the
      // durable path already returned early on an unparseable incoming
      // observedAt (the durable-skip branch above), so thisWriteMs is
      // always finite and the old `|| !Number.isFinite(thisWriteMs)`
      // disjunct was dead code.
      if (!Number.isFinite(prevWriteMs)) {
        // An unparseable windowed prevStateWrittenAt silently disables flip
        // detection for this write — make that loud so a
        // malformed-timestamp source is diagnosable instead of just "the
        // warn never fired". WARN, not debug (debug is filtered in prod,
        // which kept the silent disablement silent). Round-8 #2: TTL'd
        // dedup (same gate posture as the legacy/foreign-write warns) —
        // "flip candidates only" is NOT rate-limiting in a SUSTAINED
        // dual-writer fight (the exact scenario this warn targets), where
        // every tick is a flip candidate and the undeduped warn fired
        // indefinitely.
        if (flipUnparseableWarnGate.shouldWarn(result.key, Date.now())) {
          logger.warn("status-writer.cross-writer-flip-unparseable-timestamp", {
            key: result.key,
            previousStateWrittenAt: prevStateWrittenAt,
            previousObservedAt: existing.observed_at,
            observedAt: result.observedAt,
          });
        }
      } else if (deltaMs >= 0 && deltaMs <= crossWriterFlipWindowMs) {
        logger.warn("status-writer.cross-writer-flip", {
          key: result.key,
          previousWriter: existing.written_by,
          currentWriter: writtenBy,
          previousState: prevState,
          newState,
          transition,
          previousStateWrittenAt: prevStateWrittenAt,
          previousObservedAt: existing.observed_at,
          observedAt: result.observedAt,
          windowMs: crossWriterFlipWindowMs,
        });
      }
    }

    const outcome: WriteOutcome = {
      previousState: prevState,
      newState,
      transition,
      firstFailureAt,
      failCount,
      // A2: the upsert above either succeeded or threw out of doWrite —
      // reaching this line means the durable write persisted.
      persisted: true,
    };
    bus.emit("status.changed", { outcome, result });
    logger.debug("status-writer.write", { key: result.key, transition });
    return outcome;
  }

  /**
   * H1 overlay path — see the {@link StatusWriter.writeOverlay} contract.
   * A field-scoped `pb.update` (signal + observed_at ONLY) so the row's
   * durable state, attribution and counters are untouched, then the audit
   * history row (A4 round 6: update FIRST, history second — see the
   * ordering note inside). No transition detection, no `status.changed`,
   * no cross-writer-flip bookkeeping.
   */
  async function doWriteOverlay(
    overlay: OverlayWrite,
  ): Promise<OverlayWriteOutcome> {
    const existing = await pb.getFirst<StatusRecord>(
      "status",
      `key = ${JSON.stringify(overlay.key)}`,
    );
    if (!existing?.id) {
      // Nothing to overlay — never persist anything for a never-observed key
      // (callers route these through the error-state write() path, which is
      // history-only and never fabricates a row).
      return { applied: false, state: null, historyPersisted: false };
    }

    const baseSignal =
      existing.signal &&
      typeof existing.signal === "object" &&
      !Array.isArray(existing.signal)
        ? (existing.signal as Record<string, unknown>)
        : {};
    const mergedSignal = { ...baseSignal, ...overlay.signal };

    // A4: validate the row's state before echoing it anywhere.
    // status_history.state is a required select (green|red|degraded), so a
    // corrupt read-back written through verbatim made PB 400 the history
    // create and the whole overlay was lost. Unknown state → "green"
    // schema placeholder in the history row (same F2b posture as the
    // error path: a placeholder satisfying the schema, never a baseline)
    // and a null outcome.state.
    const preservedState = readValidatedState(overlay.key, existing);

    // A1 (round 5): the unparseable-observedAt check sits ABOVE both
    // persistence calls — under the old history-first ordering a guard
    // below the history create was dead code (status_history.observed_at
    // is a required PB date field, so the raw garbage value 400'd the
    // history create first and the whole overlay attempt was lost). The
    // history row lands with a safe substituted timestamp; the observed_at
    // patch is skipped below.
    // Round-8 #1: PB-safety is decided by toPbSafeDate (PB shape or
    // normalized ISO), not bare Date.parse — see the PB_DATE_SHAPE note.
    const currentObservedMs = Date.parse(existing.observed_at);
    const incomingObservedMs = Date.parse(overlay.observedAt);
    const safeIncomingObservedAt = toPbSafeDate(overlay.observedAt);
    if (safeIncomingObservedAt === undefined) {
      // A6(i): deduped — a broken caller feeds garbage every tick.
      warnDeduped(
        "status-writer.overlay-unparseable-observed-at",
        overlay.key,
        {
          key: overlay.key,
          observedAt: overlay.observedAt,
          currentObservedAt: existing.observed_at,
          hint: "incoming overlay observedAt is unparseable — landing the history row with a substituted timestamp and the signal merge, but skipping the observed_at refresh (PB would 400 on a non-date value)",
        },
      );
    }

    // A4 (round 6): UPDATE FIRST, history second — the REVERSE of doWrite's
    // history-first ordering. History-first (the old rationale: "the overlay
    // stays auditable even if the row update fails") meant a persistent
    // non-404 pb.update failure re-landed one audit history row per consumer
    // retry, UNBOUNDED — each retry created history, then failed the update
    // again. Update-first persists nothing on an update failure, so retries
    // are clean. The tradeoff: on update-success + history-fail we have a
    // live row carrying an overlay with no matching audit row — acceptable
    // because the comm error is on the live row's SIGNAL (not silently
    // dropped), the gap is reported via historyPersisted:false +
    // writer.failed, and the next durable tick supersedes the row anyway.
    //
    // Field-scoped update: signal + observed_at ONLY. Everything else —
    // state, written_by, state_written_at, fail_count, first_failure_at,
    // transitioned_at — keeps following the writer that produced the durable
    // state. In particular state_written_at must NOT move: an overlay is not
    // a durable state write, and the cross-writer flip window is measured
    // against state_written_at, so restamping it here would fabricate
    // "recent durable write" evidence out of a mere overlay.
    //
    // F2f: observed_at is monotonic. A reclaim-time observedAt can be STALE
    // (captured before a fresher tick already refreshed the row), and
    // rewinding observed_at would make the dashboard report an older "we
    // tried at this time" than reality. Only refresh when the incoming
    // value is >= the row's current observed_at; the overlay signal lands
    // either way.
    //
    // A3 (round 3) / A1 (round 5): an UNPARSEABLE incoming observedAt
    // (checked + warned above the history create) must NOT "skip the guard
    // and refresh" — that patches the garbage string into PB's `observed_at`
    // DATE field, PB rejects with a 400, writer.failed fires and the throw
    // loses the caller's whole overlay attempt. Instead the signal merge
    // lands and only the observed_at patch is skipped. The opposite
    // direction — the ROW's current observed_at is unparseable but the
    // incoming one is valid — refreshes, repairing the corrupt row value.
    const patch: Record<string, unknown> = { signal: mergedSignal };
    if (
      safeIncomingObservedAt !== undefined &&
      (!Number.isFinite(currentObservedMs) ||
        incomingObservedMs >= currentObservedMs)
    ) {
      patch.observed_at = safeIncomingObservedAt;
    }
    // else: unparseable or stale incoming timestamp — signal lands,
    // timestamp not patched/rewound.
    try {
      await pb.update("status", existing.id, patch);
    } catch (err) {
      const info = errorInfo(err);
      const reason = classifyWriterError(info);
      // A3 (round 4): TOCTOU — the row was deleted between getFirst above
      // and this field-scoped update, so PB 404s. That is the documented
      // row-miss outcome ({ applied: false, state: null } routes the
      // caller through the error-state write() fallback), NOT a writer
      // failure: degrade instead of rejecting the whole overlay.
      if (reason === "pb_not_found") {
        logger.warn("status-writer.overlay-row-vanished", {
          key: overlay.key,
          rowId: existing.id,
          observedAt: overlay.observedAt,
          hint: "status row deleted between read and update — degrading to the never-observed fallback (applied: false); nothing persisted",
        });
        // A4 (round 6): update-first ordering — NOTHING persisted on this
        // leg (no history row preceded the failed update), so
        // historyPersisted is false and the caller's fallback error-write
        // legitimately records the tick (exactly one history row).
        return { applied: false, state: null, historyPersisted: false };
      }
      // Non-404 failure: rethrow with NOTHING persisted (update-first), so
      // a consumer retry cannot accumulate duplicate audit rows (A4).
      bus.emit("writer.failed", {
        key: overlay.key,
        phase: "status_upsert",
        err: serializeErr(info),
        reason,
        status: info.status,
        observedAt: overlay.observedAt,
      });
      throw err;
    }

    // History second (see the A4 ordering note above): the audit row for an
    // overlay that DID land. Transition "error" matches the error path — an
    // overlay is a surfaced failure-to-observe, not a state transition.
    const history: StatusHistoryRecord = {
      key: overlay.key,
      dimension: deriveDimensionWithWarn(overlay.key),
      state: preservedState ?? "green",
      transition: "error",
      signal: mergedSignal,
      observed_at:
        safeIncomingObservedAt ?? safeHistoryObservedAt(existing.observed_at),
    };
    try {
      await pb.create(
        "status_history",
        history as unknown as Record<string, unknown>,
      );
    } catch (err) {
      // A4 (round 6): the overlay already landed on the live row — do NOT
      // rethrow (a retry would re-merge an identical signal just to chase
      // the audit row). Loud on both channels (bus + warn), and the outcome
      // reports the audit gap truthfully via historyPersisted:false. The
      // comm error itself is not dropped: it lives on the row's signal.
      const info = errorInfo(err);
      bus.emit("writer.failed", {
        key: overlay.key,
        phase: "history_create",
        err: serializeErr(info),
        reason: classifyWriterError(info),
        status: info.status,
        observedAt: overlay.observedAt,
      });
      logger.warn("status-writer.overlay-history-create-failed", {
        key: overlay.key,
        err: info.message,
        status: info.status,
        hint: "overlay landed on the status row but its audit history row failed — historyPersisted:false on the outcome",
      });
      return { applied: true, state: preservedState, historyPersisted: false };
    }

    logger.debug("status-writer.write-overlay", {
      key: overlay.key,
      preservedState,
    });
    return { applied: true, state: preservedState, historyPersisted: true };
  }

  return {
    async write(result) {
      let outcome!: WriteOutcome;
      await runKeyed(result.key, async () => {
        outcome = await doWrite(result);
      });
      return outcome;
    },
    async writeOverlay(overlay) {
      let outcome!: OverlayWriteOutcome;
      await runKeyed(overlay.key, async () => {
        outcome = await doWriteOverlay(overlay);
      });
      return outcome;
    },
  };
}
