import type {
  TypedEventBus,
  WriterFailureReason,
} from "../events/event-bus.js";
import { detectTransition } from "../events/transition-detector.js";
import type { PbClient } from "../storage/pb-client.js";
import type {
  Logger,
  ProbeResult,
  State,
  StatusHistoryRecord,
  StatusRecord,
  WriteOutcome,
} from "../types/index.js";

/**
 * SINGLE-WRITER INVARIANT (B5)
 * ---------------------------------------------------------------------
 * Per-key writes are serialized by `makeKeyedMutex()` below, so for any
 * given `result.key` the DB row's persisted state matches the
 * `statusRecord` this writer computed on the very last successful
 * `pb.upsertByField` call. Consumers of `status.changed` can therefore
 * treat the payload's `outcome` as the write intent AND the durable
 * state after emit — we do NOT re-read the row to confirm, because under
 * the single-writer invariant no other process mutates `status` rows.
 *
 * If that invariant is ever broken (a second writer, a manual PB admin
 * edit, an out-of-band migration), the `outcome.previousState` /
 * `outcome.failCount` emitted here can diverge from the row persisted
 * in PB. The B5 finding flagged this; keeping the invariant documented
 * here lets reviewers catch future code that would violate it.
 *
 * The error-path already guards this correctly (F2.2): `status.changed`
 * is only emitted when the observed_at write persisted. The success
 * path doesn't need the same guard because the upsert's throw bubbles
 * out of `doWrite` before we reach the emit — so there's no silent
 * bus/DB divergence even on failure.
 */

// Bound on the warn-dedupe Sets so a broken probe producing a stream of
// distinct keys (thousands of one-shot probe-keys) can't OOM the process
// over its lifetime. The malformed-key set is drop-oldest (LRU-ish
// insertion order); the legacy-failure set uses TTL so a red→green→red
// cycle re-warns the operator on the second red. (B4, B8)
const MAX_WARNED_KEYS = 1024;
const LEGACY_WARN_TTL_MS = 60 * 60 * 1000; // 1h

// See PocketBase error shape — PB emits validation errors as
// `{ data: { <field>: { code, message } } }` on 400s. Bare String(err)
// collapses the object to "[object Object]" and erases the reason.
// R21 bucket-a: PbHttpError (pb-client.ts) exposes the HTTP code as
// `statusCode`, but the historical PB SDK error shape uses `status`.
// errorInfo reads whichever is present so classifyWriterError can
// route 401/403/429/5xx correctly regardless of the error source.
interface MaybePbError {
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  data?: unknown;
}

export interface WriterErrorInfo {
  message: string;
  status?: number;
  /** Preserved only when PB returns a validation shape (400). */
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
  if (err instanceof Error) {
    const { message } = err;
    const maybe = err as unknown as MaybePbError;
    const info: WriterErrorInfo = { message };
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
          : safeJson(err) ?? String(err),
    };
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
function serializeErr(info: WriterErrorInfo): string {
  const payload: Record<string, unknown> = { message: info.message };
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
  if (status !== undefined && status >= 500 && status < 600) {
    return "pb_server_error";
  }
  // All PB 400s route to `pb_schema_error` — the WriterFailureReason union
  // (see event-bus.ts) has no narrower bad-request bucket, and in practice
  // every PB 400 we see is a validation/schema shape error.
  if (status === 400) return "pb_schema_error";
  // No HTTP status — fetch-level error or thrown from outside PB.
  const lower = message.toLowerCase();
  if (
    lower.includes("fetch failed") ||
    lower.includes("econn") ||
    lower.includes("abort") ||
    lower.includes("enotfound") ||
    lower.includes("network")
  ) {
    return "network_error";
  }
  if (lower.includes("validation_not_unique") || lower.includes("is not unique")) {
    return "pb_schema_error";
  }
  return "unknown";
}

/**
 * Bounded set that drops the oldest entry on overflow. `Set<string>`
 * iterates in insertion order, so `next().value` on keys() is the
 * oldest — same LRU-ish pattern as useLastTransition.ts's rowCache.
 * Not a true LRU (no move-to-end on re-insertion) because we only
 * `add` keys we haven't seen, so each key enters the set exactly once
 * before being evicted.
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
}

export interface StatusWriterDeps {
  pb: PbClient;
  bus: TypedEventBus;
  logger: Logger;
}

/**
 * Keyed mutex: per-key serialization of writes, preventing upsert races on
 * fast consecutive probes for the same key. Single-writer invariant holds
 * across the process; this keyed mutex additionally guards in-process
 * TOCTOU between the read-current-row and the upsert for the same key.
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
  const runKeyed = makeKeyedMutex();

  // Once-per-key dedupe for the malformed-key warn so a persistently
  // broken probe doesn't fill logs with the same message each tick.
  // Bounded (B4): drop-oldest on overflow so a pathological probe
  // emitting a stream of distinct malformed keys can't OOM us.
  const warnedMalformedKeys = new Set<string>();
  // Same dedupe for the legacy-missing-first-failure warn — legacy rows
  // can persist for days until a red_to_green cycle clears them, and a
  // per-tick warn would drown operators. Value is the firstSeenAt
  // timestamp so we can TTL-evict (B8); a red→green→red cycle after
  // the TTL re-warns on the second red so recurring structural issues
  // don't go silent.
  const warnedLegacyFailureKeys = new Map<string, number>();
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

  /** B8: TTL helper — returns true if the warn should fire (and records it). */
  function shouldWarnLegacy(key: string, now: number): boolean {
    const firstSeenAt = warnedLegacyFailureKeys.get(key);
    if (firstSeenAt !== undefined && now - firstSeenAt < LEGACY_WARN_TTL_MS) {
      return false;
    }
    // Bound the Map the same way as warnedMalformedKeys so this can't
    // grow without limit either (B4 sibling).
    while (warnedLegacyFailureKeys.size >= MAX_WARNED_KEYS) {
      const oldest = warnedLegacyFailureKeys.keys().next().value;
      if (oldest === undefined) break;
      warnedLegacyFailureKeys.delete(oldest);
    }
    warnedLegacyFailureKeys.set(key, now);
    return true;
  }

  /** B8: green transition clears any legacy-warn entry so the next red re-warns. */
  function clearLegacyWarn(key: string): void {
    warnedLegacyFailureKeys.delete(key);
  }

  async function doWrite(result: ProbeResult<unknown>): Promise<WriteOutcome> {
    const existing = await pb.getFirst<StatusRecord>(
      "status",
      `key = ${JSON.stringify(result.key)}`,
    );
    const prevState: State | null = existing?.state ?? null;
    const transition = detectTransition(prevState, result.state);

    if (result.state === "error") {
      const carriedState: State = prevState ?? "green";
      const history: StatusHistoryRecord = {
        key: result.key,
        dimension: deriveDimensionWithWarn(result.key),
        state: carriedState,
        transition: "error",
        signal: result.signal,
        observed_at: result.observedAt,
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
      // still captured in status_history (above) and still emit
      // `writer.failed` if history_create fails, so operators retain
      // full visibility into error ticks without state-machine lies.
      //
      // F2.2: status.changed must only fire when a persisted transition
      // actually occurred. On the error path, the status row is either
      // touched (observed_at refresh) or skipped (first-ever error).
      // Emitting status.changed without persistence causes the alert
      // engine to treat a synthesized transition as real — a later
      // recovery's red_to_green would never fire because the "prev" was
      // never written. We now track whether a write was persisted and
      // only emit status.changed when it was.
      let persisted = false;
      if (existing?.id) {
        try {
          await pb.update("status", existing.id, {
            observed_at: result.observedAt,
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
      // else: first-ever observation of this key is an error. We
      // deliberately do NOT seed a status row — see F2.1 above. The
      // history entry is sufficient for audit; the first non-error
      // observation will establish the baseline correctly.

      // HF13-B2: the error branch used to return `newState: carriedState`
      // (the prior State), which meant downstream consumers branching on
      // `outcome.newState === "error"` never fired for live-write errors
      // — only dispatchCronAlert's synthesized outcomes did. Now we
      // return `"error"` uniformly, and carry the prior State via the
      // new optional `errorStatePrev` so dashboards that need to keep
      // rendering the last-known colour still have it.
      const outcome: WriteOutcome = {
        previousState: prevState,
        newState: "error",
        errorStatePrev: carriedState,
        transition: "error",
        firstFailureAt: existing?.first_failure_at ?? null,
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
    const nowRed = newState === "red" || newState === "degraded";
    const wasRed = prevState === "red" || prevState === "degraded";

    let failCount = existing?.fail_count ?? 0;
    if (nowRed) failCount = wasRed ? failCount + 1 : 1;
    else failCount = 0;

    let firstFailureAt: string | null = existing?.first_failure_at ?? null;
    if (transition === "green_to_red" || transition === "first") {
      firstFailureAt = nowRed ? result.observedAt : null;
    } else if (transition === "red_to_green") {
      firstFailureAt = null;
    } else if (transition === "sustained_red" && firstFailureAt === null) {
      // Legacy record: status row exists and is red, but has no
      // first_failure_at. Adopting `result.observedAt` would understate
      // the true duration — the failure started at some earlier tick,
      // not now. Leave it null and log so operators can spot the
      // orphaned legacy row; the dashboard's "red for N minutes" widget
      // will render blank until a red_to_green cycle resets the row.
      // Rate-limited per key with a 1h TTL (B8) so recurring legacy
      // cycles (red → green → red) re-warn on the second red once the
      // TTL lapses — the old unbounded Set suppressed forever.
      if (shouldWarnLegacy(result.key, Date.now())) {
        logger.warn("status-writer.legacy-missing-first-failure", {
          key: result.key,
          observedAt: result.observedAt,
        });
      }
    }

    // B8: any green transition clears the legacy warn so the next red
    // on this key re-emits the warn.
    if (transition === "red_to_green" || (!nowRed && wasRed)) {
      clearLegacyWarn(result.key);
    }

    const transitionedAt =
      transition === "sustained_red" || transition === "sustained_green"
        ? (existing?.transitioned_at ?? result.observedAt)
        : result.observedAt;

    const statusRecord: Omit<StatusRecord, "id"> = {
      key: result.key,
      dimension: deriveDimensionWithWarn(result.key),
      state: newState,
      signal: result.signal,
      observed_at: result.observedAt,
      transitioned_at: transitionedAt,
      fail_count: failCount,
      first_failure_at: firstFailureAt,
    };

    const history: StatusHistoryRecord = {
      key: result.key,
      dimension: statusRecord.dimension,
      state: newState,
      transition,
      signal: result.signal,
      observed_at: result.observedAt,
    };

    // IMPORTANT: write history BEFORE the status row. If pb.create on
    // status_history fails, we just drop the update cleanly. If we did
    // it the other way around and history failed after status succeeded,
    // we'd have a status row with no corresponding history entry — a
    // strictly harder shape to debug than "history row with no matching
    // status row" (which self-heals on the next probe tick).
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

    const outcome: WriteOutcome = {
      previousState: prevState,
      newState,
      transition,
      firstFailureAt,
      failCount,
    };
    bus.emit("status.changed", { outcome, result });
    logger.debug("status-writer.write", { key: result.key, transition });
    return outcome;
  }

  return {
    async write(result) {
      let outcome!: WriteOutcome;
      await runKeyed(result.key, async () => {
        outcome = await doWrite(result);
      });
      return outcome;
    },
  };
}

