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
        dimension: deriveDimension(result.key),
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
      // counter. When there's no existing row yet, synthesize a minimal
      // status row with `state: carriedState` so state-tracking has a
      // starting point on subsequent ticks — otherwise every tick would
      // begin with `prevState=null` and the transition detector would
      // keep reporting `"first"` forever on persistent probe errors.
      if (existing?.id) {
        try {
          await pb.update("status", existing.id, {
            observed_at: result.observedAt,
          });
        } catch (err) {
          // Best-effort: the history row is already written, so we
          // still emit writer.failed but swallow the throw so callers
          // don't see an error for a non-critical field update.
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
      } else {
        // First-ever observation for this key is an error — bootstrap a
        // minimal row so state tracking is well-defined going forward.
        // fail_count=0 and first_failure_at=null because we don't know
        // whether the underlying dimension is red yet (probe errored
        // before producing a verdict).
        const seedRecord: Omit<StatusRecord, "id"> = {
          key: result.key,
          dimension: deriveDimension(result.key),
          state: carriedState,
          signal: result.signal,
          observed_at: result.observedAt,
          transitioned_at: result.observedAt,
          fail_count: 0,
          first_failure_at: null,
        };
        try {
          await pb.upsertByField(
            "status",
            "key",
            result.key,
            seedRecord as unknown as Record<string, unknown>,
          );
        } catch (err) {
          bus.emit("writer.failed", {
            key: result.key,
            phase: "status_upsert",
            err: String(err),
            observedAt: result.observedAt,
          });
          logger.warn("status-writer.error-seed-row-failed", {
            key: result.key,
            err: String(err),
          });
        }
      }

      const outcome: WriteOutcome = {
        previousState: prevState,
        newState: carriedState,
        transition: "error",
        firstFailureAt: existing?.first_failure_at ?? null,
        failCount: existing?.fail_count ?? 0,
      };
      bus.emit("status.changed", { outcome, result });
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
      logger.warn("status-writer.legacy-missing-first-failure", {
        key: result.key,
        observedAt: result.observedAt,
      });
    }

    const transitionedAt =
      transition === "sustained_red" || transition === "sustained_green"
        ? (existing?.transitioned_at ?? result.observedAt)
        : result.observedAt;

    const statusRecord: Omit<StatusRecord, "id"> = {
      key: result.key,
      dimension: deriveDimension(result.key),
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

function deriveDimension(key: string): string {
  const idx = key.indexOf(":");
  return idx > 0 ? key.slice(0, idx) : "unknown";
}
