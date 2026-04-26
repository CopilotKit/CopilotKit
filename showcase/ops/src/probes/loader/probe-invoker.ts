import type { ProbeConfig } from "./schema.js";
import type { DiscoveryRegistry, ProbeDriver } from "../types.js";
import type {
  Logger,
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";
import type { StatusWriter } from "../../writers/status-writer.js";
import { truncateUtf8 } from "../../render/filters.js";
import { ProbeRunTracker } from "../run-tracker.js";
import type { ProbeRunWriter, ProbeRunSummary } from "../run-history.js";

/**
 * Bound the size of any string flowing into a synthetic-error ProbeResult.
 * Driver throws can carry multi-MB Playwright stack traces or browser
 * console dumps; without truncation those propagate untouched into
 * Pocketbase rows and Slack alerts, blowing past render budgets and
 * making the dashboard unreadable. Same budget the e2e drivers use
 * (`drivers/e2e-demos.ts`, `drivers/e2e-smoke.ts` — both at 1200) so the
 * synthetic path matches what drivers self-truncate to.
 */
const SYNTHETIC_ERROR_MSG_BUDGET = 1200;

/**
 * B7: minimal scheduler surface the invoker needs. Re-typed inline rather
 * than imported from `../scheduler/scheduler.ts` to keep this module
 * dependency-light (the full `Scheduler` interface owns cron + lifecycle
 * concerns the invoker has no business touching). The orchestrator wires
 * the real scheduler through; tests pass a fake.
 */
export interface InvokerScheduler {
  getEntry(id: string): { triggeredRun: boolean } | undefined;
  setEntryTracker(id: string, tracker: ProbeRunTracker | null): void;
}

/**
 * B7: pass/fail summary returned by the handler. The scheduler picks this
 * up via `runHandlerOnce` and stores it on the entry slot's
 * `lastRunSummary` for `GET /api/probes` consumers. Mirrors the scheduler's
 * own `RunSummary` shape (which we don't import to keep the dependency
 * graph one-way: scheduler → invoker is OK; invoker → scheduler types is
 * not — it would close a cycle).
 *
 * `discoveryFailed` flags the case where `resolveInputs()` blew up or
 * timed out. Operators distinguishing "no targets configured" from
 * "discovery broke" rely on this — without it a discovery-source outage
 * looks identical to a healthy zero-target run. When set, the run is
 * persisted with `state: "failed"` (CR-A1.5) and `failed: 1` so dashboards
 * surface a non-green tile rather than fake-green.
 */
export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  /**
   * True when discovery enumeration itself failed (source threw or timed
   * out). Distinct from per-target failures, which roll up into `failed`.
   */
  discoveryFailed?: boolean;
}

/**
 * Optional filter passed through from `scheduler.trigger(id, opts)` so
 * operators can re-run a probe against a subset of its discovered targets
 * (e.g. a Slack `/probe smoke --slugs starter-lg-react,starter-lg-py`
 * style invocation). `slugs` is the post-key_template slug list — i.e.
 * the same value the writer keys on. Drivers don't see this; the invoker
 * filters discovered inputs before fan-out so non-matching targets are
 * never enqueued or written.
 */
export interface InvokerTriggerOptions {
  filter?: { slugs?: string[] };
}

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
  /**
   * B7: optional scheduler reference. When supplied, the invoker registers
   * a `ProbeRunTracker` on the matching entry for the duration of the run
   * so `GET /api/probes` can surface inflight progress, and clears it
   * (sets to null) when the run completes. Optional so legacy callers
   * (and unit tests that don't care about scheduler-side bookkeeping)
   * keep working without wiring a fake scheduler.
   */
  scheduler?: InvokerScheduler;
  /**
   * R3-A.2: scheduler entry id the orchestrator registered this probe under.
   * The orchestrator prefixes probe ids with `probe:` so they don't collide
   * with rule-cron (`<ruleId>:cron:<idx>`) or internal (`internal:`) entries.
   * Pre-fix the invoker called `scheduler.getEntry(cfg.id)` and
   * `setEntryTracker(cfg.id, ...)` with the BARE id, so getEntry returned
   * undefined and setEntryTracker was a silent no-op against the live
   * scheduler — tracker registration was dead in production.
   *
   * R4-A.2: REQUIRED (no fallback). An earlier iteration defaulted this
   * to `cfg.id` for "backwards-compat," but that re-introduced the exact
   * silent no-op bug for any caller that forgot to pass the prefixed id.
   * Per fail-loud discipline, the orchestrator (production) and every
   * test must pass it explicitly — typecheck enforces it. Tests that
   * supply a fakeScheduler ignore the id arg anyway; passing `cfg.id`
   * costs them one line and removes a class of silent regressions.
   */
  schedulerId: string;
  /**
   * B7: optional probe-runs collection writer. When supplied, each
   * invocation inserts a `running` row at start and updates it with
   * `state: 'completed' | 'failed'` plus the RunSummary at finish. Failures
   * inside the writer are caught + logged but never thrown — probe_runs is
   * observability, not a load-bearing path.
   */
  runWriter?: ProbeRunWriter;
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
): (opts?: InvokerTriggerOptions) => Promise<RunSummary> {
  const {
    driver,
    discoveryRegistry,
    writer,
    logger,
    env,
    now,
    fetchImpl,
    scheduler,
    runWriter,
  } = deps;
  // R3-A.2 / R4-A.2: canonical scheduler entry id, REQUIRED at build time.
  // Production callers (orchestrator) supply the prefixed form
  // (`probe:<cfg.id>`). The earlier `?? cfg.id` fallback masked the bug
  // it was meant to fix — the field is now required so a typecheck
  // failure surfaces forgotten id-prefixing instead of a silent no-op.
  const schedulerEntryId = deps.schedulerId;

  return async function invoke(
    invokeOpts?: InvokerTriggerOptions,
  ): Promise<RunSummary> {
    // Defensive `Math.max(_, 1)` even though the schema guarantees
    // `max_concurrency >= 1` — a future schema relaxation must NOT silently
    // produce zero workers and drop every input on the floor.
    const concurrency = Math.max(cfg.max_concurrency, 1);
    const timeoutMs = "timeout_ms" in cfg ? cfg.timeout_ms : undefined;

    // B7: tracker registration. Read the slot's `triggeredRun` flag — set
    // by scheduler.trigger() before the handler runs — so the snapshot the
    // HTTP layer surfaces tells operators whether this run came from a
    // manual trigger or a cron tick. Falling back to false keeps the
    // behavior sane when no scheduler is wired (tests, future direct callers).
    // R3-A.2: use the prefixed scheduler entry id (resolved above) rather
    // than the bare cfg.id, so getEntry/setEntryTracker actually find the
    // live scheduler entry registered by the orchestrator.
    const triggered =
      scheduler?.getEntry(schedulerEntryId)?.triggeredRun ?? false;
    const tracker = new ProbeRunTracker({ probeId: cfg.id, triggered });
    scheduler?.setEntryTracker(schedulerEntryId, tracker);

    // B7: probe_runs writer. Insert a `running` row up-front so the row's
    // `started_at` matches the wall-clock the tracker captured. Failures
    // here are best-effort — observability must never tank the probe.
    let runRowId: string | null = null;
    if (runWriter) {
      try {
        const created = await runWriter.start({
          probeId: cfg.id,
          startedAt: Date.now(),
          triggered,
        });
        runRowId = created.id;
      } catch (err) {
        logger.error("probe.run-writer-start-failed", {
          probeId: cfg.id,
          err: err instanceof Error ? err.message : String(err),
        });
        // R3-A.3: orphan-risk warn. The PB-side `create` may have
        // succeeded before the response was lost (network blip), in which
        // case a `running` row exists with no caller holding the id —
        // it'll never transition to completed/failed. Surface a structured
        // warn alongside the error log so operators can grep
        // `probe.run-row-orphan-risk` and reconcile orphans (a separate
        // sweeper / manual cleanup is outside this fix's scope; the log
        // is the observability surface). Run continues normally — a
        // missed history row must NEVER block the actual probe work.
        logger.warn("probe.run-row-orphan-risk", {
          probeId: cfg.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

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
    //
    // CR-A1.5/A1.8: resolveInputs returns a discriminated result so the
    // invoker can tell "no targets matched" (success, ok=true, empty)
    // from "discovery broke" (failed, ok=false). The latter flows into a
    // synthetic-error tile + state="failed" persistence so dashboards
    // distinguish a misconfigured filter from an upstream outage.
    const resolved = await resolveInputs(
      cfg,
      discoveryRegistry,
      logger,
      fetchImpl,
      env,
      timeoutMs,
      now,
    );
    // When discovery failed (`ok: false`), the inputs roster is empty —
    // the synthetic-error tile is emitted below and there's nothing to
    // fan out across.
    const allInputs: ResolvedInput[] = resolved.ok ? resolved.inputs : [];

    // CR-A1.1: thread the trigger's slug filter end-to-end. Discover the
    // FULL roster (so logs/diagnostics still see what the source returned)
    // but only enqueue + run the slugs the operator asked for. Empty
    // filter list means "no slugs match" — keep the run honest rather
    // than silently degrading to "filter=undefined → run everything".
    const filterSlugs = invokeOpts?.filter?.slugs;
    let inputs: ResolvedInput[] = allInputs;
    if (filterSlugs !== undefined) {
      const wanted = new Set(filterSlugs);
      // R3-A.1: ALWAYS retain preError-bearing inputs through the filter.
      // Their synthetic keys (e.g. `<probeId>:invalid-key-template:N`) are
      // generated by the resolver for records that fail key_template
      // interpolation — they won't match operator-supplied slugs, so a
      // pre-fix `wanted.has(r.key)` filter dropped them silently. That
      // hid discovery-time key-template errors from manual-trigger
      // investigations, which is the EXACT path operators use to surface
      // problems. Surface preErrors regardless of filter so a `--slugs foo`
      // trigger still sees the misconfigured-record tiles alongside foo's
      // result.
      inputs = allInputs.filter(
        (r) => r.preError !== undefined || wanted.has(r.key),
      );
    }

    // B7: register every targeted service as queued before any of them
    // run, so a snapshot taken between resolveInputs() and the first
    // start() shows the full target roster the run will execute against.
    for (const { key } of inputs) tracker.enqueue(key);

    let passed = 0;
    let failed = 0;

    // CR-A1.5: discovery enumerate failure short-circuits the fan-out.
    // Surface a synthetic-error ProbeResult (so the alert-engine sees a
    // non-green tick) and persist state="failed" with discoveryFailed:true
    // so operators can tell "no targets" from "discovery broke."
    //
    // R2-A.1: do NOT call `tracker.fail(cfg.id, ...)` — the probe id is
    // not a service slug, and stuffing it into the tracker pollutes the
    // per-service inflight roster surfaced by GET /api/probes. The
    // failure is conveyed structurally via `discoveryFailed: true` in
    // the snapshot/summary; the synthetic-error ProbeResult below
    // carries the human-readable description through to the writer.
    // The failed-counter here counts the discovery itself as the single
    // failed unit so RunSummary's invariant holds (total === passed+failed).
    if (!resolved.ok) {
      const errResult = syntheticError(
        cfg.id,
        `discovery enumerate failed: ${resolved.error}`,
        now,
        "discovery-error",
      );
      failed++;
      try {
        await writer.write(errResult);
      } catch (err) {
        logger.error("probe.writer-failed", {
          probeId: cfg.id,
          kind: cfg.kind,
          key: cfg.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Suppress lint warning for the unused full-roster reference; it's kept
    // around for diagnostics & potential future "filter requested N, M
    // discovered" logging.
    void allInputs;

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
      // The sentinel itself counts as the single failure unit so the
      // RunSummary invariant (total === passed + failed) holds.
      // Finalize the run row + clear the tracker so we don't leak the
      // observability state we set up at the top of invoke().
      tracker.fail(sentinel.key, sentinel.errorDesc ?? "discovery sentinel");
      const sentinelSummary: RunSummary = {
        total: 1,
        passed: 0,
        failed: 1,
        discoveryFailed: true,
      };
      if (runWriter && runRowId !== null) {
        try {
          await runWriter.finish({
            id: runRowId,
            finishedAt: Date.now(),
            state: "failed",
            summary: {
              total: sentinelSummary.total,
              passed: sentinelSummary.passed,
              failed: sentinelSummary.failed,
            } satisfies ProbeRunSummary,
          });
        } catch (err) {
          logger.error("probe.run-writer-finish-failed", {
            probeId: cfg.id,
            runId: runRowId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      scheduler?.setEntryTracker(schedulerEntryId, null);
      return sentinelSummary;
    }

    // Shortest-service-first dispatch for `e2e_demos`: sort the resolved
    // inputs ascending by demo count BEFORE the worker pool picks them
    // up. Without this, the largest service (e.g. 38 demos) starting at
    // t=0 occupies a worker slot for the entire fan-out and small
    // services queue behind it — head-of-line blocking that delays
    // useful signal under bounded concurrency. Sorting puts small
    // services first so they complete and free slots while the big one
    // chews through its demo list, reducing tail latency. Tie-break on
    // `key` ascending so dispatch order is fully deterministic across
    // ticks regardless of the discovery source's enumeration order.
    //
    // Gate is `kind === "e2e_demos" && "discovery" in cfg` — the second
    // half blocks a hypothetical static-targets `e2e_demos` config from
    // sorting alphabetically. A static config's records lack `demos`,
    // so `demoCount(input)` returns 0 for every entry and the tie-break
    // on `key` would silently re-order the YAML. Tightening here keeps
    // the YAML's authored order authoritative for any non-discovery
    // shape that might land later.
    //
    // Source of `demos` on the input: the `railway-services` discovery
    // source reads `registry.json` once per `enumerate()` call and
    // joins demos by slug onto every emitted record (see
    // `discovery/railway-services.ts:loadDemosMap`). That feed runs
    // BEFORE we land here, so `demoCount(input)` returns a real count
    // for production records.
    if (cfg.kind === "e2e_demos" && "discovery" in cfg) {
      // Skip the sort entirely when every input has demoCount=0 — the
      // tie-break on `key` would silently re-order discovery's natural
      // emission order without operator signal. The most common cause
      // is `registry.json` missing/corrupt at the discovery source, so
      // emit a structured warn so the operator can correlate.
      const anyDemos = inputs.some((i) => demoCount(i.input) > 0);
      if (!anyDemos) {
        logger.warn("probe.e2e-demos.sort-no-demos", {
          probeId: cfg.id,
          inputCount: inputs.length,
          hint: "every record has demoCount=0; registry.json may be missing/corrupt",
        });
      } else {
        inputs.sort((a, b) => {
          const da = demoCount(a.input);
          const db = demoCount(b.input);
          if (da !== db) return da - db;
          return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
        });
      }
    }

    // Discovery returned zero records (or every record was filtered out
    // by `nameExcludes` upstream). Static / single-target probes can't
    // hit this path — the schema requires `min(1)` for both. Emit a
    // structured info log so operators can correlate "no signal" against
    // "discovery returned empty"; without this the tick is silent.
    // Behaviour is unchanged: zero inputs still mean zero writes for
    // this tick.
    if (inputs.length === 0) {
      logger.info("probe.no-inputs", {
        probeId: cfg.id,
        kind: cfg.kind,
      });
    }

    // Hand-rolled bounded pool. Each worker pulls from a shared index so
    // N workers process the M inputs cooperatively — no Promise.all
    // stampede even when M >> N.
    let cursor = 0;
    const runOne = async (): Promise<void> => {
      while (cursor < inputs.length) {
        // Invariant: `idx < inputs.length` from the loop precondition,
        // so `inputs[idx]` is always defined. Non-null assertion avoids
        // a dead defensive guard.
        const idx = cursor++;
        const { input, key, preError } = inputs[idx]!;
        // B7: mark running just before handing the input to the driver.
        tracker.start(key);
        // CR-A1.2: short-circuit on inputs the resolver pre-flagged as
        // un-runnable (e.g. key_template missing fields). The driver
        // never sees them — emit the synthetic error and move on.
        const result =
          preError !== undefined
            ? syntheticError(key, preError, now, "input-rejected")
            : await executeOne({
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
        // B7: classify the per-target outcome for the tracker. The
        // ProbeState → tracker-result mapping:
        //   green     → tracker.complete(slug, "green")  passed++
        //   degraded  → tracker.complete(slug, "yellow") failed++  (degraded contributes to failure count for surfacing)
        //   red       → tracker.complete(slug, "red")    failed++
        //   error     → tracker.fail(slug, errorDesc)    failed++
        // The summary's `failed` count rolls up degraded + red + error so
        // the scheduler-side `lastRunSummary` reflects "anything not green".
        if (result.state === "error") {
          const errDesc =
            (result.signal as { errorDesc?: string } | undefined)?.errorDesc ??
            "unknown error";
          tracker.fail(key, errDesc);
          failed++;
        } else if (result.state === "green") {
          tracker.complete(key, "green");
          passed++;
        } else if (result.state === "degraded") {
          tracker.complete(key, "yellow");
          failed++;
        } else {
          // result.state === "red"
          tracker.complete(key, "red");
          failed++;
        }
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

    // CR-A1.5: a failed enumerate also flips the run state to "failed"
    // — the probe didn't get a chance to do its job. Per-target driver
    // failures don't escalate the run state (they're captured in the
    // failed counter); discovery failure is structural.
    let runState: "completed" | "failed" = resolved.ok ? "completed" : "failed";
    // R4-A.7: when the outer catch fires, we synthesize an internal-
    // invariant tile and bump `failed`. Track that with a flag so the
    // RunSummary.total below adds 1 for the synthetic tile (preserving
    // the `total === passed + failed` invariant).
    let outerInvariantFailure = false;
    try {
      // Skip fan-out when discovery failed — there are no inputs to fan
      // out across, and the synthetic-error tile is already emitted.
      if (resolved.ok) {
        const workers = Array.from(
          { length: Math.min(concurrency, Math.max(inputs.length, 1)) },
          () => runOne(),
        );
        await Promise.all(workers);
      }
    } catch (err) {
      // R4-A.7: should be unreachable — per-target executeOne already
      // converts driver throws into synthetic ProbeResults. If it ever
      // fires, an invariant in the inner fan-out broke. Don't silently
      // log-and-continue: synthesize a fail-loud tile keyed on a
      // sentinel slug, bump the failed counter, and flip runState so
      // the run summary reports `state: "failed"` with `failed >= 1`.
      // Logged at error (not warn) — this is a real defect surface.
      runState = "failed";
      outerInvariantFailure = true;
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      logger.error("probe.invoker-unhandled", {
        probeId: cfg.id,
        err: message,
      });
      const internalKey = `${cfg.id}:__internal_invariant__`;
      const errResult = syntheticError(
        internalKey,
        `invoker invariant broken: ${message}`,
        now,
        "driver-error",
      );
      try {
        await writer.write(errResult);
      } catch (writeErr) {
        // Even the writer failed — log and move on; the run is already
        // marked failed and finally-block bookkeeping must still run.
        logger.error("probe.writer-failed", {
          probeId: cfg.id,
          kind: cfg.kind,
          key: internalKey,
          err: writeErr instanceof Error ? writeErr.message : String(writeErr),
        });
      }
    } finally {
      // R2-A.1: when discovery failed, treat the discovery itself as a
      // single failed unit so the RunSummary invariant
      // (total === passed + failed) holds. inputs.length is 0 in that
      // case (no per-target fan-out), and `failed` was bumped by 1
      // above for the synthetic-error tile, so total must be 1 too.
      //
      // R4-A.7: when the outer invariant catch fires, fan-out aborted
      // partway — `inputs.length` may not equal what was actually
      // processed (some targets may have completed before the throw,
      // others never started). Use the partial passed/failed tally
      // (which already includes the +1 synthetic invariant tile) so
      // `total === passed + failed` holds by construction. The
      // discoveryFailed and happy-path branches keep their existing
      // `total` semantics.
      const baseTotal = outerInvariantFailure
        ? passed + failed
        : resolved.ok
          ? inputs.length
          : 1;
      const summary: RunSummary = {
        total: baseTotal,
        passed,
        failed,
        ...(resolved.ok ? {} : { discoveryFailed: true }),
      };
      // B7: finalize the run row. Best-effort: log + swallow on failure so
      // a misbehaving PB never crashes the scheduler tick.
      if (runWriter && runRowId !== null) {
        const persistSummary: ProbeRunSummary = {
          total: summary.total,
          passed: summary.passed,
          failed: summary.failed,
        };
        try {
          await runWriter.finish({
            id: runRowId,
            finishedAt: Date.now(),
            state: runState,
            summary: persistSummary,
          });
        } catch (err) {
          logger.error("probe.run-writer-finish-failed", {
            probeId: cfg.id,
            runId: runRowId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // B7: clear the tracker so the next snapshot reports no inflight run.
      // Done in `finally` so even an unexpected throw still leaves the
      // scheduler's view clean. R3-A.2: same prefixed id as registration.
      scheduler?.setEntryTracker(schedulerEntryId, null);
    }

    // R2-A.1: same total-vs-(passed+failed) invariant in the return —
    // mirror the persisted summary above.
    // R4-A.7: when the outer catch fired, fall back to the partial
    // passed+failed sum (which already includes the +1 synthetic
    // invariant tile) so the returned summary matches what was
    // persisted by the finally block above.
    const returnTotal = outerInvariantFailure
      ? passed + failed
      : resolved.ok
        ? inputs.length
        : 1;
    return {
      total: returnTotal,
      passed,
      failed,
      ...(resolved.ok ? {} : { discoveryFailed: true }),
    };
  };
}

/**
 * Shape of a resolved-input entry: the synthetic key the writer will use,
 * the opaque input the driver runs against, and (optionally) a
 * pre-computed synthetic-error result that should be emitted INSTEAD of
 * running the driver. Static configs pass the YAML target object through;
 * discovery configs pass the enumerated record with `key` spliced in.
 *
 * CR-A1.2: when `interpolateTemplate` can't resolve a templated path
 * against a record, the invoker stamps `preError` here so the per-record
 * synthetic-error result surfaces fail-loud rather than silently
 * collapsing into an empty-string key (which would either collide with
 * sibling records or overwrite each other in the writer).
 */
interface ResolvedInput {
  input: unknown;
  key: string;
  /** Optional pre-canned errorDesc for sentinel inputs (misconfigured-discovery). */
  errorDesc?: string;
  preError?: string;
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

/**
 * Discriminated result of `resolveInputs`. `ok: true` carries the
 * inputs to fan out across; `ok: false` carries the human-readable
 * error so callers (CR-A1.5) can surface it as a synthetic-error
 * ProbeResult and persist `state: "failed"`. Distinct from "empty
 * inputs": an empty list with `ok: true` means "no targets matched
 * the filter," not "discovery broke."
 */
type ResolvedInputs =
  | { ok: true; inputs: ResolvedInput[] }
  | { ok: false; error: string };


async function resolveInputs(
  cfg: ProbeConfig,
  discoveryRegistry: DiscoveryRegistry,
  logger: Logger,
  fetchImpl: typeof fetch,
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs: number | undefined,
  _now: () => Date,
): Promise<ResolvedInputs> {
  if ("targets" in cfg) {
    // Static: the YAML target object IS the driver input. `.key` is
    // schema-required, so the writer key is just the target's own key.
    return {
      ok: true,
      inputs: cfg.targets.map((t) => ({ input: t, key: t.key })),
    };
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
      // typo'd `source:` produces a silent permanently-zero probe. Wrap
      // in the discriminated `ok: true` shape so the upstream sentinel
      // branch (errorClass: "discovery-source-missing") fires; the
      // distinct `ok: false` path is reserved for enumerate() failures.
      return {
        ok: true,
        inputs: [
          {
            input: MISCONFIGURED_DISCOVERY_INPUT,
            key: `${cfg.id}:misconfigured`,
            errorDesc: `discovery source missing: ${cfg.discovery.source}`,
          },
        ],
      };
    }
    // Pass the invoker's injected fetchImpl + env snapshot into the
    // source. Tests stub these via `deps`; production callers pass
    // `globalThis.fetch` + `process.env` at orchestrator boot.
    let records: unknown[] = [];
    // Discovery-level abort controller: honours the probe's `timeout_ms`
    // so a stalled enumerate() call releases its sockets on the same
    // schedule the per-target executor uses. The timer is cleared on
    // success to avoid dangling handles.
    //
    // CR-A1.8: race enumerate() against an abort-driven timeout promise
    // so a source that ignores `abortSignal` cannot stall the tick
    // forever. Mirrors the executeOne() pattern. Sources that DO honour
    // abortSignal still abort their underlying work; sources that don't
    // get bypassed by the race resolution and the invoker treats it as
    // a discovery failure (state="failed").
    const discoveryAbort = new AbortController();
    let discoveryTimedOut = false;
    const discoveryTimer: ReturnType<typeof setTimeout> | null =
      timeoutMs !== undefined
        ? setTimeout(() => {
            discoveryTimedOut = true;
            discoveryAbort.abort(
              new Error(`discovery enumerate timeout after ${timeoutMs}ms`),
            );
          }, timeoutMs)
        : null;
    try {
      const enumeratePromise = source.enumerate(
        {
          fetchImpl,
          logger,
          env,
          abortSignal: discoveryAbort.signal,
        },
        cfg.discovery.filter ?? {},
      );
      // R2-A.3: absorb late rejections from enumerate — same rationale
      // as R2-A.2. If the timeoutPromise wins, the enumerate promise
      // continues running and may eventually reject; without a catch
      // that becomes an UnhandledRejection. Attach a no-op catch so
      // the orphan tail is silenced; the actual race outcome is still
      // decided by whichever promise settles first.
      enumeratePromise.catch(() => {});
      if (timeoutMs === undefined) {
        records = await enumeratePromise;
      } else {
        const timeoutPromise = new Promise<unknown[]>((_resolve, reject) => {
          discoveryAbort.signal.addEventListener(
            "abort",
            () => {
              if (discoveryTimedOut) {
                reject(
                  new Error(`discovery enumerate timeout after ${timeoutMs}ms`),
                );
              }
            },
            { once: true },
          );
        });
        records = await Promise.race([enumeratePromise, timeoutPromise]);
      }
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
      const message = err instanceof Error ? err.message : String(err);
      logErrorWithStack(logger, "probe.discovery-enumerate-failed", err, {
        probeId: cfg.id,
        source: cfg.discovery.source,
      });
      return {
        ok: true,
        inputs: [
          {
            input: ENUMERATE_FAILED_INPUT,
            key: `${cfg.id}:enumerate-failed`,
            errorDesc: `discovery enumerate failed: ${message}`,
          },
        ],
      };
    } finally {
      if (discoveryTimer !== null) clearTimeout(discoveryTimer);
      // NOTE: deliberately DO NOT call `discoveryAbort.abort()` here on
      // the success path. An unconditional `abort()` in the finally
      // signals timeout-on-success to any source listener that
      // snapshots `signal.reason` — exactly the inverse of what the
      // signal is meant to represent.
      //
      // Listener-leak window: any `signal.addEventListener("abort", ...)`
      // closures attached by the source remain reachable through
      // `discoveryAbort.signal` until this function returns and the
      // controller becomes unreachable. We have no API to remove them
      // explicitly (the source owns the listener it registered, not
      // us), so the window is bounded by GC of the controller after
      // resolveInputs returns. For long-lived sources this is a slow
      // leak per probe tick rather than per record; in practice GC
      // reclaims it on the next major collection. Acceptable until/
      // unless we measure it as a hot spot.
    }
    const resolvedInputs: ResolvedInput[] = [];
    let dupSerial = 0;
    let idx = -1;
    for (const record of records) {
      idx += 1;
      const interp = interpolateTemplateStrict(
        cfg.discovery.key_template,
        record,
      );
      if (!interp.ok) {
        // CR-A1.2: refuse to collapse missing-field records into an
        // empty/partial key — that produces tracker.services Map
        // collisions and writer overwrites that look exactly like
        // "everything is fine, just no data." Emit a fail-loud
        // synthetic-error result keyed off a unique sentinel so each
        // bad record surfaces independently in the writer + tracker.
        dupSerial += 1;
        const safeKey = `${cfg.id}:invalid-key-template:${dupSerial}`;
        const errMsg =
          interp.reason === "missing"
            ? `key_template missing field: ${interp.missingPath}`
            : interp.reason === "empty-path"
              ? `key_template empty path`
              : `key_template ${interp.reason}: ${interp.missingPath}`;
        logger.error("probe.key-template-missing-field", {
          probeId: cfg.id,
          template: cfg.discovery.key_template,
          missingPath: interp.missingPath,
          reason: interp.reason,
        });
        resolvedInputs.push({
          input:
            record && typeof record === "object"
              ? { ...(record as Record<string, unknown>), key: safeKey }
              : { key: safeKey },
          key: safeKey,
          preError: errMsg,
        });
        continue;
      }
      const key = interp.value;
      // Fold the resolved `key` into the input object so drivers can
      // emit ProbeResults keyed the same way the writer will look them
      // up. Record-as-input keeps discovery outputs self-describing.
      // Arrays match `typeof === "object"` but spread-with-key would
      // strip array shape, so guard explicitly.
      let input: unknown;
      // Object-shape gate: arrays match `typeof === "object"` but spread-
      // with-key would strip array shape. Null/undefined/primitive records
      // (string/number/boolean) all fall through to the `{ key }`-only
      // input below and now carry a structured warn so silent zero-info
      // inputs surface in the log.
      if (
        record !== null &&
        typeof record === "object" &&
        !Array.isArray(record)
      ) {
        // If the discovery source already emitted a `key` field whose
        // value differs from the interpolated one, the spread+overwrite
        // below silently shadows it. Surface a structured warning so
        // operators discover when a source's natural payload happens
        // to carry `key` (e.g. a service whose env exports `key=...`)
        // — the interpolated value remains authoritative (it's the one
        // the writer dedupes on), but invisible mutation of caller
        // payloads is the kind of foot-gun that bites long after
        // shipping.
        const recordKey = (record as Record<string, unknown>).key;
        if (recordKey !== undefined && recordKey !== key) {
          logger.warn("probe.discovery-record-key-shadowed", {
            probeId: cfg.id,
            recordIndex: idx,
            interpolatedKey: key,
            recordKey:
              typeof recordKey === "string" ? recordKey : typeof recordKey,
          });
        }
        input = { ...(record as Record<string, unknown>), key };
      } else {
        // Single warn key for every non-object record (array, null,
        // primitive). The `recordKind` field discriminates so log
        // consumers can branch without parsing free-form messages.
        const recordKind = Array.isArray(record)
          ? "array"
          : record === null
            ? "null"
            : typeof record;
        logger.warn("probe.discovery-record-non-object", {
          probeId: cfg.id,
          recordIndex: idx,
          recordKind,
        });
        input = { key };
      }
      resolvedInputs.push({ input, key });
    }
    return { ok: true, inputs: resolvedInputs };
  }
  // Single target: wrap the YAML entry verbatim.
  return { ok: true, inputs: [{ input: cfg.target, key: cfg.target.key }] };
}

/**
 * Strict interpolation (CR-A1.2): walk the template and short-circuit on
 * the first missing/null path, returning a discriminated result so callers
 * can emit a per-record synthetic-error and skip the driver. Pre-fix, the
 * non-strict variant rendered missing paths as empty strings and every
 * such record collapsed to the same writer key, silently overwriting
 * siblings. The non-strict `interpolateTemplate` below is retained as
 * deprecated/unused — its rich __unresolved_<idx>_<n> suffix logic and
 * structured warnings (empty-path, missing, non-primitive, empty-string)
 * remain available for any caller that wants empty-on-missing semantics.
 */
interface InterpResult {
  ok: true;
  value: string;
}
interface InterpFail {
  ok: false;
  missingPath: string;
  reason: "missing" | "non-primitive" | "empty-string" | "empty-path";
}

function interpolateTemplateStrict(
  template: string,
  record: unknown,
): InterpResult | InterpFail {
  // Walk the template manually so the first missing path short-circuits
  // (a regex-replace callback can't bail without an outer flag dance).
  let out = "";
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf("${", i);
    if (open === -1) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const close = template.indexOf("}", open + 2);
    if (close === -1) {
      // Unterminated `${` — treat as literal so we don't drop suffix text.
      out += template.slice(open);
      break;
    }
    const path = template.slice(open + 2, close).trim();
    if (path.length === 0) {
      return { ok: false, missingPath: "", reason: "empty-path" };
    }
    const value = resolvePath(record, path);
    if (value === undefined || value === null) {
      return { ok: false, missingPath: path, reason: "missing" };
    }
    // Non-primitive: stringifying an object yields `[object Object]` which
    // collapses every record at this slot into one writer key — fail loud
    // (HEAD's load-bearing branch from the deprecated non-strict variant).
    if (typeof value === "object") {
      return { ok: false, missingPath: path, reason: "non-primitive" };
    }
    // Empty-string primitive: same collision risk as missing — every record
    // with `""` here collapses to the same prefix. `0` and `false` are real
    // primitives and stringify normally.
    if (typeof value === "string" && value.length === 0) {
      return { ok: false, missingPath: path, reason: "empty-string" };
    }
    out += String(value);
    i = close + 1;
  }
  return { ok: true, value: out };
}

/**
 * @deprecated Retained for backwards-compat. New code should use
 * `interpolateTemplateStrict` so missing fields fail loud (CR-A1.2). HEAD's
 * unique `__unresolved_<idx>_<n>` suffix branch keeps this variant useful
 * for any future caller that wants empty-on-missing semantics without
 * silent collisions.
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
    // Empty-string primitive: same collision risk as a missing path —
    // every record with `""` at this slot collapses to the same prefix
    // and the writer overwrites earlier siblings. `0` and `false` are
    // real primitives and stringify normally below.
    if (typeof value === "string" && value.length === 0) {
      logger.warn("probe.template-path-unresolvable", {
        probeId,
        template,
        path,
        recordIndex,
        reason: "empty-string",
      });
      const suffix = unresolvedCounter++;
      return `__unresolved_${recordIndex}_${suffix}`;
    }
    return String(value);
  });
}
// Suppress unused-warning so the deprecated helper survives without an
// `// eslint-disable` line cluttering the export.
void interpolateTemplate;

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
            resolveTimeout(
              syntheticError(
                key,
                timeoutReason,
                now,
                "timeout",
                "TimeoutError",
              ),
            );
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
      // Guard: a driver rejection BEFORE the timeout fires reaches both
      // this detached observer AND the outer `try/catch` (which logs
      // `probe.run-failed` and emits the `driver-error` synthetic). Without
      // this guard we'd double-log on every normal rejection. Only fire
      // for true late rejections — i.e. the timeout path won the race
      // and the driver rejected afterwards.
      if (!timedOut) return;
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
      return syntheticError(key, timeoutReason, now, "timeout", "TimeoutError");
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
  // Bound the errorDesc — a driver throw or sentinel message can be a
  // multi-MB Playwright stack; without truncation it lands verbatim in
  // PB rows / Slack alerts and blows past render budgets. See
  // SYNTHETIC_ERROR_MSG_BUDGET above for why 1200.
  const signal: ProbeInvokerSyntheticSignal = {
    errorDesc: truncateUtf8(message, SYNTHETIC_ERROR_MSG_BUDGET),
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
 *     alongside — only when one is available (string-thrown values have
 *     no stack to preserve). Production debug-level logs flow into the
 *     orchestrator's structured log stream where storage is cheap and
 *     post-mortem operators can pull them on demand. When a stack is
 *     present this also emits, so "the rest of the stack lives in the
 *     orchestrator's full log stream" is load-bearing rather than
 *     aspirational.
 */
export function logErrorWithStack(
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
