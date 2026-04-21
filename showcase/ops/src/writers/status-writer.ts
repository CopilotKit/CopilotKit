import type { TypedEventBus } from "../events/event-bus.js";
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
 * fast consecutive probes for the same key (§10 concurrency note).
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
  const warnedMalformedKeys = new Set<string>();
  // Same dedupe for the legacy-missing-first-failure warn — legacy rows
  // can persist for days until a red_to_green cycle clears them, and a
  // per-tick warn would drown operators.
  const warnedLegacyFailureKeys = new Set<string>();
  function deriveDimensionWithWarn(key: string): string {
    const idx = key.indexOf(":");
    if (idx > 0) return key.slice(0, idx);
    if (!warnedMalformedKeys.has(key)) {
      warnedMalformedKeys.add(key);
      logger.warn("status-writer.malformed-key", {
        key,
        hint: "expected <dimension>:<slug> — dimension will be recorded as 'unknown'",
      });
    }
    return "unknown";
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
        bus.emit("writer.failed", {
          key: result.key,
          phase: "history_create",
          err: String(err),
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
          bus.emit("writer.failed", {
            key: result.key,
            phase: "status_upsert",
            err: String(err),
            observedAt: result.observedAt,
          });
          logger.warn("status-writer.error-observed-at-update-failed", {
            key: result.key,
            err: String(err),
          });
        }
      }
      // else: first-ever observation of this key is an error. We
      // deliberately do NOT seed a status row — see F2.1 above. The
      // history entry is sufficient for audit; the first non-error
      // observation will establish the baseline correctly.

      const outcome: WriteOutcome = {
        previousState: prevState,
        newState: carriedState,
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
      // Rate-limited per key so a long-lived legacy row doesn't flood
      // logs every tick.
      if (!warnedLegacyFailureKeys.has(result.key)) {
        warnedLegacyFailureKeys.add(result.key);
        logger.warn("status-writer.legacy-missing-first-failure", {
          key: result.key,
          observedAt: result.observedAt,
        });
      }
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
      bus.emit("writer.failed", {
        key: result.key,
        phase: "history_create",
        err: String(err),
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
      bus.emit("writer.failed", {
        key: result.key,
        phase: "status_upsert",
        err: String(err),
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

