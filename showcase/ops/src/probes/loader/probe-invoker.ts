import type { ProbeConfig } from "./schema.js";
import type { DiscoveryRegistry, ProbeDriver } from "../types.js";
import type {
  Logger,
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";
import type { StatusWriter } from "../../writers/status-writer.js";
import { ProbeRunTracker } from "../run-tracker.js";
import type { ProbeRunWriter, ProbeRunSummary } from "../run-history.js";

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
   * Optional for backwards-compat: tests that pass a fakeScheduler ignore
   * the id parameter, so they keep working without changes. Production
   * callers (orchestrator) MUST pass the prefixed id. Defaults to `cfg.id`
   * when omitted to preserve existing test fixtures.
   */
  schedulerId?: string;
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
  // R3-A.2: resolve the canonical scheduler entry id ONCE at handler-build
  // time. Production callers (orchestrator) supply the prefixed form
  // (`probe:<cfg.id>`); test fixtures that don't supply it fall back to
  // the bare cfg.id (their fakeScheduler ignores the id arg anyway).
  const schedulerEntryId = deps.schedulerId ?? cfg.id;

  return async function invoke(
    invokeOpts?: InvokerTriggerOptions,
  ): Promise<RunSummary> {
    const concurrency = cfg.max_concurrency;
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
    // path. Sharing `timeout_ms` with the per-target executor keeps the
    // tick's total wall-clock bounded to roughly 2×timeout (one for
    // discovery, one for the slowest target's run).
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

    // Hand-rolled bounded pool. Each worker pulls from a shared index so
    // N workers process the M inputs cooperatively — no Promise.all
    // stampede even when M >> N.
    let cursor = 0;
    const runOne = async (): Promise<void> => {
      while (cursor < inputs.length) {
        const idx = cursor++;
        const { input, key, preError } = inputs[idx]!;
        // B7: mark running just before handing the input to the driver.
        tracker.start(key);
        // CR-A1.2: short-circuit on inputs the resolver pre-flagged as
        // un-runnable (e.g. key_template missing fields). The driver
        // never sees them — emit the synthetic error and move on.
        const result =
          preError !== undefined
            ? syntheticError(key, preError, now)
            : await executeOne({
                input,
                key,
                driver,
                timeoutMs,
                env,
                now,
                logger,
                probeId: cfg.id,
                writer,
                fetchImpl,
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
          logger.error("probe.writer-failed", {
            probeId: cfg.id,
            kind: cfg.kind,
            key,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };

    // CR-A1.5: a failed enumerate also flips the run state to "failed"
    // — the probe didn't get a chance to do its job. Per-target driver
    // failures don't escalate the run state (they're captured in the
    // failed counter); discovery failure is structural.
    let runState: "completed" | "failed" = resolved.ok ? "completed" : "failed";
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
      // Defensive: per-target executeOne already converts driver throws
      // into synthetic ProbeResults so this branch is unreachable in
      // practice. Wired anyway so a future refactor that surfaces a real
      // throw still flips the run row to `failed` instead of silently
      // pretending the run completed.
      runState = "failed";
      logger.error("probe.invoker-unhandled", {
        probeId: cfg.id,
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      // R2-A.1: when discovery failed, treat the discovery itself as a
      // single failed unit so the RunSummary invariant
      // (total === passed + failed) holds. inputs.length is 0 in that
      // case (no per-target fan-out), and `failed` was bumped by 1
      // above for the synthetic-error tile, so total must be 1 too.
      const summary: RunSummary = {
        total: resolved.ok ? inputs.length : 1,
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
    return {
      total: resolved.ok ? inputs.length : 1,
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
  preError?: string;
}

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
      return {
        ok: false,
        error: `discovery source not registered: ${cfg.discovery.source}`,
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
      // would look identical to "no services matched the filter". Emit
      // a structured log with the source name so operators can tell them
      // apart in the log stream. CR-A1.5: surface as `ok: false` so the
      // caller flips the run state to "failed" and writes a synthetic-
      // error ProbeResult; "fake green" was the original bug.
      const message = err instanceof Error ? err.message : String(err);
      logger.error("probe.discovery-enumerate-failed", {
        probeId: cfg.id,
        source: cfg.discovery.source,
        err: message,
      });
      return { ok: false, error: message };
    } finally {
      if (discoveryTimer !== null) clearTimeout(discoveryTimer);
    }
    const resolvedInputs: ResolvedInput[] = [];
    let dupSerial = 0;
    for (const record of records) {
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
        const errMsg = `key_template missing field: ${interp.missingPath}`;
        logger.error("probe.key-template-missing-field", {
          probeId: cfg.id,
          template: cfg.discovery.key_template,
          missingPath: interp.missingPath,
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
      const input =
        record && typeof record === "object"
          ? { ...(record as Record<string, unknown>), key }
          : { key };
      resolvedInputs.push({ input, key });
    }
    return { ok: true, inputs: resolvedInputs };
  }
  // Single target: wrap the YAML entry verbatim.
  return { ok: true, inputs: [{ input: cfg.target, key: cfg.target.key }] };
}

/**
 * CR-A1.2: strict interpolation — returns a discriminated result so
 * callers can tell "all paths resolved" from "one or more were missing"
 * without silently emitting empty-key results that would collide. The
 * non-strict `interpolateTemplate` below is retained for any caller that
 * genuinely wants empty-on-missing (none, currently).
 */
interface InterpResult {
  ok: true;
  value: string;
}
interface InterpFail {
  ok: false;
  missingPath: string;
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
    const value = resolvePath(record, path);
    if (value === undefined || value === null) {
      return { ok: false, missingPath: path };
    }
    out += String(value);
    i = close + 1;
  }
  return { ok: true, value: out };
}

/**
 * @deprecated Retained for backwards-compat in case any external caller
 * still imports it. New code should use `interpolateTemplateStrict` so
 * missing fields fail loud (CR-A1.2). Empty-string fallback was the
 * original silent-collapse bug.
 */
function interpolateTemplate(template: string, record: unknown): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, path: string) => {
    const value = resolvePath(record, path.trim());
    return value === undefined || value === null ? "" : String(value);
  });
}
// Suppress unused-warning so the deprecated helper survives without an
// `// eslint-disable` line cluttering the export.
void interpolateTemplate;

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
  writer: ProbeResultWriter;
  fetchImpl: typeof fetch;
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
    writer,
    fetchImpl,
  } = opts;
  const parsed = driver.inputSchema.safeParse(input);
  if (!parsed.success) {
    logger.error("probe.input-rejected", {
      probeId,
      kind: driver.kind,
      key,
      err: parsed.error.message,
    });
    return syntheticError(
      key,
      `inputSchema rejected: ${parsed.error.message}`,
      now,
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
  const timer: ReturnType<typeof setTimeout> | null =
    timeoutMs !== undefined
      ? setTimeout(() => {
          timedOut = true;
          abortCtrl.abort(new Error(timeoutReason));
        }, timeoutMs)
      : null;
  const ctx: ProbeContext = {
    now,
    logger,
    env,
    writer,
    fetchImpl,
    abortSignal: abortCtrl.signal,
  };
  try {
    if (timeoutMs === undefined) {
      return await driver.run(ctx, parsed.data);
    }
    // Race the driver promise against a timeout promise. On timeout the
    // race resolves to a synthetic-error ProbeResult even if the driver
    // ignored abortSignal — the abort still fires so a well-behaved
    // driver can stop its real work. A driver that observes abortSignal
    // will typically reject; we catch that below and return the same
    // synthetic-error.
    const timeoutPromise = new Promise<ProbeResult<unknown>>((resolve) => {
      abortCtrl.signal.addEventListener(
        "abort",
        () => {
          if (timedOut) {
            resolve(syntheticError(key, timeoutReason, now));
          }
        },
        { once: true },
      );
    });
    // R2-A.2: when the timeoutPromise wins the race, the driver promise
    // is left dangling. Without a catch handler, a late rejection from
    // the driver (e.g. a misbehaved driver that ignored abortSignal)
    // surfaces as an UnhandledRejection — fatal under Node's
    // `--unhandled-rejections=throw` default. Attach a no-op catch
    // BEFORE the race so the late rejection has a handler regardless
    // of which side wins. The race outcome is decided by whoever
    // settles first; the catch only swallows the orphaned tail.
    const driverPromise = driver.run(ctx, parsed.data);
    driverPromise.catch(() => {});
    return await Promise.race([driverPromise, timeoutPromise]);
  } catch (err) {
    // If the driver rejected *because* it observed our abort, surface
    // the timeout synthetic-error rather than the driver's opaque
    // "AbortError" message. Otherwise fall through to the normal
    // error-to-synthetic path so siblings still proceed.
    if (timedOut) {
      return syntheticError(key, timeoutReason, now);
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error("probe.run-failed", {
      probeId,
      kind: driver.kind,
      key,
      err: message,
    });
    return syntheticError(key, message, now);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function syntheticError(
  key: string,
  message: string,
  now: () => Date,
): ProbeResult<unknown> {
  return {
    key,
    state: "error",
    signal: { errorDesc: message },
    observedAt: now().toISOString(),
  };
}
