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
    const concurrency = cfg.max_concurrency;
    const timeoutMs = "timeout_ms" in cfg ? cfg.timeout_ms : undefined;
    // Discovery-level abort controller: fires if the enumerate() call
    // exceeds the per-probe `timeout_ms`, so a stalled upstream releases
    // its socket rather than orphaning past the tick. Sources that honor
    // the signal (railway-services, etc.) abort their in-flight GraphQL
    // request; sources that don't still observe the natural completion
    // path. Sharing `timeout_ms` with the per-target executor keeps the
    // tick's total wall-clock bounded to roughly 2×timeout (one for
    // discovery, one for the slowest target's run).
    const inputs = await resolveInputs(
      cfg,
      discoveryRegistry,
      logger,
      fetchImpl,
      env,
      timeoutMs,
    );

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
        const { input, key } = inputs[idx]!;
        const result = await executeOne({
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
}

async function resolveInputs(
  cfg: ProbeConfig,
  discoveryRegistry: DiscoveryRegistry,
  logger: Logger,
  fetchImpl: typeof fetch,
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs: number | undefined,
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
      return [];
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
      // would look identical to "no services matched the filter". Emit
      // a structured log with the source name so operators can tell them
      // apart in the log stream. The invoker callers sees an empty
      // `inputs` array and the tick writes nothing — that's deliberate:
      // the next tick retries, and the surrounding alert rule's
      // `cron_only` trigger (if any) still fires a synthetic tick.
      logger.error("probe.discovery-enumerate-failed", {
        probeId: cfg.id,
        source: cfg.discovery.source,
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    } finally {
      if (discoveryTimer !== null) clearTimeout(discoveryTimer);
    }
    return records.map((record) => {
      const key = interpolateTemplate(cfg.discovery.key_template, record);
      // Fold the resolved `key` into the input object so drivers can
      // emit ProbeResults keyed the same way the writer will look them
      // up. Record-as-input keeps discovery outputs self-describing.
      const input =
        record && typeof record === "object"
          ? { ...(record as Record<string, unknown>), key }
          : { key };
      return { input, key };
    });
  }
  // Single target: wrap the YAML entry verbatim.
  return [{ input: cfg.target, key: cfg.target.key }];
}

/**
 * Interpolate `${a.b.c}` path references in a key template against a
 * discovery record. Missing paths render as the empty string — a more
 * strict contract (throw) would break the "siblings proceed" invariant,
 * since one malformed record would poison the whole tick. Emitting an
 * empty-key ProbeResult surfaces the bug via the writer's existing
 * key-safety checks.
 */
function interpolateTemplate(template: string, record: unknown): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, path: string) => {
    const value = resolvePath(record, path.trim());
    return value === undefined || value === null ? "" : String(value);
  });
}

/**
 * Demo-count extractor for `e2e_demos` shortest-first dispatch sort. The
 * discovery source emits records carrying a `demos: string[]` field
 * (zod-validated by `e2e-demos.ts:inputSchema`); we read it without
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
    return await Promise.race([driver.run(ctx, parsed.data), timeoutPromise]);
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
