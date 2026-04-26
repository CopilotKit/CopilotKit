import type { ProbeConfig } from "./schema.js";
import type { DiscoveryRegistry, ProbeDriver } from "../types.js";
import type {
  Logger,
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";
import type { StatusWriter } from "../../writers/status-writer.js";

/**
 * Dependencies the invoker needs at build time. Kept as a single options
 * bag so new dependencies (metrics, bus, etc.) can be added without
 * refactoring every call site. Mirrors how the status-writer + alert-engine
 * receive their deps.
 */
export interface ProbeInvokerDeps {
  driver: ProbeDriver;
  discoveryRegistry: DiscoveryRegistry;
  writer: StatusWriter;
  logger: Logger;
  fetchImpl: typeof fetch;
  env: Readonly<Record<string, string | undefined>>;
  now(): Date;
}

/**
 * Keyed taxonomy on synthetic-error ProbeResults. Alert rules and the
 * dashboard branch on this discriminator instead of string-matching the
 * free-form `errorDesc`. Keep the union closed so a typo at a call site
 * surfaces as a TS error, not a silently-unmatched alert rule.
 */
export type ProbeInvokerErrorClass =
  | "timeout"
  | "input-rejected"
  | "driver-error"
  | "discovery-error"
  | "discovery-source-missing";

export interface ProbeInvokerSyntheticSignal {
  errorDesc: string;
  errorClass: ProbeInvokerErrorClass;
  /**
   * `err.name` from the originating exception (e.g. "TypeError",
   * "AbortError", "ZodError"). Operators triaging a timeout vs. a
   * TypeError need to distinguish the two without parsing the free-form
   * `errorDesc`. Optional: synthetic results that don't originate from
   * an Error (e.g. the misconfigured-discovery sentinel) leave it
   * undefined.
   */
  errName?: string;
}

/**
 * Build the per-probe handler the scheduler will invoke on each cron tick.
 * Three fan-out modes map to the three probe-config shapes:
 *
 *   - static (`cfg.targets`)  : iterate the YAML target list verbatim.
 *   - discovery (`cfg.discovery`): call the source, interpolate `key_template`
 *     against each record, and hand the resulting object to the driver.
 *   - single (`cfg.target`)   : one invocation with a single synthetic input.
 *
 * Across all three, each per-target run passes through:
 *   1. `driver.inputSchema.safeParse(input)` — on failure, log
 *      `probe.input-rejected` and emit a synthetic `state:"error"`
 *      ProbeResult for that key. The writer carries the tick forward so
 *      downstream rules can match on it; siblings proceed normally.
 *   2. `driver.run(ctx, input)` — wrapped in a `timeout_ms` guard (if set)
 *      and a try/catch that converts thrown exceptions into the same
 *      synthetic-error shape. One poisoned target must NEVER prevent
 *      siblings from writing.
 *   3. `writer.write(result)` — identical path to the deploy-result probe
 *      (see `orchestrator.ts`), so the entire alert-engine pipeline picks
 *      up probe ticks without special-case plumbing.
 *
 * Concurrency is bounded by `cfg.max_concurrency` via a hand-rolled pool
 * (no p-limit dependency). 10 slow drivers at max_concurrency=3 will never
 * have more than 3 simultaneous `driver.run` calls — prevents a stampede
 * of one probe from exhausting outbound sockets.
 */
export function buildProbeInvoker(
  cfg: ProbeConfig,
  deps: ProbeInvokerDeps,
): () => Promise<void> {
  const { driver, discoveryRegistry, writer, logger, env, now, fetchImpl } =
    deps;

  return async function invoke(): Promise<void> {
    // Defensive `Math.max(_, 1)` even though the schema guarantees
    // `max_concurrency >= 1` — a future schema relaxation must NOT silently
    // produce zero workers and drop every input on the floor.
    const concurrency = Math.max(cfg.max_concurrency, 1);
    const timeoutMs = "timeout_ms" in cfg ? cfg.timeout_ms : undefined;
    // Discovery-level abort controller: fires if the enumerate() call
    // exceeds the per-probe `timeout_ms`, so a stalled upstream releases
    // its socket rather than orphaning past the tick. Sources that honor
    // the signal (railway-services, etc.) abort their in-flight GraphQL
    // request; sources that don't still observe the natural completion
    // path.
    //
    // Worst-case wall-clock: discovery is budgeted at `timeout_ms` and
    // is followed by the bounded-pool fan-out which serialises
    // `⌈n/c⌉` "rounds" of per-target executors, each capped at
    // `timeout_ms`. That gives an absolute upper bound of roughly
    // `timeout_ms × (1 + ⌈n/c⌉)` — discovery + the longest possible
    // chain of per-worker rounds. In practice probes complete well
    // before any single timeout fires; this is the absolute ceiling
    // a stalled upstream could push the tick to.
    const inputs = await resolveInputs(
      cfg,
      discoveryRegistry,
      logger,
      fetchImpl,
      env,
      timeoutMs,
      now,
    );

    // Surface a misconfigured-discovery synthetic ProbeResult on the
    // dashboard. resolveInputs returns a single sentinel entry whose
    // input is `MISCONFIGURED_DISCOVERY_INPUT` when the YAML names a
    // discovery source the registry doesn't know — without this branch
    // operators only see the `probe.discovery-source-missing` log line.
    //
    // Same shape for `ENUMERATE_FAILED_INPUT`: when the discovery source
    // throws (network blip, schema drift, etc.), `resolveInputs`
    // collapses the failure into one sentinel entry so the operator
    // sees a single red tick rather than a silent zero-write
    // (indistinguishable from "no services matched the filter"). The
    // `errorClass` discriminates the two — alert rules / dashboard
    // branch on the discriminator instead of the free-form errorDesc.
    const sentinel = inputs.find(
      (i) =>
        i.input === MISCONFIGURED_DISCOVERY_INPUT ||
        i.input === ENUMERATE_FAILED_INPUT,
    );
    if (sentinel) {
      const errorClass: ProbeInvokerErrorClass =
        sentinel.input === ENUMERATE_FAILED_INPUT
          ? "discovery-error"
          : "discovery-source-missing";
      try {
        await writer.write(
          syntheticError(
            sentinel.key,
            sentinel.errorDesc ?? "discovery sentinel",
            now,
            errorClass,
          ),
        );
      } catch (err) {
        logErrorWithStack(logger, "probe.writer-failed", err, {
          probeId: cfg.id,
          kind: cfg.kind,
          key: sentinel.key,
        });
      }
      return;
    }

    // Shortest-service-first dispatch for `e2e_demos`: sort the resolved
    // inputs ascending by demo count BEFORE the worker pool picks them
    // up. Without this, the largest service (e.g. 38 demos) starting at
    // t=0 occupies a worker slot for the entire fan-out and small
    // services queue behind it — head-of-line blocking that delays
    // useful signal. Sorting puts small services first so they complete
    // and free slots while the big one chews through its demo list. Tie-
    // break on `key` ascending so dispatch order is fully deterministic
    // across ticks regardless of the discovery source's enumeration
    // order. Gated strictly on `cfg.kind === "e2e_demos"`; other probe
    // kinds keep their resolveInputs-order dispatch.
    //
    // Source of `demos` on the input: the `railway-services` discovery
    // source reads `registry.json` once per `enumerate()` call and
    // joins demos by slug onto every emitted record (see
    // `discovery/railway-services.ts:loadDemosMap`). That feed runs
    // BEFORE we land here, so `demoCount(input)` returns a real count
    // for production records. Static-target probe configs (no
    // discovery) don't carry `demos`, but they also can't be
    // `kind: e2e_demos` in practice — the gate below short-circuits
    // anyway.
    if (cfg.kind === "e2e_demos") {
      inputs.sort((a, b) => {
        const da = demoCount(a.input);
        const db = demoCount(b.input);
        if (da !== db) return da - db;
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      });
    }

    // Hand-rolled bounded pool. Each worker pulls from a shared index so
    // N workers process the M inputs cooperatively — no Promise.all
    // stampede even when M >> N.
    let cursor = 0;
    const runOne = async (): Promise<void> => {
      while (cursor < inputs.length) {
        const idx = cursor++;
        const item = inputs[idx];
        if (!item) break;
        const { input, key } = item;
        const result = await executeOne({
          input,
          key,
          driver,
          timeoutMs,
          env,
          now,
          logger,
          probeId: cfg.id,
          fetchImpl,
          parentWriter: writer,
        });
        try {
          await writer.write(result);
        } catch (err) {
          // Writer failures are already surfaced by status-writer's own
          // `writer.failed` bus emission. We log here for probe-side
          // correlation — don't re-throw, one writer hiccup mustn't
          // take down sibling targets in the same tick.
          logErrorWithStack(logger, "probe.writer-failed", err, {
            probeId: cfg.id,
            kind: cfg.kind,
            key,
          });
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, Math.max(inputs.length, 1)) },
      () => runOne(),
    );
    await Promise.all(workers);
  };
}

/**
 * Shape of a resolved-input entry: the synthetic key the writer will use
 * and the opaque input the driver runs against. Static configs pass the
 * YAML target object through; discovery configs pass the enumerated
 * record with `key` spliced in.
 */
interface ResolvedInput {
  input: unknown;
  key: string;
  /** Optional pre-canned errorDesc for sentinel inputs (misconfigured-discovery). */
  errorDesc?: string;
}

/**
 * Sentinel value used to flag a misconfigured-discovery resolution
 * (the YAML named a source the registry doesn't know). The invoker
 * checks identity-equality against this constant so it can emit a
 * synthetic `state: "error"` ProbeResult on the dashboard rather than
 * silently dropping the whole tick.
 */
const MISCONFIGURED_DISCOVERY_INPUT = Symbol("misconfigured-discovery-input");

/**
 * Sentinel value used to flag a discovery enumerate() failure (network
 * blip, schema mismatch, transport rejection, etc.). Returning a single
 * sentinel ResolvedInput — identity-checked by the invoker — lets the
 * top-level write path emit a synthetic `state: "error"` ProbeResult
 * with `errorClass: "discovery-error"`, instead of silently returning
 * zero inputs (which is indistinguishable on the dashboard from "no
 * services matched the filter"). Mirrors `MISCONFIGURED_DISCOVERY_INPUT`.
 */
const ENUMERATE_FAILED_INPUT = Symbol("enumerate-failed-input");

async function resolveInputs(
  cfg: ProbeConfig,
  discoveryRegistry: DiscoveryRegistry,
  logger: Logger,
  fetchImpl: typeof fetch,
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs: number | undefined,
  _now: () => Date,
): Promise<ResolvedInput[]> {
  if ("targets" in cfg) {
    // Static: the YAML target object IS the driver input. `.key` is
    // schema-required, so the writer key is just the target's own key.
    return cfg.targets.map((t) => ({ input: t, key: t.key }));
  }
  if ("discovery" in cfg) {
    const source = discoveryRegistry.get(cfg.discovery.source);
    if (!source) {
      logger.error("probe.discovery-source-missing", {
        probeId: cfg.id,
        source: cfg.discovery.source,
      });
      // Emit a synthetic-error sentinel input so the invoker writes a
      // visible error tick to the dashboard. Without this, an operator
      // typo'd `source:` produces a silent permanently-zero probe.
      return [
        {
          input: MISCONFIGURED_DISCOVERY_INPUT,
          key: `${cfg.id}:misconfigured`,
          errorDesc: `discovery source missing: ${cfg.discovery.source}`,
        },
      ];
    }
    // Pass the invoker's injected fetchImpl + env snapshot into the
    // source. Tests stub these via `deps`; production callers pass
    // `globalThis.fetch` + `process.env` at orchestrator boot.
    let records: unknown[] = [];
    // Discovery-level abort controller: honours the probe's `timeout_ms`
    // so a stalled enumerate() call releases its sockets on the same
    // schedule the per-target executor uses. The timer is cleared on
    // success to avoid dangling handles.
    const discoveryAbort = new AbortController();
    const discoveryTimer: ReturnType<typeof setTimeout> | null =
      timeoutMs !== undefined
        ? setTimeout(() => {
            discoveryAbort.abort(
              new Error(`discovery enumerate timeout after ${timeoutMs}ms`),
            );
          }, timeoutMs)
        : null;
    try {
      records = await source.enumerate(
        {
          fetchImpl,
          logger,
          env,
          abortSignal: discoveryAbort.signal,
        },
        cfg.discovery.filter ?? {},
      );
    } catch (err) {
      // A discovery failure is load-bearing: returning 0 inputs silently
      // looks identical on the dashboard to "no services matched the
      // filter" — operators get no signal that anything's wrong. Emit
      // both a structured log AND a sentinel ResolvedInput so the
      // invoker writes a single red tick keyed on `${probeId}:enumerate-
      // failed`. The invoker's top-level sentinel-handling path
      // (identity-checks `ENUMERATE_FAILED_INPUT`) writes a synthetic
      // `state: "error"` ProbeResult with `errorClass: "discovery-
      // error"`. Sibling probes are unaffected: this branch only
      // collapses the current probe's tick.
      logErrorWithStack(logger, "probe.discovery-enumerate-failed", err, {
        probeId: cfg.id,
        source: cfg.discovery.source,
      });
      const message = err instanceof Error ? err.message : String(err);
      return [
        {
          input: ENUMERATE_FAILED_INPUT,
          key: `${cfg.id}:enumerate-failed`,
          errorDesc: `discovery enumerate failed: ${message}`,
        },
      ];
    } finally {
      if (discoveryTimer !== null) clearTimeout(discoveryTimer);
      // NOTE: deliberately DO NOT call `discoveryAbort.abort()` here on
      // the success path. An unconditional `abort()` in the finally
      // signals timeout-on-success to any source listener that
      // snapshots `signal.reason` — exactly the inverse of what the
      // signal is meant to represent. Listener-cleanup is not a real
      // concern: the AbortController is local to this function call,
      // nothing outside resolveInputs holds a reference, and any
      // listeners attached by the source die with the controller as
      // soon as this function returns and the controller is GC'd.
    }
    return records.map((record, idx) => {
      const key = interpolateTemplate(
        cfg.discovery.key_template,
        record,
        logger,
        cfg.id,
        idx,
      );
      // Fold the resolved `key` into the input object so drivers can
      // emit ProbeResults keyed the same way the writer will look them
      // up. Record-as-input keeps discovery outputs self-describing.
      // Arrays match `typeof === "object"` but spread-with-key would
      // strip array shape, so guard explicitly.
      let input: unknown;
      if (record && typeof record === "object" && !Array.isArray(record)) {
        input = { ...(record as Record<string, unknown>), key };
      } else {
        if (Array.isArray(record)) {
          logger.warn("probe.discovery-record-non-object", {
            probeId: cfg.id,
            recordIndex: idx,
            recordKind: "array",
          });
        }
        input = { key };
      }
      return { input, key };
    });
  }
  // Single target: wrap the YAML entry verbatim.
  return [{ input: cfg.target, key: cfg.target.key }];
}

/**
 * Interpolate `${a.b.c}` path references in a key template against a
 * discovery record. Missing/non-primitive paths emit a structured warning
 * AND a unique `:__unresolved_<idx>` suffix so siblings whose template
 * collapses to the same prefix don't silently overwrite each other.
 *
 * Templates with literal `${}` (empty path) are still rendered: the
 * regex matches even an empty path slot and falls through the
 * non-primitive branch below, getting a unique suffix. Schema-level
 * validation that rejects `${}` at config-load time is desirable but not
 * load-bearing — the unresolvable-suffix path keeps the probe alive.
 */
function interpolateTemplate(
  template: string,
  record: unknown,
  logger: Logger,
  probeId: string,
  recordIndex: number,
): string {
  let unresolvedCounter = 0;
  return template.replace(/\$\{([^}]*)\}/g, (_match, rawPath: string) => {
    const path = rawPath.trim();
    if (path.length === 0) {
      logger.warn("probe.template-path-unresolvable", {
        probeId,
        template,
        path: "",
        recordIndex,
        reason: "empty-path",
      });
      const suffix = unresolvedCounter++;
      return `__unresolved_${recordIndex}_${suffix}`;
    }
    const value = resolvePath(record, path);
    if (value === undefined || value === null) {
      logger.warn("probe.template-path-unresolvable", {
        probeId,
        template,
        path,
        recordIndex,
        reason: "missing",
      });
      const suffix = unresolvedCounter++;
      return `__unresolved_${recordIndex}_${suffix}`;
    }
    if (typeof value === "object") {
      logger.warn("probe.template-path-unresolvable", {
        probeId,
        template,
        path,
        recordIndex,
        reason: "non-primitive",
      });
      const suffix = unresolvedCounter++;
      return `__unresolved_${recordIndex}_${suffix}`;
    }
    return String(value);
  });
}

/**
 * Demo-count extractor for `e2e_demos` shortest-first dispatch sort. The
 * `railway-services` discovery source emits records carrying a
 * `demos: string[]` field, joined from `registry.json` at enumerate-time
 * (see `discovery/railway-services.ts:loadDemosMap`). We read it without
 * trusting the shape, returning 0 for any input that isn't an object or
 * whose `demos` isn't an array. Pre-validation: `resolveInputs` produces
 * these entries before `executeOne` runs `inputSchema.safeParse`, so a
 * malformed record's count contributes 0 and it sorts to the front
 * (where it'll fail input validation immediately and free the slot for
 * the next sibling).
 */
function demoCount(input: unknown): number {
  if (input === null || typeof input !== "object") return 0;
  const demos = (input as Record<string, unknown>).demos;
  return Array.isArray(demos) ? demos.length : 0;
}

function resolvePath(obj: unknown, path: string): unknown {
  const segments = path.split(".");
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
    if (cur === undefined) return undefined;
  }
  return cur;
}

interface ExecuteOneOpts {
  input: unknown;
  key: string;
  driver: ProbeDriver;
  timeoutMs: number | undefined;
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  logger: Logger;
  probeId: string;
  fetchImpl: typeof fetch;
  /**
   * Writer the invoker hands to ctx.writer for driver side-emits. Named
   * `parentWriter` so it can't be confused with the local result-write
   * the invoker performs one level up.
   */
  parentWriter: ProbeResultWriter;
}

/**
 * Run one input through the driver with input-validation, timeout, and
 * exception-to-synthetic-error conversion. Single path for both static
 * and discovery-sourced inputs so a discovery bug produces the same
 * structured error as a hand-typo in YAML.
 */
async function executeOne(opts: ExecuteOneOpts): Promise<ProbeResult<unknown>> {
  const {
    input,
    key,
    driver,
    timeoutMs,
    env,
    now,
    logger,
    probeId,
    fetchImpl,
    parentWriter,
  } = opts;
  const parsed = driver.inputSchema.safeParse(input);
  if (!parsed.success) {
    logger.error("probe.input-rejected", {
      probeId,
      kind: driver.kind,
      key,
      err: parsed.error.message,
      issues: parsed.error.issues,
    });
    return syntheticError(
      key,
      `inputSchema rejected: ${parsed.error.message}`,
      now,
      "input-rejected",
      parsed.error.name,
    );
  }
  // Drivers that emit paired results (e.g. smoke → smoke+health) push the
  // secondary tick via `ctx.writer.write(...)`. The primary result the
  // driver RETURNS still flows through the invoker's own `writer.write`
  // call one level up so write-outcome bookkeeping stays centralized.
  // Drivers that call external HTTP endpoints (e.g. image-drift) use
  // `ctx.fetchImpl` so tests can stub the fetch layer at the boundary.
  //
  // AbortController wiring: the invoker races the driver promise against
  // a synthetic-timeout ProbeResult AND aborts the controller on timeout
  // so in-flight driver work (subprocesses, browsers, sockets) can stop
  // instead of orphaning. Drivers that observe `ctx.abortSignal` reject
  // their own promise on abort; drivers that don't still get a timeout
  // ProbeResult from the invoker's race path. Either way the invoker
  // returns promptly.
  const abortCtrl = new AbortController();
  const timeoutReason = `driver timeout after ${timeoutMs}ms`;
  let timedOut = false;
  // The timeoutPromise is wired to resolve directly from the timer
  // callback (no intermediate abort-listener hop). Anything else that
  // aborts the controller in the future cannot starve the timeout
  // promise, and a well-behaved driver that rejects on abort still
  // races against this promise and loses.
  let resolveTimeout: ((value: ProbeResult<unknown>) => void) | undefined;
  const timeoutPromise =
    timeoutMs !== undefined
      ? new Promise<ProbeResult<unknown>>((resolve) => {
          resolveTimeout = resolve;
        })
      : null;
  const timer: ReturnType<typeof setTimeout> | null =
    timeoutMs !== undefined
      ? setTimeout(() => {
          timedOut = true;
          if (resolveTimeout) {
            resolveTimeout(syntheticError(key, timeoutReason, now, "timeout"));
          }
          // Notify the driver via abort so a well-behaved driver can
          // stop in-flight work; this is decoupled from the timeout
          // resolution above.
          abortCtrl.abort(new Error(timeoutReason));
        }, timeoutMs)
      : null;
  const ctx: ProbeContext = {
    now,
    logger,
    env,
    writer: parentWriter,
    fetchImpl,
    abortSignal: abortCtrl.signal,
  };
  try {
    if (timeoutMs === undefined || timeoutPromise === null) {
      return await driver.run(ctx, parsed.data);
    }
    // Race the driver promise against the timeout promise. The driver
    // promise is detached with a `.catch(() => {})` clone so a driver
    // that rejects AFTER the timeout has already won the race doesn't
    // surface as an `unhandledRejection`. The original promise still
    // throws into the outer `try/catch` for the non-timeout path.
    const driverPromise = driver.run(ctx, parsed.data);
    // Attach a rejection observer so a late driver rejection is
    // surfaced — without it (or with a `.catch(() => {})` no-op) a
    // post-timeout chromium SIGSEGV / TypeError lands silently and
    // operators see only "timeout" with no underlying signal. We log at
    // debug rather than warn/error because the primary result has
    // already settled (operators have a timeout tick to act on); the
    // late signal is correlation-fuel for post-mortem, not an alertable
    // event of its own. Critically: this observer does NOT consume the
    // original `driverPromise` — it's a sibling chain, so the race path
    // still observes the rejection and routes it through the catch
    // block when `timedOut === false`.
    void driverPromise.catch((err) => {
      logger.debug("probe.driver-late-rejection", {
        probeId,
        kind: driver.kind,
        key,
        errName: err instanceof Error ? err.name : "unknown",
        err: err instanceof Error ? err.message : String(err),
      });
    });
    return await Promise.race([driverPromise, timeoutPromise]);
  } catch (err) {
    // If the driver rejected *because* it observed our abort, surface
    // the timeout synthetic-error rather than the driver's opaque
    // "AbortError" message. Otherwise fall through to the normal
    // error-to-synthetic path so siblings still proceed.
    if (timedOut) {
      return syntheticError(key, timeoutReason, now, "timeout");
    }
    const message = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : undefined;
    logErrorWithStack(logger, "probe.run-failed", err, {
      probeId,
      kind: driver.kind,
      key,
    });
    return syntheticError(key, message, now, "driver-error", errName);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function syntheticError(
  key: string,
  message: string,
  now: () => Date,
  errorClass: ProbeInvokerErrorClass,
  errName?: string,
): ProbeResult<ProbeInvokerSyntheticSignal> {
  const signal: ProbeInvokerSyntheticSignal = {
    errorDesc: message,
    errorClass,
  };
  // Only attach `errName` when present — keeps the wire shape minimal
  // for sentinel paths that don't originate from a real Error
  // (e.g. misconfigured-discovery / enumerate-failed sentinels), and
  // avoids forcing every existing test that asserts the exact signal
  // shape to add an undefined field.
  if (errName !== undefined) {
    signal.errName = errName;
  }
  return {
    key,
    state: "error",
    signal,
    observedAt: now().toISOString(),
  };
}

/**
 * Standardise the shape of `logger.error` calls so the structured-log
 * payload always carries `errName` + a truncated `stack` alongside the
 * message. Without this, `err.message` alone strips the type and stack —
 * making post-mortem on production logs much harder.
 *
 * Stack handling is two-tier:
 *
 *   - `logger.error(msg, ...)` carries a TRUNCATED stack (first 5 lines)
 *     because Slack/Pocketbase render budgets are tight and a
 *     full-frame Node stack drowns the alert.
 *   - `logger.debug("<msg>.full-stack", ...)` carries the FULL stack
 *     alongside, every time. Production debug-level logs flow into the
 *     orchestrator's structured log stream where storage is cheap and
 *     post-mortem operators can pull them on demand. Always emitting
 *     means the comment "the rest of the stack lives in the
 *     orchestrator's full log stream" is now load-bearing rather than
 *     aspirational.
 */
function logErrorWithStack(
  logger: Logger,
  msg: string,
  err: unknown,
  extra: Record<string, unknown> = {},
): void {
  const meta: Record<string, unknown> = { ...extra };
  let fullStack: string | undefined;
  if (err instanceof Error) {
    meta.err = err.message;
    meta.errName = err.name;
    if (err.stack) {
      meta.stack = err.stack.split("\n").slice(0, 5).join("\n");
      fullStack = err.stack;
    }
  } else {
    meta.err = String(err);
    meta.errName = "unknown";
  }
  logger.error(msg, meta);
  // Parallel debug emission carrying the full stack; only when we have
  // one (string-thrown values have no stack to preserve). Reuses the
  // same `extra` keys so log-aggregation can correlate the two.
  if (fullStack !== undefined) {
    logger.debug(`${msg}.full-stack`, { ...extra, stack: fullStack });
  }
}
