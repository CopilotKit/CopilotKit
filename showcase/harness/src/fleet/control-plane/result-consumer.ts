/**
 * Control-plane RESULT CONSUMER (the worker->aggregator bridge).
 *
 * ── WHERE THIS SITS ────────────────────────────────────────────────────
 * The worker (S7) computes a per-service `ServiceJobResult` and REPORTs it
 * through the queue protocol; the queue-client (S3) persists that result onto
 * the now-terminal `probe_jobs` row (migration 1779989700: `result` +
 * `result_processed`). The worker writes NO authoritative dashboard status —
 * by design, only the CONTROL-PLANE does. This module is that control-plane
 * leg: it polls terminal rows carrying an UNPROCESSED result, hands each to the
 * S5 aggregator (which writes the authoritative status + run-history — the
 * dashboard contract), then LATCHES `result_processed = true` so the same
 * result is aggregated EXACTLY ONCE.
 *
 * ── CONSUME-ONCE MECHANISM ─────────────────────────────────────────────
 * The latch is a boolean column on the row, not an in-memory set, so the
 * once-only guarantee survives a control-plane restart (a result written while
 * the control-plane was down is still unprocessed on reboot and gets picked up).
 * We aggregate FIRST, then set the flag: if the flag write fails after a
 * successful aggregate, the worst case is a re-aggregate next tick. That
 * re-aggregate is a TRUE no-op: the aggregator is idempotent per `jobId` — it
 * stamps the originating job id onto its `probe_runs` row and short-circuits
 * when a terminal row for that job already exists, so a re-process does NOT
 * re-bump `fail_count`, does NOT append a duplicate `status_history` row, does
 * NOT mint a duplicate `probe_runs` row, and does NOT re-emit `status.changed`
 * (see result-aggregator.ts's idempotency gate). At-least-once with a
 * best-effort latch is therefore the safe failure mode. We never set the flag
 * BEFORE aggregating (that would risk dropping a result on an aggregate crash).
 *
 * ── ONLY THE CONTROL-PLANE WRITES AUTHORITATIVE STATUS ─────────────────
 * The aggregator is injected (S5 `ResultAggregator`), so this module owns no
 * PocketBase writes beyond the latch + the read poll. It is a thin, testable
 * orchestration over the injected PbClient + aggregator.
 */

import type { Logger, ProbeState, State } from "../../types/index.js";
import type { PbClient } from "../../storage/pb-client.js";
import type { JobView } from "../job-claim.js";
import { PROBE_JOBS_COLLECTION } from "../queue-client.js";
import type { PoolCommError, ServiceJobResult } from "../contracts.js";
import { isPoolCommErrorKind } from "../contracts.js";
import type { ResultAggregator } from "./result-aggregator.js";

/**
 * Read the CURRENT dashboard status-row colour for an aggregate key (REQ-B).
 * The result-lost leg calls this BEFORE writing the crash overlay so the
 * overlaid row PRESERVES the last observed colour (a `red` service whose worker
 * crashes mid-job stays `red` + unreachable) instead of routing the overlay to
 * history-only. Returns `undefined`/`null` for a never-observed key (no row), in
 * which case the aggregator writes the no-data ("error") path — never fabricated
 * green. Mirrors the control-plane's `PriorStateResolver`; kept as a local type
 * to avoid a consumer ↔ control-plane import cycle.
 */
export type ConsumerPriorStateResolver = (
  aggregateKey: string,
) => Promise<State | null | undefined> | State | null | undefined;

/** Max terminal rows scanned per consume cycle — bounds the poll cost. */
const CONSUME_PAGE = 50;

/**
 * Deterministic page sort for the consume poll. The grace Map prunes entries
 * not resolved this cycle, so the SAME rows must page consistently across
 * cycles — an unsorted query lets the >CONSUME_PAGE resultless backlog rotate
 * through the first page, starving entries beyond it (their grace timer resets
 * every cycle, so result-lost is never declared). Sort by `created` then `id`
 * (stable tiebreak) so the page is a stable prefix of the pending set.
 */
const CONSUME_SORT = "created,id";

/**
 * Anchor the PB space→"T" date-separator rewrite to the canonical PB shape
 * (`YYYY-MM-DD ` then time) so only the canonical date/time boundary is
 * normalized, never an arbitrary first space. Kept byte-for-byte consistent
 * with the JSVM hook (`fleet-claim.pb.js`) and the queue-client's
 * `leaseExpired` so every PB-timestamp parse in the fleet agrees.
 */
const PB_DATE_SEP_RE = /^(\d{4}-\d{2}-\d{2}) /;

/**
 * Grace window (ms) before a terminal-but-resultless row is latched processed.
 *
 * report() (queue-client) flips a row terminal via the release CAS FIRST, then
 * writes `result` + `result_processed:false` in a SEPARATE pb.update a few
 * milliseconds later. If the consumer scans in that window it sees an empty
 * `result` and, if it latched immediately, would drop the real result landing
 * right after (the dashboard then silently never updates). So we only latch a
 * resultless terminal row once this window has elapsed since the consumer FIRST
 * observed it resultless (a STABLE in-memory basis, NOT PB's `updated` mtime
 * which any later write resets); within it we leave the row unprocessed for the
 * next cycle to pick up the worker's result write. Sized well above the
 * report() inter-write gap.
 */
const RESULTLESS_GRACE_MS = 30_000;

/**
 * The known terminal aggregate states (== the `ProbeState` union). A result
 * carrying anything outside this set is garbage that must NOT flow into the
 * status state machine, so `decodeResult` rejects it at the boundary.
 */
const PROBE_STATES: ReadonlySet<ProbeState> = new Set<ProbeState>([
  "green",
  "red",
  "degraded",
  "error",
]);

/** The persisted `probe_jobs` row shape with the result-flow columns. */
interface ResultJobRecord extends JobView {
  result?: unknown;
  result_processed?: boolean;
  /**
   * PB's auto-maintained mtime. NO LONGER used as the resultless grace basis
   * (any later write resets it, so a touched row would never latch); the
   * consumer now tracks a stable in-memory first-seen time per jobId instead.
   * Retained on the read shape only for diagnostics.
   */
  updated?: string;
}

/** Outcome of one `consumeOnce()` cycle. */
export interface ConsumeResult {
  /** Rows whose result was aggregated + latched this cycle. */
  processed: number;
  /** Rows that errored during aggregate/latch (left unprocessed for retry). */
  failures: number;
}

export interface ResultConsumerDeps {
  pb: PbClient;
  aggregator: ResultAggregator;
  logger: Logger;
  /** Injectable clock for the resultless grace window. Defaults to Date.now. */
  now?: () => number;
  /**
   * [REQ-B] Read the current status-row colour for an aggregate key so the
   * result-lost crash overlay (the resultless-past-grace leg) PRESERVES the last
   * observed colour instead of routing the overlay to history-only. The sweep +
   * fleet-health legs in `control-plane.ts` already thread this; without it the
   * consumer leg omits `lastKnownState`, the aggregator falls back to "error",
   * and a previously-observed service's ⚡ "unreachable" overlay never lands on
   * the live status row the dashboard reads. Optional — when omitted, the leg
   * behaves as a never-observed key (no-data "error" path; never fabricates
   * green).
   */
  resolvePriorState?: ConsumerPriorStateResolver;
}

/** The control-plane's result-consumer — drives the aggregate-once cycle. */
export interface ResultConsumer {
  /**
   * Scan terminal rows carrying an unprocessed result, aggregate each exactly
   * once, and latch it processed. Returns per-cycle counts. Never throws — a
   * single bad row is logged and skipped so one poison result can't wedge the
   * whole consumer.
   */
  consumeOnce(): Promise<ConsumeResult>;
}

/**
 * Decode a row's `result` JSON into a typed `ServiceJobResult`. PB returns the
 * JSON column already-parsed. A structural check fails LOUD (caught by the
 * caller per-row) so a malformed result is skipped rather than dereferenced
 * deep in the aggregator.
 */
function decodeResult(jobId: string, raw: unknown): ServiceJobResult {
  if (raw === null || typeof raw !== "object") {
    throw new Error(`result-consumer: job ${jobId} has no decodable result`);
  }
  const c = raw as Partial<ServiceJobResult>;
  if (
    typeof c.jobId !== "string" ||
    typeof c.aggregateKey !== "string" ||
    typeof c.aggregateState !== "string" ||
    !Array.isArray(c.cells) ||
    c.rollup === undefined
  ) {
    throw new Error(
      `result-consumer: job ${jobId} result is missing required fields (jobId/aggregateKey/aggregateState/cells/rollup)`,
    );
  }
  // `aggregateState` is typed `ProbeState`, but the JSON column is untrusted: a
  // garbage string ("grene") satisfies the typeof-string check and would flow
  // straight into the status state machine. Validate against the known set and
  // fail LOUD at this boundary instead.
  if (!PROBE_STATES.has(c.aggregateState as ProbeState)) {
    throw new Error(
      `result-consumer: job ${jobId} result has invalid aggregateState "${c.aggregateState}" (expected one of ${[...PROBE_STATES].join("/")})`,
    );
  }
  // `rollup` rides the dashboard's ProbeRunSummary — its three counts must be
  // real numbers, not strings/NaN, or the aggregator math silently corrupts.
  const rollup = c.rollup as Partial<ServiceJobResult["rollup"]>;
  if (
    !Number.isFinite(rollup.total) ||
    !Number.isFinite(rollup.passed) ||
    !Number.isFinite(rollup.failed)
  ) {
    throw new Error(
      `result-consumer: job ${jobId} result has a non-numeric rollup (total/passed/failed must be finite numbers)`,
    );
  }
  // `commError` is OPTIONAL, but when present it rides the same untrusted JSON
  // column — a garbage value (bad `kind`, missing `message`/`observedAt`) would
  // satisfy the typeof-object check here, flow through aggregate() ->
  // withCommErrorOverlay -> commErrorToStatusSignal, and embed garbage under the
  // signal key; the dashboard's defensive `commErrorFromStatusSignal` then
  // rejects it -> SILENT LOSS (the very boundary this decoder exists to hold).
  // Validate it with the SAME checks that decoder uses (the shared
  // `isPoolCommErrorKind` guard + required string `message`/`observedAt` per the
  // `PoolCommError` contract; `workerId`/`jobId` are optional). A result with NO
  // commError stays valid; a present-but-malformed one fails LOUD here.
  if (c.commError !== undefined && c.commError !== null) {
    const e = c.commError as Partial<PoolCommError>;
    if (
      !isPoolCommErrorKind(e.kind) ||
      typeof e.message !== "string" ||
      typeof e.observedAt !== "string"
    ) {
      throw new Error(
        `result-consumer: job ${jobId} result carries a malformed commError (need a valid kind + string message/observedAt)`,
      );
    }
  }
  return c as ServiceJobResult;
}

export function createResultConsumer(deps: ResultConsumerDeps): ResultConsumer {
  const { pb, aggregator, logger } = deps;
  const now = deps.now ?? Date.now;

  /**
   * Read the prior OBSERVED status-row colour for an aggregate key so the
   * result-lost overlay preserves it (REQ-B). Best-effort: a missing resolver or
   * a lookup throw degrades to `undefined` (the never-observed / no-data path) —
   * reading the prior colour must never wedge the consumer. Mirrors
   * `control-plane.ts`'s `priorStateFor`.
   */
  async function priorStateFor(
    aggregateKey: string,
  ): Promise<State | undefined> {
    if (!deps.resolvePriorState) return undefined;
    try {
      return (await deps.resolvePriorState(aggregateKey)) ?? undefined;
    } catch (err) {
      logger.warn("fleet.consumer.prior-state-read-failed", {
        aggregateKey,
        err: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  // STABLE grace basis for terminal-but-resultless rows, keyed by jobId. We
  // CANNOT measure age from `row.updated` (PB's mtime): ANY later write to the
  // row — including our own — resets it, so a genuinely-resultless row could be
  // perpetually "young" and re-scanned forever, never latching. Instead we
  // record the FIRST tick we observed each resultless terminal row and latch
  // only once the grace window has elapsed since THAT first sighting, which no
  // subsequent write can move. Entries are pruned when a row gains a result or
  // is latched, so this stays bounded to the currently-pending resultless set.
  const firstSeenResultless = new Map<string, number>();

  return {
    async consumeOnce(): Promise<ConsumeResult> {
      // Terminal rows (done|failed) whose result is present + not yet
      // processed. PB has no IS-NOT-NULL on a json column shortcut here, so we
      // filter status + the latch and guard the result presence in-process.
      // The poll read is GUARDED: consumeOnce is documented "Never throws" and
      // the control-plane caller relies on that to keep draining — a PB blip on
      // this list must yield an empty cycle, not reject the whole tick.
      let page;
      try {
        page = await pb.list<ResultJobRecord>(PROBE_JOBS_COLLECTION, {
          filter:
            '(status = "done" || status = "failed") && result_processed != true',
          // DETERMINISTIC page order (Fix 1a): without a stable sort, PB's
          // default ordering lets a >CONSUME_PAGE resultless backlog rotate
          // through the first page, so an entry beyond it is absent some cycles
          // and present others — under a prune-by-absence its grace timer keeps
          // resetting and result-lost is never declared. A stable
          // `created,id` sort makes each page a consistent prefix of the
          // pending set, so a given row is seen every cycle until it resolves.
          sort: CONSUME_SORT,
          perPage: CONSUME_PAGE,
          skipTotal: true,
        });
      } catch (err) {
        logger.error("fleet.consumer.poll-failed", {
          err: err instanceof Error ? err.message : String(err),
        });
        return { processed: 0, failures: 0 };
      }

      // Reconcile the in-memory grace Map against the rows actually scanned this
      // cycle. A resultless terminal row that the sweeper RE-QUEUES (status
      // done|failed -> pending) silently drops out of this poll's filter — it is
      // never seen here again, so its first-seen entry would leak forever (it's
      // only pruned on result-arrival or successful latch, neither of which a
      // re-queued row ever reaches). Pruning entries whose jobId is absent from
      // the current page's scanned id set keeps the Map bounded across such
      // re-queues.
      //
      // BUT (Fix 1b) absence-from-page only means "resolved/re-queued" when this
      // page is the COMPLETE pending set. When the page is FULL
      // (length === CONSUME_PAGE) there is a backlog LARGER than one page, so a
      // genuinely-still-pending row beyond this page is also absent — pruning it
      // by absence would reset its grace timer every cycle and starve
      // result-lost forever (exactly the determinism bug the stable sort above
      // addresses). So only prune-by-absence on a NON-FULL page, where the
      // scanned set provably covers every pending resultless row. On a full
      // page we hold all entries; the stable sort guarantees each row is
      // eventually scanned (and then pruned the normal way on resolve) as the
      // backlog drains from the front.
      const pageWasFull = page.items.length >= CONSUME_PAGE;
      if (!pageWasFull) {
        const scannedIds = new Set<string>(page.items.map((r) => r.id));
        for (const id of firstSeenResultless.keys()) {
          if (!scannedIds.has(id)) firstSeenResultless.delete(id);
        }
      }

      let processed = 0;
      let failures = 0;
      for (const row of page.items) {
        if (row.result === undefined || row.result === null) {
          // Terminal but no result (yet). This is the DATA-LOSS RACE window:
          // report() flips the row terminal, THEN writes the result a few ms
          // later. Latching here immediately would drop that imminent result
          // (the dashboard then silently never updates). So only latch once the
          // row has been resultless-terminal LONGER than the grace window.
          //
          // The grace basis is a STABLE first-seen timestamp tracked in-memory
          // per jobId — NOT a live read of `row.updated` (PB mtime) every
          // cycle, which any later write RESETS FORWARD, letting a
          // perpetually-touched resultless row re-scan forever and never latch.
          // On the FIRST sighting we seed the basis from the EARLIER of the
          // row's mtime and now (so a row that was already terminal long before
          // this process started — e.g. a result write that never landed before
          // a control-plane restart — is correctly aged on first sight), then
          // FREEZE it: no subsequent mtime bump can push the deadline later.
          const nowMs = now();
          let firstSeen = firstSeenResultless.get(row.id);
          if (firstSeen === undefined) {
            // ANCHOR the PB space→"T" rewrite to the canonical date/time
            // boundary (`YYYY-MM-DD `) — same shape the JSVM hook + queue-client
            // `leaseExpired` use — so only the canonical PB mtime is normalized,
            // never an arbitrary first space (which could coerce a malformed
            // value into a parseable mtime and mis-age the grace basis).
            const mtimeMs = Date.parse(
              String(row.updated ?? "").replace(PB_DATE_SEP_RE, "$1T"),
            );
            firstSeen =
              Number.isFinite(mtimeMs) && mtimeMs < nowMs ? mtimeMs : nowMs;
            firstSeenResultless.set(row.id, firstSeen);
          }
          const aged = nowMs - firstSeen >= RESULTLESS_GRACE_MS;
          if (!aged) {
            // Still within grace — wait for the result write to land.
            logger.debug("fleet.consumer.resultless-within-grace", {
              jobId: row.id,
              firstSeen,
            });
            continue;
          }
          // Genuinely resultless past grace. This row was claimed, the worker
          // ran it (or tried to), and a terminal report flipped it done|failed —
          // but the per-service RESULT write never landed (report()'s post-
          // release result write exhausted its retries, or the process died in
          // the gap). The row is ALREADY terminal, so the producer/fleet-health
          // sweepers — which only scan claimed|running rows for EXPIRED leases —
          // will NEVER see it: there is no other leg that surfaces this to the
          // dashboard. Latching silently here would DROP it (REQ-B violation:
          // the dashboard would just never update for this service). So before
          // latching we SYNTHESIZE a `worker-crashed-mid-job` comm error and
          // surface it through the aggregator so the dashboard renders "couldn't
          // reach the pool" (⚡ unreachable) for this service's aggregate row.
          //
          // Keyed on the row's `probe_key` (the `d6:<slug>` aggregate key the
          // dashboard reads). REQ-B (Fix A1): read the CURRENT row colour first
          // and pass it as `lastKnownState` so the overlay PRESERVES the last
          // observed colour (a previously-green/red/degraded service whose worker
          // crashes stays that colour + ⚡ unreachable) and the overlay lands on
          // the LIVE status row — NOT history-only. For a NEVER-observed key the
          // resolver returns undefined, so we omit `lastKnownState` and the
          // aggregator writes the no-data ("error") path: it NEVER fabricates a
          // green row. This mirrors how `control-plane.ts` wires the sweep +
          // fleet-health legs. aggregateCommError is best-effort by contract, but
          // guard anyway so a surfacing blip cannot wedge the consumer
          // (consumeOnce never throws).
          const observedAt = new Date(nowMs).toISOString();
          const lastKnownState = await priorStateFor(row.probe_key);
          try {
            await aggregator.aggregateCommError({
              commError: {
                kind: "worker-crashed-mid-job",
                message: `job ${row.id} (${row.probe_key}) went terminal but its result never landed within ${RESULTLESS_GRACE_MS}ms; result lost — pool unreachable`,
                jobId: row.id,
                observedAt,
              },
              aggregateKey: row.probe_key,
              ...(lastKnownState !== undefined ? { lastKnownState } : {}),
            });
            logger.warn("fleet.consumer.result-lost-commerror", {
              jobId: row.id,
              aggregateKey: row.probe_key,
            });
          } catch (err) {
            // Surfacing failed — do NOT latch, so the next cycle retries the
            // comm-error surface (the row is still resultless-terminal and its
            // first-seen basis is past grace). Leaving it unlatched is the safe
            // failure mode: re-surfacing the same overlay is harmless, dropping
            // it is not.
            logger.error("fleet.consumer.result-lost-commerror-failed", {
              jobId: row.id,
              aggregateKey: row.probe_key,
              err: err instanceof Error ? err.message : String(err),
            });
            continue;
          }
          // Comm error surfaced — now latch so the row doesn't re-scan forever.
          try {
            await pb.update(PROBE_JOBS_COLLECTION, row.id, {
              result_processed: true,
            });
            // Latched — drop the first-seen entry so the Map stays bounded.
            firstSeenResultless.delete(row.id);
          } catch (err) {
            logger.warn("fleet.consumer.latch-empty-failed", {
              jobId: row.id,
              err: err instanceof Error ? err.message : String(err),
            });
          }
          continue;
        }
        // The row now carries a result — its earlier resultless sighting (if
        // any) is moot, so prune the first-seen entry to keep the Map bounded.
        firstSeenResultless.delete(row.id);

        let result: ServiceJobResult;
        try {
          result = decodeResult(row.id, row.result);
        } catch (err) {
          failures++;
          logger.error("fleet.consumer.decode-failed", {
            jobId: row.id,
            err: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        try {
          // AGGREGATE FIRST (authoritative status + run-history), THEN latch.
          await aggregator.aggregate(result);
        } catch (err) {
          failures++;
          logger.error("fleet.consumer.aggregate-failed", {
            jobId: row.id,
            probeKey: result.aggregateKey,
            err: err instanceof Error ? err.message : String(err),
          });
          // Leave unprocessed — the next cycle retries (at-least-once).
          continue;
        }

        try {
          await pb.update(PROBE_JOBS_COLLECTION, row.id, {
            result_processed: true,
          });
        } catch (err) {
          // Aggregate succeeded but the latch failed: worst case a re-aggregate
          // next cycle, which the aggregator's per-jobId dedup makes a true
          // no-op. Count it as a failure so the cadence/metrics surface the
          // latch trouble.
          failures++;
          logger.warn("fleet.consumer.latch-failed", {
            jobId: row.id,
            err: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        processed++;
        logger.debug("fleet.consumer.processed", {
          jobId: row.id,
          probeKey: result.aggregateKey,
        });
      }

      return { processed, failures };
    },
  };
}
