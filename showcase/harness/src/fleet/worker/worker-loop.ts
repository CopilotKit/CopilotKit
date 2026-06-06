/**
 * Fleet WORKER loop (BLITZ S7).
 *
 * ── WHAT THIS IS ───────────────────────────────────────────────────────
 * The body of the `worker` role: a self-bounded pull loop that claims
 * per-SERVICE jobs from the queue (S3's `FleetQueueClient`, typed here against
 * the S1 interface), runs ALL of a claimed service's d6/d5 cells via the
 * EXISTING per-service driver (`createE2eFullDriver` / the pooled launcher in
 * `d6-all-pills.ts`), heartbeat-renews the lease across the long run, computes
 * the per-service `ServiceJobResult` (per-cell `ServiceCellResult[]` + the
 * aggregate rollup), and reports it.
 *
 * ── WHY SELF-BOUNDED ───────────────────────────────────────────────────
 * The whole point of the fleet is to stay under the platform-fixed cgroup
 * `pids.max=1000` thread/PID ceiling (the PROVEN wedge). The worker therefore
 * NEVER claims new work unless its `BrowserPool.budget()` reports free context
 * capacity (`available > 0`). When the pool is saturated the loop idles
 * (sleeps a poll interval) instead of pulling another job — so a single worker
 * can never overshoot its own context cap and drive `pids.current` past the
 * ceiling. One job runs at a time per worker (the driver fans out across the
 * service's cells with its OWN bounded concurrency / pooled launcher), which
 * keeps the budget gate a simple, honest "do I have any headroom at all?".
 *
 * ── LEASE HEARTBEAT ────────────────────────────────────────────────────
 * A d6 service run is long (the driver's wall-clock budget is minutes) and
 * exceeds the queue's visibility timeout, so a held lease must be EXTENDED
 * mid-run or the sweeper would reclaim the job out from under a live worker
 * (synthesizing a false `worker-crashed-mid-job` comm error). The loop fires
 * `renewLease` on a fixed cadence (`heartbeatMs`) for the duration of the run
 * and stops the heartbeat as soon as the run settles. A renew that returns
 * `null` (lease lost / stolen) stops the heartbeat but does NOT abort the
 * in-flight run — the result is still computed and reported; the queue's CAS
 * on `report` is the final arbiter of whether this worker still owns the job.
 *
 * ── DELEGATION BOUNDARY ────────────────────────────────────────────────
 * This module owns the LOOP and the result COMPUTATION only. It does NOT
 * construct the BrowserPool, the queue client, or the driver — those are
 * injected (`WorkerLoopDeps`) so the loop is unit-testable with fakes and so
 * the `runWorker` entrypoint (orchestrator.ts) is the single place that wires
 * the real pool + driver + queue together.
 */

import type { ProbeState, ProbeResult, Logger } from "../../types/index.js";
import type { BrowserPoolBudget } from "../../probes/helpers/browser-pool.js";
import type {
  FleetQueueClient,
  JobLease,
  ServiceJobPayload,
  ServiceJobResult,
  ServiceCellResult,
  ServiceJobRollup,
  PoolCommError,
} from "../contracts.js";
import type { DriverKind } from "./payload-mapper.js";

/**
 * The minimal driver surface the worker invokes per claimed service job. This
 * is structurally the `run` half of the existing d6/d5 `ProbeDriver`
 * (`createE2eFullDriver().run`) — the worker hands it a `ProbeContext`-shaped
 * value and a per-service input and gets back the aggregate `ProbeResult`. The
 * per-cell side rows the driver emits flow through `ctx.writer.write` (captured
 * by the loop), NOT the return value.
 *
 * Typed as a local interface rather than importing `ProbeDriver` so the loop
 * doesn't drag the whole probe registry into the worker, and so a test fake is
 * a one-method object.
 */
export interface ServiceJobDriver {
  /**
   * Run all of a service's cells. `ctx` carries the side-emit `writer` the
   * loop installs to capture per-cell rows; `input` is the driver-specific
   * per-service input (derived from the payload). Returns the aggregate
   * `ProbeResult` (the primary `d6:<slug>` / `e2e_d6:<slug>` row).
   */
  run(ctx: ServiceDriverContext, input: unknown): Promise<ProbeResult>;
}

/**
 * The slice of `ProbeContext` the worker supplies to the driver. Mirrors the
 * fields the d6 driver actually reads (`now`, `logger`, `env`, `writer`,
 * `abortSignal`, `featureTypes`) so the real `createE2eFullDriver().run`
 * type-checks against it without a cast.
 */
export interface ServiceDriverContext {
  now: () => Date;
  logger: Logger;
  env: Readonly<Record<string, string | undefined>>;
  writer: { write(result: ProbeResult): Promise<unknown> };
  abortSignal?: AbortSignal;
  featureTypes?: string[];
}

/**
 * Builds the per-service driver INPUT from a claimed payload. The payload is
 * an open contract (`driverInputs` is `Record<string, unknown>`), and the
 * concrete shape the d6 driver wants (key, backendUrl, demos, features, …) is
 * assembled by the entrypoint that knows the service catalog — so the mapping
 * is injected rather than hard-coded here. Returning `undefined` signals "this
 * payload cannot be mapped to a runnable input" → the loop reports a terminal
 * failure for the job instead of crashing the worker.
 */
export type PayloadToDriverInput = (
  payload: ServiceJobPayload,
) => unknown | undefined;

/**
 * One entry of the worker's driver REGISTRY: a `ServiceJobDriver` paired with
 * the `PayloadToDriverInput` mapper that re-hydrates the per-service input that
 * driver's zod schema validates. The registry is keyed by `driverKind` (the
 * live kinds are `e2e_d6`, `e2e_demos`, `e2e_smoke`), so a single worker can host
 * MULTIPLE browser-driver families — the loop dispatches each claimed job to the
 * entry whose key matches `payload.driverKind`.
 */
export interface DriverRegistryEntry {
  driver: ServiceJobDriver;
  payloadToInput: PayloadToDriverInput;
  /**
   * Builds the aggregate side-emit key the loop filters OUT of the captured
   * per-cell rows (the driver emits ONE aggregate row alongside the per-cell
   * rows; the loop captures the aggregate from the run's RETURN value, so the
   * side-emitted aggregate must be dropped from the cell set). Each driver
   * family stamps its aggregate row under its OWN scheme, so the key derivation
   * is per-entry. OPTIONAL: when absent the loop defaults to `d6:<serviceSlug>`
   * (the d6 scheme), keeping the d6 path byte-identical to the pre-registry
   * behavior. Non-d6 kinds with a different aggregate scheme supply their own.
   */
  aggregateSlugKey?: (serviceSlug: string) => string;
}

/**
 * The worker's driver registry: `driverKind` → `{ driver, payloadToInput }`.
 * Built once at the `runWorker` entrypoint (all driver families wired onto the
 * shared pool) and injected into the loop. A claimed payload whose `driverKind`
 * is absent from the map is a `worker-protocol-violation` (the same terminal
 * failure shape an unmappable payload uses) — the worker won't crash on an
 * unknown kind, it reports it.
 */
export type DriverRegistry = ReadonlyMap<DriverKind, DriverRegistryEntry>;

/** The pool capacity surface the loop's claim gate consults (S6 `budget()`). */
export interface BudgetSource {
  budget(): BrowserPoolBudget;
}

export interface WorkerLoopDeps {
  /** Stable worker id — the `claimed_by` on every claim (matches S0). */
  workerId: string;
  /** Queue protocol (S3 impl, typed against the S1 interface). */
  queue: FleetQueueClient;
  /** The pool whose `budget()` gates claiming (S6). */
  pool: BudgetSource;
  /**
   * The driver REGISTRY: `driverKind` → `{ driver, payloadToInput }`. The loop
   * dispatches each claimed job to the entry whose key matches
   * `payload.driverKind`; an unknown kind is reported as a
   * `worker-protocol-violation` terminal result (never a crash). REQUIRED when
   * the legacy single-driver pair below is omitted.
   */
  drivers?: DriverRegistry;
  /**
   * LEGACY single-driver pair. When `drivers` is omitted, the loop runs EVERY
   * claimed job through this one driver (the pre-registry behavior). Retained so
   * existing call sites / tests that inject one driver keep working; the
   * registry path is preferred. Exactly one of `drivers` or this pair must be
   * supplied.
   */
  driver?: ServiceJobDriver;
  /** Maps a claimed payload to the legacy driver's per-service input. */
  payloadToInput?: PayloadToDriverInput;
  logger: Logger;
  /** Frozen env snapshot threaded into the driver ctx. */
  env: Readonly<Record<string, string | undefined>>;
  /** Injectable clock (defaults to `Date`). */
  now?: () => Date;
  /** Injectable sleep (defaults to setTimeout). Resolves after `ms`. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Lease seconds requested on each claim + renew. */
  leaseSeconds?: number;
  /** Heartbeat (renew) cadence while a job runs. */
  heartbeatMs?: number;
  /** Idle poll interval when there's no work / no budget. */
  pollIntervalMs?: number;
  /**
   * Optional hook fired when the worker's current job changes: the claimed
   * `jobId` when a job is won, then `null` when it settles (reported/failed).
   * The entrypoint wires this to the registration heartbeat so the worker's
   * `workers.current_job_id` reflects the live job instead of always being null
   * (the periodic registration beat only writes idle/null). Best-effort — it
   * must never throw into the loop, so the loop swallows its rejection.
   */
  onCurrentJobChange?: (currentJobId: string | null) => void;
}

/** Handle returned by `startWorkerLoop` — `stop()` drains and resolves. */
export interface WorkerLoopHandle {
  /** Resolves when the loop has stopped (after the in-flight job settles). */
  stop(): Promise<void>;
  /** The promise of the loop's run — resolves when the loop exits. */
  done: Promise<void>;
}

/** Default lease window — comfortably exceeds the heartbeat cadence. */
export const DEFAULT_LEASE_SECONDS = 300;
/** Default heartbeat cadence — well under the lease window. */
export const DEFAULT_HEARTBEAT_MS = 60_000;
/** Default idle poll interval when there's no work / no budget. */
export const DEFAULT_POLL_INTERVAL_MS = 5_000;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Capturing writer: the loop installs this as the driver's `ctx.writer` so the
 * per-cell `d6:<slug>/<featureId>` side rows the driver emits are collected
 * into `ServiceCellResult[]` rather than written to storage (the aggregator —
 * S5 — owns persistence; the worker only REPORTS the result). The aggregate
 * `d6:<slug>` row the driver also side-emits is filtered out here (it duplicates
 * the driver's primary return, which the loop captures separately).
 */
function createCellCapture(aggregateSlugKey: string): {
  writer: { write(result: ProbeResult): Promise<unknown> };
  cells: ServiceCellResult[];
} {
  const cells: ServiceCellResult[] = [];
  return {
    cells,
    writer: {
      async write(result: ProbeResult): Promise<unknown> {
        // The driver side-emits both per-cell (`d6:<slug>/<featureId>`) and an
        // aggregate (`d6:<slug>`) row. Keep only the per-cell rows — the
        // aggregate is captured from the driver's primary return.
        if (result.key === aggregateSlugKey) return undefined;
        cells.push({
          cellId: cellIdFromKey(result.key),
          cellKey: result.key,
          state: result.state,
          signal: result.signal,
          observedAt: result.observedAt,
        });
        return undefined;
      },
    },
  };
}

/** Extract the trailing `<featureId>` from a `d6:<slug>/<featureId>` cell key. */
function cellIdFromKey(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash >= 0 ? key.slice(slash + 1) : key;
}

/**
 * Read an explicit `rowPrefix` ("d5" | "d6") off a payload's serialized driver
 * inputs. The D5 "take-one" path runs the `e2e_d6` driver but emits rows under
 * the `d5:` prefix, so the worker must derive the aggregate-key scheme from the
 * per-job input rather than the (prefix-agnostic) registry entry. Returns
 * undefined for any non-d5/d6 value so the caller falls back to the entry's
 * default builder.
 */
function readRowPrefix(driverInputs: unknown): "d5" | "d6" | undefined {
  if (driverInputs === null || typeof driverInputs !== "object") {
    return undefined;
  }
  const prefix = (driverInputs as Record<string, unknown>).rowPrefix;
  return prefix === "d5" || prefix === "d6" ? prefix : undefined;
}

/**
 * The browser pool's OWN unavailability signal.
 *
 * `BrowserPool` (`probes/helpers/browser-pool.ts`) does NOT define a custom
 * error class or set a custom `err.name` — every genuine-unavailability throw is
 * a plain `Error` whose MESSAGE is prefixed with `BrowserPool ` / `browser-pool:`
 * (e.g. `"BrowserPool is shut down"`, `"BrowserPool acquire timeout"`,
 * `"BrowserPool shut down during launch"`, `"browser-pool: relaunch retries
 * exhausted"`). That prefix is therefore the pool's identity, and we key the
 * infra classifier on it (matched against `err.message`) rather than the
 * worker importing the pool implementation.
 *
 * CRITICAL (REQ-B): this must match ONLY the pool's own throws — NOT a broad
 * substring like `pool|launcher|browser|chromium|playwright`. The old broad
 * `err.name` match wrongly classified a real in-driver test failure thrown by
 * Playwright (name `PlaywrightTimeoutError` / `TimeoutError`, or any assertion
 * whose text mentions the browser) as pool-infra → "couldn't reach the pool",
 * HIDING a genuine product/test regression as fleet plumbing. A Playwright
 * assertion/timeout is a real TEST failure and MUST classify as a driver error
 * (a probe error, no commError), never a pool outage.
 *
 * Anchored to the start of the message (after optional leading whitespace) so a
 * test assertion that merely *mentions* the pool mid-sentence is not mistaken
 * for the pool's own throw.
 */
const POOL_UNAVAILABLE_MESSAGE_RE = /^\s*browser[\s-]?pool\b/i;

/**
 * The known aggregate states (== the `ProbeState` union). A driver return
 * carrying anything outside this set is garbage that must NOT flow into the
 * dashboard status state machine. The cross-process consumer
 * (`result-consumer.decodeResult`) validates the same set when re-reading the
 * persisted JSON, but the IN-PROCESS path never round-trips through that
 * decode — so the producer boundary must validate here too, or a bad driver
 * state escapes unchecked. Keep this in lock-step with `PROBE_STATES` in
 * `result-consumer.ts`.
 */
const PROBE_STATES: ReadonlySet<ProbeState> = new Set<ProbeState>([
  "green",
  "red",
  "degraded",
  "error",
]);

/**
 * The three error classes a thrown driver run maps to. Mirrors the
 * probe-invoker idiom (`err.name === "ZodError"` ⇒ input-rejected vs.
 * driver-error) but at the FLEET boundary, where the extra axis is "was this a
 * pool-COMM failure or a probe error?" (REQ-B):
 *
 *   - `protocol-violation` — a schema/input-validation throw (zod). The payload
 *     could not be trusted; it surfaces as a `worker-protocol-violation` comm
 *     error (the same class `runClaimedJob` already emits for an unmappable
 *     payload).
 *   - `pool-infra` — a genuine pool/launcher-unreachable failure. Stays
 *     `worker-crashed-mid-job` so the dashboard shows "couldn't reach the pool".
 *   - `driver-error` — a real in-driver test/runtime throw. Surfaces as a
 *     probe `error` result with NO commError, so it reads as a probe error and
 *     NOT a pool-unreachable overlay. This is the DEFAULT: a driver that throws
 *     is overwhelmingly failing its own test logic, not the fleet plumbing.
 */
type DriverThrowClass = "protocol-violation" | "pool-infra" | "driver-error";

/**
 * Classify a thrown driver error into one of the three fleet error classes.
 * Pure; unit-tested via `runClaimedJob`'s branch coverage.
 */
export function classifyDriverThrow(err: unknown): DriverThrowClass {
  const name = err instanceof Error ? err.name : "";
  if (name === "ZodError") return "protocol-violation";
  // Pool unreachability is identified by the pool's OWN throw signature — its
  // `BrowserPool `/`browser-pool:` MESSAGE prefix — NOT a broad name/keyword
  // match. A Playwright/test error (real product/test regression) therefore
  // falls through to `driver-error` and surfaces as a probe error, not a false
  // pool outage (REQ-B).
  const message = err instanceof Error ? err.message : "";
  if (POOL_UNAVAILABLE_MESSAGE_RE.test(message)) return "pool-infra";
  return "driver-error";
}

/**
 * Compute the pass/fail rollup from captured cell results. A cell is "passed"
 * iff its state is green; everything else (red, degraded, error) counts as
 * failed. Mirrors the d6 aggregate semantic (any non-green → not passed).
 */
export function computeRollup(cells: ServiceCellResult[]): ServiceJobRollup {
  let passed = 0;
  let failed = 0;
  for (const c of cells) {
    if (c.state === "green") passed++;
    else failed++;
  }
  return { total: cells.length, passed, failed };
}

/**
 * Build the `ServiceJobResult` from a claimed lease, the driver's aggregate
 * return, and the captured per-cell rows. Pure — the loop calls it after a
 * successful run; unit-tested independently of the loop.
 */
export function buildServiceJobResult(args: {
  lease: JobLease;
  workerId: string;
  aggregate: ProbeResult;
  cells: ServiceCellResult[];
  finishedAt: string;
}): ServiceJobResult {
  const { lease, workerId, aggregate, cells, finishedAt } = args;
  const { job, payload } = lease;
  // The driver return is untrusted at the producer boundary: a garbage state
  // ("grene") satisfies the `ProbeState` static type yet would flow straight
  // into the dashboard status state machine on the in-process path (which
  // never re-decodes through `result-consumer`). Fail LOUD here so `runClaimedJob`
  // routes it to an `error` result instead of persisting junk.
  if (!PROBE_STATES.has(aggregate.state)) {
    throw new Error(
      `buildServiceJobResult: job ${job.id} driver returned invalid aggregateState "${aggregate.state}" (expected one of ${[...PROBE_STATES].join("/")})`,
    );
  }
  return {
    jobId: job.id,
    probeKey: payload.probeKey,
    serviceSlug: payload.serviceSlug,
    runId: payload.meta.runId,
    workerId,
    aggregateState: aggregate.state,
    aggregateKey: aggregate.key,
    aggregateSignal: aggregate.signal,
    cells,
    rollup: computeRollup(cells),
    finishedAt,
  };
}

/**
 * Build a terminal `ServiceJobResult` carrying a `commError` for a job that
 * crashed/timed out in the worker (the worker's OWN self-monitor leg of REQ-B).
 * `aggregateState` carries `"error"` so `terminalJobStatus` maps it to
 * `"failed"`, and the comm error tells the dashboard to render "couldn't reach
 * the pool" distinctly from a probe red. Pure; unit-tested.
 */
export function buildCommErrorResult(args: {
  lease: JobLease;
  workerId: string;
  commError: PoolCommError;
  finishedAt: string;
}): ServiceJobResult {
  const { lease, workerId, commError, finishedAt } = args;
  const { job, payload } = lease;
  const errorState: ProbeState = "error";
  return {
    jobId: job.id,
    probeKey: payload.probeKey,
    serviceSlug: payload.serviceSlug,
    runId: payload.meta.runId,
    workerId,
    aggregateState: errorState,
    aggregateKey: payload.probeKey,
    aggregateSignal: { error: commError.message },
    cells: [],
    rollup: { total: 0, passed: 0, failed: 0 },
    finishedAt,
    commError,
  };
}

/**
 * Build a terminal `ServiceJobResult` for a genuine IN-DRIVER test/runtime
 * error (the driver threw while running its own logic, not because the pool was
 * unreachable). `aggregateState` is `"error"` so `terminalJobStatus` maps it to
 * `"failed"`, but there is deliberately NO `commError` — this surfaces as a
 * PROBE error on the dashboard, not the "couldn't reach the pool" overlay
 * (REQ-B: a real test/runtime failure must not masquerade as a pool outage).
 * `aggregateKey` falls back to the payload's `probeKey` (the `d6:<slug>`
 * aggregate row key) since there is no driver result to echo. Pure; unit-tested.
 */
export function buildDriverErrorResult(args: {
  lease: JobLease;
  workerId: string;
  message: string;
  finishedAt: string;
}): ServiceJobResult {
  const { lease, workerId, message, finishedAt } = args;
  const { job, payload } = lease;
  const errorState: ProbeState = "error";
  return {
    jobId: job.id,
    probeKey: payload.probeKey,
    serviceSlug: payload.serviceSlug,
    runId: payload.meta.runId,
    workerId,
    aggregateState: errorState,
    aggregateKey: payload.probeKey,
    aggregateSignal: { error: message },
    cells: [],
    rollup: { total: 0, passed: 0, failed: 0 },
    finishedAt,
  };
}

/**
 * Run ONE claimed job to completion: install the cell-capturing writer, run the
 * driver with a lease-renewal heartbeat in flight, and return the computed
 * `ServiceJobResult`. On a driver crash/timeout, returns a comm-error terminal
 * result instead of throwing — the loop always has a result to report so a
 * crashed job never silently strands its lease until the sweeper reclaims it.
 *
 * Exported for direct unit testing of the claim→run→report round-trip without
 * driving the full poll loop.
 */
/**
 * Resolve the `{ driver, payloadToInput }` entry that runs a claimed payload.
 * Dispatch is by `payload.driverKind` against the injected `drivers` registry;
 * when the registry is omitted the loop falls back to the legacy single
 * `driver`/`payloadToInput` pair (pre-registry behavior). Returns `undefined`
 * when neither path can serve the kind — the caller maps that to a
 * `worker-protocol-violation` terminal result (NOT a crash), the same failure
 * shape an unmappable payload already uses.
 *
 * Pure; exercised through `runClaimedJob`'s routing branches.
 */
export function resolveDriverEntry(
  deps: Pick<WorkerLoopDeps, "drivers" | "driver" | "payloadToInput">,
  driverKind: string,
): DriverRegistryEntry | undefined {
  if (deps.drivers) {
    // `driverKind` is a wire string (contracts.ts boundary); the registry is
    // keyed by the closed `DriverKind` union. `.get` returns undefined for any
    // off-set key, so this narrowing cast is safe — an unknown kind resolves to
    // undefined and is reported as a protocol violation by the caller.
    return deps.drivers.get(driverKind as DriverKind);
  }
  // Legacy single-driver path: one driver handles every kind.
  if (deps.driver && deps.payloadToInput) {
    return { driver: deps.driver, payloadToInput: deps.payloadToInput };
  }
  return undefined;
}

export async function runClaimedJob(
  deps: Pick<
    WorkerLoopDeps,
    | "workerId"
    | "queue"
    | "drivers"
    | "driver"
    | "payloadToInput"
    | "logger"
    | "env"
  > & { now: () => Date; sleep: NonNullable<WorkerLoopDeps["sleep"]> },
  lease: JobLease,
  opts: { leaseSeconds: number; heartbeatMs: number },
): Promise<ServiceJobResult> {
  const { workerId, queue, logger, env, now } = deps;
  const { job, payload } = lease;

  // Dispatch by driverKind: pick the registry entry whose key matches the
  // payload's `driverKind` (or the legacy single driver when no registry was
  // injected). An unknown kind is a protocol violation the WORKER owns (it won
  // the claim) — report it as a `worker-protocol-violation` terminal result so
  // the dashboard surfaces it, rather than crashing the worker on an unhandled
  // kind. This mirrors the unmappable-payload failure shape below.
  const entry = resolveDriverEntry(deps, payload.driverKind);
  if (!entry) {
    logger.error("fleet.worker.unknown-driver-kind", {
      workerId,
      jobId: job.id,
      probeKey: payload.probeKey,
      driverKind: payload.driverKind,
    });
    return buildCommErrorResult({
      lease,
      workerId,
      commError: {
        kind: "worker-protocol-violation",
        message: `worker has no driver registered for driverKind "${payload.driverKind}" (job ${job.id}, probeKey "${payload.probeKey}")`,
        workerId,
        jobId: job.id,
        observedAt: now().toISOString(),
      },
      finishedAt: now().toISOString(),
    });
  }
  const { driver, payloadToInput } = entry;
  // The aggregate side-emit key the loop filters out of the captured cells.
  // Each driver family stamps its aggregate row under its own scheme, so the
  // resolved entry supplies the derivation; default to d6's `d6:<slug>` when the
  // entry omits it (keeps the d6 path byte-identical to the pre-registry filter).
  const buildAggregateSlugKey =
    entry.aggregateSlugKey ?? ((serviceSlug: string) => `d6:${serviceSlug}`);

  // Map the claimed payload to a driver input. A poison payload can fail either
  // by RETURNING undefined ("cannot map this") or by THROWING (decode/parse
  // blew up). Both are protocol violations the WORKER owns (it won the claim),
  // so both must emit a `worker-protocol-violation` comm-error result the
  // dashboard surfaces — NOT a bare release-failed (silently lost after grace)
  // and NOT an uncaught throw (which would reject the loop's done-promise =
  // silent worker death). The throw is caught HERE rather than in the run
  // try/catch below so it is never misread as a driver/test error.
  let input: unknown;
  try {
    input = payloadToInput(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("fleet.worker.payload-decode-error", {
      workerId,
      jobId: job.id,
      probeKey: payload.probeKey,
      err: msg,
    });
    return buildCommErrorResult({
      lease,
      workerId,
      commError: {
        kind: "worker-protocol-violation",
        message: `worker could not decode payload for probeKey "${payload.probeKey}": ${msg}`,
        workerId,
        jobId: job.id,
        observedAt: now().toISOString(),
      },
      finishedAt: now().toISOString(),
    });
  }
  if (input === undefined) {
    logger.warn("fleet.worker.payload-unmappable", {
      workerId,
      jobId: job.id,
      probeKey: payload.probeKey,
    });
    return buildCommErrorResult({
      lease,
      workerId,
      commError: {
        kind: "worker-protocol-violation",
        message: `worker could not map payload for probeKey "${payload.probeKey}" to a driver input`,
        workerId,
        jobId: job.id,
        observedAt: now().toISOString(),
      },
      finishedAt: now().toISOString(),
    });
  }

  // The driver's aggregate side-emit (e.g. `d6:<serviceSlug>`) — filter that one
  // out of the captured cells (the loop captures the aggregate from the primary
  // return). Per-cell rows are `<scheme>:<slug>/<featureId>` and are kept. The
  // key scheme is per-driver-family, resolved from the registry entry above.
  //
  // ROW-PREFIX OVERRIDE: the D5 probe runs the `e2e_d6` driver with
  // `driverInputs.rowPrefix === "d5"` (the "D5 take-one" path), so its aggregate
  // is emitted under `d5:<slug>`, NOT `d6:<slug>`. The single `e2e_d6` registry
  // entry's builder can't know the per-job prefix, so honor an explicit
  // `rowPrefix` carried on the payload's driver inputs here — otherwise the
  // `d5:<slug>` aggregate would leak into the captured per-cell set.
  const rowPrefixOverride = readRowPrefix(payload.driverInputs);
  const aggregateSlugKey =
    rowPrefixOverride !== undefined
      ? `${rowPrefixOverride}:${payload.serviceSlug}`
      : buildAggregateSlugKey(payload.serviceSlug);
  const capture = createCellCapture(aggregateSlugKey);

  // Heartbeat-renew the lease while the (long) driver run is in flight. A renew
  // that returns null (lease lost/stolen) stops the heartbeat but does not
  // abort the run — `report` is the final CAS arbiter.
  const heartbeatAbort = new AbortController();
  const heartbeat = (async (): Promise<void> => {
    while (!heartbeatAbort.signal.aborted) {
      await deps.sleep(opts.heartbeatMs, heartbeatAbort.signal);
      if (heartbeatAbort.signal.aborted) break;
      try {
        const renewed = await queue.renewLease(
          job.id,
          workerId,
          opts.leaseSeconds,
        );
        if (renewed === null) {
          logger.warn("fleet.worker.lease-lost", {
            workerId,
            jobId: job.id,
          });
          break;
        }
        logger.debug("fleet.worker.lease-renewed", {
          workerId,
          jobId: job.id,
          leaseExpiresAt: renewed.leaseExpiresAt,
        });
      } catch (err) {
        logger.warn("fleet.worker.lease-renew-error", {
          workerId,
          jobId: job.id,
          err: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }
  })();

  try {
    const ctx: ServiceDriverContext = {
      now,
      logger,
      env,
      writer: capture.writer,
      featureTypes:
        payload.cellIds && payload.cellIds.length > 0
          ? payload.cellIds
          : undefined,
    };
    const aggregate = await driver.run(ctx, input);
    return buildServiceJobResult({
      lease,
      workerId,
      aggregate,
      cells: capture.cells,
      finishedAt: now().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : undefined;
    const cls = classifyDriverThrow(err);

    // A schema/input-validation throw is a protocol violation, not a crash —
    // the payload could not be trusted (same class as an unmappable payload).
    if (cls === "protocol-violation") {
      logger.error("fleet.worker.job-protocol-violation", {
        workerId,
        jobId: job.id,
        probeKey: payload.probeKey,
        errName,
        err: msg,
      });
      return buildCommErrorResult({
        lease,
        workerId,
        commError: {
          kind: "worker-protocol-violation",
          message: `worker rejected job ${job.id} input: ${msg}`,
          workerId,
          jobId: job.id,
          observedAt: now().toISOString(),
        },
        finishedAt: now().toISOString(),
      });
    }

    // A true infra/pool-unreachable failure stays `worker-crashed-mid-job` so
    // the dashboard renders the "couldn't reach the pool" overlay (REQ-B).
    if (cls === "pool-infra") {
      logger.error("fleet.worker.job-crashed", {
        workerId,
        jobId: job.id,
        probeKey: payload.probeKey,
        errName,
        err: msg,
      });
      return buildCommErrorResult({
        lease,
        workerId,
        commError: {
          kind: "worker-crashed-mid-job",
          message: `worker crashed running job ${job.id}: ${msg}`,
          workerId,
          jobId: job.id,
          observedAt: now().toISOString(),
        },
        finishedAt: now().toISOString(),
      });
    }

    // Default: a genuine in-driver test/runtime error. This is a PROBE error,
    // not a pool-comm failure — surface it as an `error`-state result with NO
    // commError so the dashboard shows a probe error, not a pool-unreachable
    // overlay (REQ-B inversion fix).
    logger.error("fleet.worker.job-driver-error", {
      workerId,
      jobId: job.id,
      probeKey: payload.probeKey,
      errName,
      err: msg,
    });
    return buildDriverErrorResult({
      lease,
      workerId,
      message: msg,
      finishedAt: now().toISOString(),
    });
  } finally {
    heartbeatAbort.abort();
    await heartbeat;
  }
}

/**
 * Start the worker pull loop. Returns immediately with a handle; the loop runs
 * until `stop()` is called. The loop:
 *
 *   1. Checks `pool.budget().available > 0`. If no budget, idles a poll
 *      interval (NEVER claims past the context cap → stays under the pids
 *      ceiling).
 *   2. With budget, `queue.claimNext(workerId, leaseSeconds)`. On no claim,
 *      idles a poll interval.
 *   3. On a claim, runs the service's cells via the driver with a lease
 *      heartbeat in flight, computes the `ServiceJobResult`, and `report`s it.
 *      A claim-comm failure or a report failure is logged and the loop
 *      continues (the sweeper reclaims any stranded lease).
 */
export function startWorkerLoop(deps: WorkerLoopDeps): WorkerLoopHandle {
  const now = deps.now ?? ((): Date => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const leaseSeconds = deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const { workerId, queue, pool, logger } = deps;

  // Fail-loud at construction: the heartbeat must fire (and renew) BEFORE the
  // lease expires, or the sweeper reclaims a live worker's job and synthesizes a
  // false `worker-crashed-mid-job` (REQ-B). `heartbeatMs` and `leaseSeconds` are
  // independently overridable, so an unsafe combo is a misconfiguration — die
  // immediately (visible in deploy CI / Railway health-check) rather than ship a
  // worker that drops every long job mid-run. Mirrors the role-config fail-loud
  // idiom (`resolveFleetRoleConfig` throws on an invalid env combo).
  if (heartbeatMs >= leaseSeconds * 1000) {
    throw new Error(
      `Unsafe fleet worker lease config: heartbeatMs (${heartbeatMs}) must be < leaseSeconds*1000 (${leaseSeconds * 1000}) so the lease is renewed before it expires; otherwise the lease lapses before the first renew and the sweeper reclaims a live job as a false worker-crashed-mid-job.`,
    );
  }

  // Fail-loud at construction: a worker with no way to run any claimed job is a
  // misconfiguration. Exactly one of `drivers` (the registry) or the legacy
  // single `driver`/`payloadToInput` pair must be supplied; an empty registry or
  // a missing legacy pair means every claim would terminate as an
  // unknown-kind/protocol-violation. Die immediately rather than ship a worker
  // that fails every job (mirrors the lease-config fail-loud idiom above).
  const hasRegistry = deps.drivers !== undefined && deps.drivers.size > 0;
  const hasLegacyDriver =
    deps.driver !== undefined && deps.payloadToInput !== undefined;
  if (!hasRegistry && !hasLegacyDriver) {
    throw new Error(
      "Fleet worker has no drivers: supply either a non-empty `drivers` registry (driverKind → { driver, payloadToInput }) or the legacy `driver`+`payloadToInput` pair; otherwise every claimed job terminates as a protocol violation.",
    );
  }

  /**
   * Fire the current-job hook, guarding against a throwing/rejecting impl so a
   * registration-heartbeat failure can never break the worker loop (mirrors the
   * best-effort discipline the registration writer itself uses).
   */
  function notifyCurrentJob(currentJobId: string | null): void {
    if (!deps.onCurrentJobChange) return;
    try {
      const maybe = deps.onCurrentJobChange(currentJobId) as unknown;
      if (maybe && typeof (maybe as Promise<unknown>).catch === "function") {
        (maybe as Promise<unknown>).catch((err) =>
          logger.warn("fleet.worker.current-job-hook-error", {
            workerId,
            err: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    } catch (err) {
      logger.warn("fleet.worker.current-job-hook-error", {
        workerId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const stopAbort = new AbortController();
  let stopped = false;

  const done = (async (): Promise<void> => {
    logger.info("fleet.worker.loop-start", { workerId });
    while (!stopAbort.signal.aborted) {
      // 1. Budget gate — only claim when we have free context capacity. This
      //    is what keeps the worker under its cgroup pids ceiling. Reading the
      //    budget touches the cgroup pids files, so it can throw (unreadable
      //    /sys, transient FS error). An unreadable budget is treated as "no
      //    budget" — NOT a worker crash: a throw here must never reject the
      //    loop's done-promise (silent worker death + restart-loop). Log and
      //    idle a poll interval, exactly as a saturated budget would.
      let budget: BrowserPoolBudget;
      try {
        budget = pool.budget();
      } catch (err) {
        logger.error("fleet.worker.budget-error", {
          workerId,
          err: err instanceof Error ? err.message : String(err),
        });
        await sleep(pollIntervalMs, stopAbort.signal);
        continue;
      }
      if (budget.available <= 0) {
        logger.debug("fleet.worker.no-budget", {
          workerId,
          inUse: budget.inUse,
          max: budget.max,
          pidsCurrent: budget.pidsCurrent,
          pidsMax: budget.pidsMax,
        });
        await sleep(pollIntervalMs, stopAbort.signal);
        continue;
      }

      // 2. Attempt a claim.
      let claimed: Awaited<ReturnType<FleetQueueClient["claimNext"]>>;
      try {
        claimed = await queue.claimNext(workerId, leaseSeconds);
      } catch (err) {
        logger.warn("fleet.worker.claim-error", {
          workerId,
          err: err instanceof Error ? err.message : String(err),
        });
        await sleep(pollIntervalMs, stopAbort.signal);
        continue;
      }

      if (!claimed.claimed || !claimed.lease) {
        await sleep(pollIntervalMs, stopAbort.signal);
        continue;
      }

      const lease = claimed.lease;
      logger.info("fleet.worker.claimed", {
        workerId,
        jobId: lease.job.id,
        probeKey: lease.payload.probeKey,
        serviceSlug: lease.payload.serviceSlug,
      });

      // Reflect the now-running job on the registration row so fleet-health
      // sees a non-null current_job_id while the (long) run is in flight.
      // Best-effort — a throwing hook must never break the loop.
      notifyCurrentJob(lease.job.id);

      // 3. Run + report. `runClaimedJob` never throws — it returns a comm-error
      //    terminal result on crash/timeout so the loop always reports.
      const result = await runClaimedJob(
        {
          workerId,
          queue,
          drivers: deps.drivers,
          driver: deps.driver,
          payloadToInput: deps.payloadToInput,
          logger,
          env: deps.env,
          now,
          sleep,
        },
        lease,
        { leaseSeconds, heartbeatMs },
      );

      try {
        await queue.report({ jobId: lease.job.id, workerId, result });
        logger.info("fleet.worker.reported", {
          workerId,
          jobId: lease.job.id,
          aggregateState: result.aggregateState,
          passed: result.rollup.passed,
          failed: result.rollup.failed,
          commError: result.commError?.kind,
        });
      } catch (err) {
        // A report failure has TWO distinct shapes, and which dashboard leg
        // covers it depends on whether the release CAS flipped the row terminal:
        //   - REFUSED RELEASE (row still claimed|running, no result written):
        //     the lease is left to the producer/fleet-health SWEEPER, which
        //     scans claimed|running rows for an EXPIRED lease and synthesizes a
        //     `worker-crashed-mid-job` comm error (REQ-B). The sweeper genuinely
        //     covers this case.
        //   - RESULT LOST (release SUCCEEDED → row is terminal, but the result
        //     write exhausted its retries): the row is done|failed with no
        //     result. The sweepers only scan claimed|running, so they NEVER see
        //     it — the control-plane RESULT-CONSUMER's resultless-past-grace leg
        //     is what synthesizes the comm error for this case (NOT the sweeper).
        // Either way the dashboard ends up showing "unreachable"; log and keep
        // pulling.
        logger.error("fleet.worker.report-error", {
          workerId,
          jobId: lease.job.id,
          err: err instanceof Error ? err.message : String(err),
        });
      } finally {
        // The job has settled — clear the current-job marker so the worker
        // shows idle again on the next heartbeat.
        notifyCurrentJob(null);
      }
    }
    logger.info("fleet.worker.loop-stopped", { workerId });
  })();

  return {
    async stop(): Promise<void> {
      if (stopped) {
        await done;
        return;
      }
      stopped = true;
      stopAbort.abort();
      await done;
    },
    done,
  };
}
