import path from "node:path";
import url from "node:url";
import { serve } from "@hono/node-server";
import { buildServer } from "./http/server.js";
import { createPbClient } from "./storage/pb-client.js";
import {
  createAlertStateStore,
  assertSafeKey,
} from "./storage/alert-state-store.js";
import { createEventBus } from "./events/event-bus.js";
import { createRuleLoader } from "./rules/rule-loader.js";
import type { CompiledRule } from "./rules/rule-loader.js";
import { createRenderer } from "./render/renderer.js";
import { createAlertEngine } from "./alerts/alert-engine.js";
import { createScheduler } from "./scheduler/scheduler.js";
import type { Scheduler } from "./scheduler/scheduler.js";
import { createStatusWriter } from "./writers/status-writer.js";
import { createSlackWebhookTarget } from "./targets/slack-webhook.js";
import { createMetricsRegistry } from "./http/metrics.js";
import {
  createS3Backup,
  createDefaultS3Uploader,
} from "./storage/s3-backup.js";
import { deployEventToProbeResult } from "./probes/deploy-result.js";
import { REDIRECT_DECOMMISSION_SLACK_SAFE_FIELDS } from "./probes/redirect-decommission.js";
import { LIVENESS_SLACK_SAFE_FIELDS } from "./probes/liveness.js";
import { aimockWiringProbe } from "./probes/aimock-wiring.js";
import { createProbeRegistry } from "./probes/drivers/index.js";
import { createDiscoveryRegistry } from "./probes/discovery/index.js";
import { createProbeLoader } from "./probes/loader/probe-loader.js";
import { buildProbeInvoker } from "./probes/loader/probe-invoker.js";
import type { ProbeConfig } from "./probes/loader/schema.js";
import type { ProbeRegistry } from "./probes/types.js";
import { createProbeRunWriter, sweepStaleRuns } from "./probes/run-history.js";
import type { ProbeRunWriter } from "./probes/run-history.js";
import { aimockWiringDriver } from "./probes/drivers/aimock-wiring.js";
import { pinDriftDriver } from "./probes/drivers/pin-drift.js";
import { livenessDriver } from "./probes/drivers/liveness.js";
import { imageDriftDriver } from "./probes/drivers/image-drift.js";
import { versionDriftDriver } from "./probes/drivers/version-drift.js";
import { redirectDecommissionDriver } from "./probes/drivers/redirect-decommission.js";
import {
  e2eChatToolsDriver,
  createE2eSmokeDriver,
  createPooledE2eSmokeLauncher,
} from "./probes/drivers/d4-chat-roundtrip.js";
import {
  e2eReadinessDriver,
  createE2eDemosDriver,
  createPooledE2eDemosLauncher,
} from "./probes/drivers/e2e-readiness.js";
import {
  e2eDeepDriver,
  createE2eDeepDriver,
  createPooledE2eDeepLauncher,
} from "./probes/drivers/d5-single-pill.js";
import {
  e2eFullDriver,
  createE2eFullDriver,
  createPooledE2eFullLauncher,
} from "./probes/drivers/d6-all-pills.js";
import { BrowserPool } from "./probes/helpers/browser-pool.js";
import { createResourceSnapshotWriter } from "./probes/helpers/resource-snapshot-writer.js";
import { qaDriver } from "./probes/drivers/qa.js";
import { starterSmokeDriver } from "./probes/drivers/starter-smoke.js";
import { railwayServicesSource } from "./probes/discovery/railway-services.js";
import { pnpmPackagesDiscoverySource } from "./probes/discovery/pnpm-packages.js";
import { withCache } from "./probes/discovery/caching-source.js";
import { DiscoveryAuthTracker } from "./probes/discovery/auth-tracker.js";
import { logger, reloadLogLevel } from "./logger.js";
import { logErrorWithStack } from "./probes/loader/probe-invoker.js";
import { makeGql } from "./probes/discovery/railway-services.js";
import type {
  Logger,
  ProbeResult,
  State,
  StatusRecord,
  Target,
} from "./types/index.js";
import { resolveFleetRoleConfig } from "./fleet/role-config.js";
import type { FleetRoleConfig } from "./fleet/role-config.js";
import { createJobClaimClient } from "./fleet/job-claim.js";
import {
  createFleetQueueClient,
  PROBE_JOBS_COLLECTION,
} from "./fleet/queue-client.js";
import {
  commErrorToStatusSignal,
  WORKERS_COLLECTION,
  type PoolCommError,
} from "./fleet/contracts.js";
import { runWorker as runFleetWorker } from "./fleet/orchestrator.js";
import {
  createPayloadToInput,
  E2E_D6_DRIVER_KIND,
  E2E_DEEP_DRIVER_KIND,
  E2E_DEMOS_DRIVER_KIND,
  E2E_SMOKE_DRIVER_KIND,
} from "./fleet/worker/payload-mapper.js";
import type { DriverRegistry } from "./fleet/worker/worker-loop.js";
import { registerWorker } from "./fleet/worker/registration.js";
import {
  asKnownState,
  createResultAggregator,
} from "./fleet/control-plane/result-aggregator.js";
import { createResultConsumer } from "./fleet/control-plane/result-consumer.js";
import {
  createFleetHealthMonitor,
  DEFAULT_WORKER_STALE_AFTER_MS,
  type RestartWorkerHook,
} from "./fleet/control-plane/fleet-health.js";
import {
  createD6ServiceEnumerator,
  createE2eSmokeServiceEnumerator,
  createE2eDemosServiceEnumerator,
  createE2eDeepServiceEnumerator,
} from "./fleet/control-plane/catalog-enumerator.js";
import {
  buildJobProducer,
  createControlPlane,
  DEFAULT_PRODUCER_CRON,
  FLEET_PRODUCER_SCHEDULE_ID,
} from "./fleet/control-plane/control-plane.js";
import type {
  ControlPlane,
  ProducerSchedule,
  PriorStateResolver,
  SweepAggregateKeyResolver,
} from "./fleet/control-plane/control-plane.js";
import type {
  ServiceEnumerator,
  JobProducer,
} from "./fleet/control-plane/job-producer.js";

export interface BootOptions {
  configDir?: string;
  port?: number;
  bootstrapWindowMs?: number;
  /**
   * Fleet control-plane ONLY: the catalog-aware per-service enumerator the job
   * producer (S4) runs each tick. Injected so the discovery slot can supply the
   * real railway-services enumerator; when absent, `runControlPlane` produces
   * empty runs (see the enumeration seam there). Ignored by `boot()` / worker.
   */
  fleetEnumerate?: ServiceEnumerator;
}

export async function boot(opts: BootOptions = {}): Promise<{
  stop: () => Promise<void>;
  port: number;
  /**
   * Exposed for tests (R21 bucket-a): subscribers can observe
   * `rules.reload.failed` etc. without reaching into module-private state.
   * Production callers should not rely on this — it's an escape hatch and
   * may tighten in the future.
   */
  bus: ReturnType<typeof createEventBus>;
}> {
  // HF13-A2: fail loud on missing POCKETBASE_URL in production. Pre-fix the
  // `?? "http://localhost:8090"` fallback silently bound a prod orchestrator
  // to a non-existent localhost PB — no status reads, no state writes, no
  // alerts. Shell-dashboard's `pb.ts` uses a `pbIsMisconfigured` sentinel and
  // fails loud; orchestrator was asymmetric. Now it throws on boot in prod so
  // the deploy CI (or Railway health-check) catches it immediately instead of
  // discovering it hours later via silent alert suppression.
  const rawPbUrl = process.env.POCKETBASE_URL;
  if (!rawPbUrl && process.env.NODE_ENV === "production") {
    logger.error("orchestrator.FATAL-CONFIG", {
      msg: "POCKETBASE_URL required in production",
      nodeEnv: process.env.NODE_ENV,
    });
    throw new Error(
      "FATAL-CONFIG: POCKETBASE_URL required in production (NODE_ENV=production)",
    );
  }
  const pbUrl = rawPbUrl ?? "http://localhost:8090";
  // These authenticate against `/api/collections/_superusers/auth-with-password`
  // in pb-client, so the env var names intentionally mirror "superuser" —
  // previously `POCKETBASE_WRITER_*`, renamed to eliminate the naming drift
  // between auth endpoint and env contract.
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD;

  const pb = createPbClient({ url: pbUrl, email, password, logger });
  const bus = createEventBus();
  const renderer = createRenderer();
  const stateStore = createAlertStateStore(pb);
  const writer = createStatusWriter({ pb, bus, logger });
  const scheduler = createScheduler({ logger });
  const metrics = createMetricsRegistry();

  // Track all bus subscriptions so stop() can release them on repeated boot/stop.
  const busUnsubs: Array<() => void> = [];

  // Observability: increment counters on bus events so /metrics stays fresh.
  busUnsubs.push(bus.on("rules.reloaded", () => metrics.inc("rule_reloads")));
  // Each successfully-written probe result maps 1:1 to a probe run.
  // (HMAC failures + alert matches/sends are incremented at their call sites.)
  busUnsubs.push(
    bus.on("status.changed", (e) =>
      metrics.inc("probe_runs", {
        dimension: e.result.key.split(":")[0] ?? "unknown",
      }),
    ),
  );
  // HF-A5: backup failures get their own dedicated counter
  // (`internal_backup_failures_total`) rather than sharing the `probe_runs`
  // series with a synthetic `dimension=internal_backup` label. Pre-fix,
  // backup failures inflated probe-run dashboards and alert rules keying
  // on `probe_runs{dimension=~...}` saw phantom signal from events that
  // never actually ran a probe. Keep the bus emit so alert rules subscribed
  // to `internal.backup.failed` still fire, and keep the human-readable
  // warn log for log-alerts pipelines.
  busUnsubs.push(
    bus.on("internal.backup.failed", (payload) => {
      metrics.inc("internal_backup_failures_total");
      logger.warn("orchestrator.backup-failed", { err: payload.err });
    }),
  );

  const targets = new Map<string, Target>();
  targets.set("slack_webhook", createSlackWebhookTarget({ logger }));

  const configDir =
    opts.configDir ?? path.resolve(process.cwd(), "config/alerts");
  // L1-L4 per-starter dimensions (agent/chat/tools) don't have dedicated probe
  // modules today — their signals flow through the same smoke/e2e-smoke drivers
  // as side-emissions (see probes/drivers/liveness.ts). The safe-field sets for
  // them mirror smoke's sanitized-errorDesc allow-list so triple-brace
  // {{{signal.errorDesc}}} in the red-tick YAMLs loads. Keep these in lockstep
  // with LIVENESS_SLACK_SAFE_FIELDS — any new sanitized field added there SHOULD
  // be added here too unless there's a dimension-specific reason otherwise.
  const L1_L4_SLACK_SAFE_FIELDS = ["errorDesc"] as const;
  const slackSafeFields: Record<string, Set<string>> = {
    redirect_decommission: new Set(REDIRECT_DECOMMISSION_SLACK_SAFE_FIELDS),
    smoke: new Set(LIVENESS_SLACK_SAFE_FIELDS),
    agent: new Set(L1_L4_SLACK_SAFE_FIELDS),
    chat: new Set(L1_L4_SLACK_SAFE_FIELDS),
    tools: new Set(L1_L4_SLACK_SAFE_FIELDS),
  };
  const loader = createRuleLoader({
    dir: configDir,
    logger,
    slackSafeFields,
    bus: {
      // `rules.reload.failed` is a declared key on BusEvents — the typed bus
      // accepts it directly without any unsafe cast.
      emit(event, payload) {
        bus.emit(event, payload);
      },
    },
  });

  // HF-A1: give the alert engine a thin reader over the `status` collection
  // so `dispatchCronAlert` can thread the real prior state into the
  // synthesized WriteOutcome. Failures inside here flow up as rejections —
  // the engine's own catch logs a warn and falls back to `previousState:
  // null`. Keep the implementation inline (rather than another module) so
  // the dependency surface stays trivially auditable.
  const statusReader = createStatusReader(pb);

  const engine = createAlertEngine({
    bus,
    renderer,
    stateStore,
    targets,
    logger,
    now: () => new Date(),
    env: {
      dashboardUrl:
        process.env.DASHBOARD_URL ?? "https://dashboard.showcase.copilotkit.ai",
      repo: process.env.REPO ?? "CopilotKit/CopilotKit",
      // Source-env label prefixed onto every Slack alert so operators can
      // tell whether a red probe came from staging or production. Railway
      // injects RAILWAY_ENVIRONMENT_NAME ("staging" / "production") into
      // every service at runtime; we prefer an explicit SHOWCASE_ENV
      // override for local/CI, then fall back to "unknown" (the renderer
      // surfaces the empty case as `[unknown]` rather than dropping the
      // tag — a missing env var must look like a visible gap, not a
      // legacy un-prefixed alert).
      sourceEnv:
        process.env.SHOWCASE_ENV ??
        process.env.RAILWAY_ENVIRONMENT_NAME ??
        "unknown",
    },
    bootstrapWindowMs: opts.bootstrapWindowMs,
    statusReader,
    metrics,
  });
  engine.start();

  let rules: CompiledRule[] = [];

  // Cron handler resolver: given a rule's dimension, either returns an
  // async probe invoker (which produces a live ProbeResult for
  // `rule.scheduled`) or null (fall back to emitting without a result).
  //
  // Only `aimock_wiring` has enough info at orchestrator-construction
  // time (RAILWAY_TOKEN + project/environment IDs + aimock URL) to be
  // invoked in-process on a cron tick. Other cron-only dimensions —
  // `pin_drift`, `version_drift`, `redirect_decommission` — require
  // an external trigger (webhook POST from CI) to supply signal data.
  // Wiring those into the orchestrator is deliberate follow-up work:
  // they'd need their own adapters (GHCR auth, showcase manifest fetch,
  // prod URL roster) which materially expands this service's scope.
  const cronProbeResolver = buildCronProbeResolver();

  async function reloadRules(): Promise<void> {
    const next = await loader.load();
    rules = next;
    engine.reload(next);
    // R2-B.1: diffCronSchedules is async (awaits scheduler.unregister) —
    // await the diff so rules.reloaded fires only after the diff settles.
    await diffCronSchedules(scheduler, next, bus, cronProbeResolver);
    bus.emit("rules.reloaded", { count: next.length });
  }

  try {
    await reloadRules();
  } catch (err) {
    logErrorWithStack(logger, "orchestrator.initial-rule-load-failed", err);
    throw err;
  }

  // ---- Probe-loader wiring (parallel to legacy buildCronProbeResolver) ----
  //
  // The probe-loader reads YAML probe configs from `config/probes/`, resolves
  // each `kind` against the in-process `probeRegistry`, and schedules one
  // handler per config via `buildProbeInvoker`. Handlers writer.write() per
  // target (static / discovery / single) so probe ticks flow into the same
  // status-writer + alert-engine pipeline as the deploy-result webhook path.
  //
  // This path runs IN PARALLEL with `buildCronProbeResolver` + `diffCronSchedules`
  // for the alert-engine cron trigger. Both paths emit for `aimock_wiring`
  // today: the legacy one via `rule.scheduled` (rule-level cron trigger),
  // the new one via `status.changed` (probe-driven status write). Phase 4.1
  // retires the legacy path once every dimension has a driver. Until then,
  // Railway's own dedupe on identical `status` rows keeps this safe — two
  // writers with the same probe result produce one row, not two.
  //
  // Scheduler IDs use the `probe:` prefix so they never collide with the
  // rule-cron IDs (`<ruleId>:cron:<idx>`) or the internal IDs (`internal:`).
  // F1: per-probe config map populated by `diffProbeSchedules` and consumed
  // by the /api/probes router via `getProbeConfig(id)`. Keyed by the
  // scheduler-id (`probe:<cfg.id>`) so a single lookup serves both the
  // routes and any future call site that has the scheduler entry id in hand.
  // Stays in sync with the loader output: each diff sweep clears the map of
  // ids no longer desired and (re-)inserts the active set.
  const probeConfigs = new Map<string, ProbeConfig>();
  // F1: probe_runs writer reused by every per-probe invoker so each tick
  // inserts a `running` row at start and finalizes it at finish. Constructed
  // once at boot so the writer's PB client (and any internal state added
  // later — caches, batching) is shared across invokers.
  const runWriter = createProbeRunWriter(pb);

  try {
    const swept = await sweepStaleRuns(pb);
    if (swept > 0) {
      logger.info("boot.swept-stale-runs", { swept });
    }
  } catch (err) {
    logger.error("boot.sweep-stale-runs-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Context-pooled BrowserPool: a fixed small set of long-lived browser
  // PROCESSES (browsers) with a global cap on concurrently-live CONTEXTS
  // (maxContexts). BROWSER_POOL_BROWSERS is the process count (legacy
  // BROWSER_POOL_SIZE retained as a fallback, but its meaning shifts from
  // "concurrent browsers" to "base browser process count"); deploy env should
  // move to BROWSER_POOL_BROWSERS=3 + BROWSER_POOL_MAX_CONTEXTS=24.
  // Do NOT pre-parse the env here with Number(...): Number("abc") is NaN, and
  // because NaN is not nullish the constructor's `options.browsers ?? <env/default>`
  // would keep NaN — yielding browserCount = NaN, so init()'s `for (i=0; i<NaN; ...)`
  // never iterates and ZERO browsers launch (every acquire then times out). The
  // BrowserPool constructor already reads BROWSER_POOL_BROWSERS / BROWSER_POOL_SIZE /
  // BROWSER_POOL_MAX_CONTEXTS from process.env with parseInt + NaN/>0 guards and
  // sensible defaults, so pass only `logger` and let it own numeric resolution.
  // Browser-pool health signal writers. Shared by the init()-failure path AND
  // the BrowserPool's mid-life `onDegraded`/`onRecovered` hooks (fix #2): the
  // unfixed code emitted the degraded signal ONLY on init() failure, so a
  // mid-life browser-set death (the staging outage) was SILENT.
  const {
    writeDegraded: writeBrowserPoolDegraded,
    writeHealthy: writeBrowserPoolHealthy,
    writeUnrecoverable: writeBrowserPoolUnrecoverable,
  } = createBrowserPoolHealthSignals({ writer, statusReader, logger });

  // DURABLE forensic snapshot writer: persists the pool's OS resource gauges to
  // the `resource_snapshots` PB collection so the history survives the
  // container RESTART that ends every browser-pool wedge (Railway stdout rolls
  // off; in-memory is cleared on restart — durable PB is the only
  // post-wedge-retrievable trail). Reuses the SAME `pb` client the rest of the
  // harness uses. Writes are best-effort (the writer swallows PB errors so a
  // missing migration / PB hiccup never breaks the pool) with ring-style
  // retention to bound growth.
  const resourceSnapshotWriter = createResourceSnapshotWriter({ pb, logger });

  const browserPool = new BrowserPool({
    logger,
    // DURABLE forensic logging: fire-and-forget the full gauge snapshot to PB on
    // every meaningful pool condition + the periodic heartbeat. The hook is
    // synchronous; the write is async + best-effort (never throws back here).
    onSnapshot: (snapshot) => {
      void resourceSnapshotWriter.write(
        snapshot.event,
        snapshot.gauges,
        snapshot.stats,
        snapshot.perBrowser,
      );
    },
    // FIX #2 — wire the pool's mid-life capacity-loss + recovery hooks to the
    // SAME degraded-signal write path. When the browser set empties mid-life the
    // pool fires `onDegraded` (red alarm) and self-heals; on a successful
    // self-heal relaunch it fires `onRecovered` (back to green). The hooks are
    // synchronous; the async writes are fire-and-forget with their own
    // error handling.
    onDegraded: () => {
      void writeBrowserPoolDegraded("browser pool set emptied mid-life");
    },
    onRecovered: () => {
      void writeBrowserPoolHealthy();
    },
    // FIX (headline) — wire the TERMINAL alarm. When the self-heal
    // circuit-breaker exhausts every hard recovery and gives up, write a DISTINCT
    // `system:browser-pool-unrecoverable` health signal (and escalate the shared
    // degraded key to critical/terminal) so a give-up is distinguishable from a
    // transient self-heal-degraded, and best-effort ping Slack (guarded on the
    // SLACK_WEBHOOK_BROWSER_POOL_UNRECOVERABLE env var — unset by default so the
    // code deploys before the URL is wired). Without this, the breaker's give-up
    // was a production NO-OP: the mechanism stopped spinning but NO operator was
    // ever told a redeploy is required.
    onUnrecoverable: (info) => {
      void writeBrowserPoolUnrecoverable(info);
    },
  });
  let browserPoolReady = false;
  try {
    await browserPool.init();
    browserPoolReady = true;
    await writeBrowserPoolHealthy();
  } catch (err) {
    logger.error("boot.browser-pool-init-failed", { error: String(err) });
    await writeBrowserPoolDegraded(
      err instanceof Error ? err.message : String(err),
    );
  }

  const probeRegistry = createProbeRegistry();
  const discoveryRegistry = createDiscoveryRegistry();
  registerAllProbeDrivers(
    probeRegistry,
    browserPoolReady ? browserPool : undefined,
  );
  const authTracker = new DiscoveryAuthTracker({
    threshold: 3,
    writer,
    logger,
    now: () => Date.now(),
  });

  discoveryRegistry.register(
    withCache(railwayServicesSource, {
      ttlMs: 86_400_000,
      logger,
      authTracker,
    }),
  );
  discoveryRegistry.register(pnpmPackagesDiscoverySource);
  const probeConfigDir =
    opts.configDir !== undefined
      ? path.resolve(opts.configDir, "../probes")
      : path.resolve(process.cwd(), "config/probes");
  const probeLoader = createProbeLoader(probeConfigDir, {
    probeRegistry,
    discoveryRegistry,
    bus: {
      emit(event, payload) {
        bus.emit(event, payload);
      },
    },
    logger,
  });

  async function diffProbeSchedules(configs: ProbeConfig[]): Promise<void> {
    // Build desired map: scheduler-id → cfg. `probe:` prefix keeps us from
    // unregistering rule-cron or internal IDs in the same sweep.
    const desired = new Map<string, ProbeConfig>();
    for (const cfg of configs) {
      desired.set(`probe:${cfg.id}`, cfg);
    }
    // Unregister probe IDs that are no longer desired (YAML deleted).
    // CR-A2.2: await the unregister and only drop probeConfigs on
    // success. Pre-fix the unregister was fire-and-forget and probeConfigs
    // was deleted synchronously — so if unregister rejected, the scheduler
    // still had the old entry but probeConfigs no longer had its config,
    // causing the /api/probes router to surface a fully orphaned entry as
    // `kind: "unknown"` with `config: { timeout_ms: null, ... }`. Keeping
    // the config on rejection means the orphan stays VISIBLE with proper
    // metadata — operators can still see what kind of probe was leaked,
    // which is the better debugging surface than "unknown". The next
    // successful diff sweep (after the YAML is restored or the operator
    // restarts the service) cleans things up.
    for (const entry of scheduler.list()) {
      if (!entry.id.startsWith("probe:")) continue;
      if (!desired.has(entry.id)) {
        try {
          await scheduler.unregister(entry.id);
          probeConfigs.delete(entry.id);
        } catch (err) {
          logErrorWithStack(
            logger,
            "orchestrator.probe-unregister-failed",
            err,
            {
              id: entry.id,
            },
          );
          // R2-B.4: dedicated `scheduler_unregister_failures_total`
          // counter would belong here, but adding it requires extending
          // metrics.ts COUNTER_NAMES (out of scope for this fix). Defer
          // to bucket-b follow-up; the structured log above is the
          // first-class observability surface in the meantime.
          // Intentionally do NOT delete from probeConfigs — see comment
          // above. Orphan stays visible with proper config so /api/probes
          // surfaces a useful `kind`/`config` rather than "unknown".
        }
      }
    }
    // Driver-singleton timeout threading: drivers are registered as
    // singletons at boot (BEFORE configs are loaded), so we can't pass
    // each YAML's `timeout_ms` straight into the driver factory. Instead
    // we compute a PER-CFG env overlay via `envForCfg(cfg, baseEnv)` and
    // hand it to `buildProbeInvoker` as the invoker's `env`. Drivers
    // read the timeout via `ctx.env.E2E_DEMOS_TIMEOUT_MS` (see
    // drivers/e2e-readiness.ts — `TIMEOUT_ENV_VAR`).
    //
    // Pre-fix this loop wrote `process.env.E2E_DEMOS_TIMEOUT_MS = ...`
    // directly. Three problems with that:
    //   1. Stale across YAML reloads — when the cfg removed timeout_ms,
    //      the env var stayed set and leaked into every subsequent tick.
    //   2. Last-write-wins silently across multiple e2e_demos configs.
    //   3. Mutating shared global state from a diff function broke
    //      parallel test isolation.
    // The overlay pattern is fully isolated per-cfg and per-call.

    // Snapshot process.env once at the top so every overlay derives from
    // the same base — eliminates the read-after-write hazard if a future
    // refactor accidentally mutates process.env between iterations.
    const baseEnv: Readonly<Record<string, string | undefined>> = {
      ...process.env,
    };

    // Register / re-register each desired probe. `scheduler.register` is
    // idempotent — if the cron+handler combination is unchanged it's
    // effectively a no-op; otherwise it replaces the prior entry.
    for (const [id, cfg] of desired) {
      const driver = probeRegistry.get(cfg.kind);
      if (!driver) {
        // Unreachable: probe-loader already validates kind → driver at load
        // time and emits `probes.reload.failed`. The guard is cheap and
        // avoids a post-condition violation inline if the loader ever
        // relaxes that check.
        logger.error("orchestrator.probe-driver-missing", {
          id: cfg.id,
          kind: cfg.kind,
        });
        continue;
      }
      const invoker = buildProbeInvoker(cfg, {
        driver,
        discoveryRegistry,
        writer,
        logger,
        fetchImpl: globalThis.fetch,
        env: envForCfg(cfg, baseEnv),
        now: () => new Date(),
        // F1: thread the live scheduler + runWriter through so the invoker's
        // optional B7 hooks (ProbeRunTracker registration, probe_runs row
        // start/finish) actually fire in production. Pre-fix both deps were
        // unset and tracker + run-history were dead code.
        scheduler,
        // R3-A.2: pass the prefixed scheduler id so the invoker's
        // getEntry/setEntryTracker calls actually find the scheduler entry
        // we just registered (`probe:${cfg.id}`). Pre-fix the invoker used
        // the bare cfg.id and tracker registration was a silent no-op
        // against the live scheduler — /api/probes never surfaced inflight
        // tracker data for cron-tick runs.
        schedulerId: id,
        runWriter,
      });
      try {
        scheduler.register({
          id,
          cron: cfg.schedule,
          handler: invoker,
        });
        // F1: stamp the config map AFTER successful register so a thrown
        // validateCron doesn't leave a probeConfigs entry pointing at no
        // scheduler entry. The /api/probes router intersects scheduler.list()
        // with this map; an orphaned config would still render as "unknown"
        // but it's cleaner to keep the two collections in lockstep.
        probeConfigs.set(id, cfg);
      } catch (err) {
        logErrorWithStack(logger, "orchestrator.probe-register-failed", err, {
          id,
          kind: cfg.kind,
          schedule: cfg.schedule,
        });
      }
    }
  }

  async function reloadProbes(): Promise<void> {
    const next = await probeLoader.load();
    await diffProbeSchedules(next);
    bus.emit("probes.reloaded", { count: next.length });
  }

  try {
    await reloadProbes();
  } catch (err) {
    // Probe load failure must NOT take down the service — rules and other
    // probes (deploy-result webhook) still function. Surface on the bus so
    // operators can alert on `probes.reload.failed` without blocking boot.
    logErrorWithStack(logger, "orchestrator.initial-probe-load-failed", err);
    bus.emit("probes.reload.failed", {
      errors: [{ file: "(initial-load)", error: String(err) }],
    });
  }

  // R5-G4 D7: initialize as a no-op BEFORE the watch() call so a
  // synchronous throw inside `probeLoader.watch(...)` cannot leave
  // `unwatchProbes` undefined. Pre-fix, a stop() invoked after a
  // failed watch() init would throw `ReferenceError: unwatchProbes is
  // not defined` and orphan the engine + scheduler.
  let unwatchProbes: () => void = () => {};
  try {
    unwatchProbes = probeLoader.watch((next) => {
      // CR-A2.2: diffProbeSchedules is now async (awaits unregister). The
      // file-watch callback signature is sync (void return), so we fire-and-
      // forget the diff and route any uncaught rejection into the same
      // log/emit channel as the initial-load path. A rejection here means
      // both: (a) at least one probe entry could not be removed cleanly (the
      // orphan stays visible in /api/probes per the design choice in the
      // body of diffProbeSchedules), AND (b) the post-await `bus.emit` may
      // not have fired — operators see a "probes.reload.failed" instead of
      // a stale "probes.reloaded" claim.
      diffProbeSchedules(next)
        .then(() => bus.emit("probes.reloaded", { count: next.length }))
        .catch((err) => {
          logErrorWithStack(
            logger,
            "orchestrator.probe-watch-reload-failed",
            err,
          );
          bus.emit("probes.reload.failed", {
            errors: [{ file: "(watch-reload)", error: String(err) }],
          });
        });
    });
  } catch (err) {
    logErrorWithStack(logger, "orchestrator.probe-watch-init-failed", err);
  }

  const unwatch = loader.watch((next) => {
    rules = next;
    engine.reload(next);
    // R2-B.1: diffCronSchedules is async (awaits scheduler.unregister).
    // The file-watch callback signature is sync (void return), so we
    // fire-and-forget the diff and route any uncaught rejection into a
    // structured log + bus emit — same shape as the probe-watch path.
    diffCronSchedules(scheduler, next, bus, cronProbeResolver)
      .then(() =>
        // Emit rules.reloaded on file-watch reload too so the metric stays
        // accurate regardless of reload source (SIGHUP vs file event).
        bus.emit("rules.reloaded", { count: next.length }),
      )
      .catch((err) => {
        logger.error("orchestrator.rule-watch-reload-failed", {
          err: String(err),
        });
        bus.emit("rules.reload.failed", {
          errors: [{ file: "(watch-reload)", error: String(err) }],
        });
      });
  });

  // Route deploy.result webhook events through the writer so they emit status.changed.
  const deployCtx = {
    now: () => new Date(),
    logger,
    env: process.env as Readonly<Record<string, string | undefined>>,
  };
  busUnsubs.push(
    bus.on("deploy.result", (event) => {
      const result = deployEventToProbeResult(event, deployCtx);
      writer
        .write(result)
        .catch((err) =>
          logErrorWithStack(logger, "orchestrator.deploy-writer-failed", err),
        );
    }),
  );

  const sharedSecret = process.env.SHARED_SECRET;
  const sharedSecretPrev = process.env.SHARED_SECRET_PREV;
  const webhookSecrets = [sharedSecret, sharedSecretPrev].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  // R5-G4 D5: empty webhookSecrets silently disables auth on the
  // deploy.result webhook — anyone who knows the URL can POST. Mirror
  // the POCKETBASE_URL fail-loud pattern: in production the missing
  // config is a deploy bug that must surface immediately. In dev/test
  // emit an info log so developers see the bypass.
  if (webhookSecrets.length === 0) {
    if (process.env.NODE_ENV === "production") {
      logger.error("orchestrator.FATAL-CONFIG", {
        msg: "SHARED_SECRET required in production",
        nodeEnv: process.env.NODE_ENV,
      });
      throw new Error(
        "FATAL-CONFIG: SHARED_SECRET required in production (NODE_ENV=production)",
      );
    }
    logger.info("orchestrator.webhook-auth-bypass", {
      msg: "webhook auth disabled — neither SHARED_SECRET nor SHARED_SECRET_PREV is set",
      nodeEnv: process.env.NODE_ENV ?? "(unset)",
    });
  }

  let loopAlive = true;
  // `schedulerRunning` closes the boot-window honesty gap in /health: the
  // HTTP server binds before `scheduler.start()` returns, so without this
  // flag /health briefly reports `loop: "ok"` even though the scheduler
  // hasn't ticked yet. Flipped true immediately after start, flipped false
  // in stop() so post-shutdown probes also read correctly.
  let schedulerRunning = false;

  // F1: only mount the /api/probes router when an OPS_TRIGGER_TOKEN is
  // configured. The router's bearer-auth middleware is fail-loud at
  // construction (MissingAuthTokenError) — wiring it unconditionally would
  // break every test / dev boot that doesn't set the env var. When unset we
  // log at info level so operators can see the routes were intentionally
  // skipped, then flag it as a hardening concern in the boot summary.
  //
  // R2-B.3: distinguish "unset" (intentional disable) from "set-but-empty"
  // (misconfiguration). An operator who mistypes `OPS_TRIGGER_TOKEN=`
  // (no value) ships an empty string AND would otherwise see a silent-skip
  // log instead of the load-bearing fail-loud error. Whitespace-only is
  // treated identically: trim() then reject if zero-length.
  const rawTriggerToken = process.env.OPS_TRIGGER_TOKEN;
  if (rawTriggerToken !== undefined && rawTriggerToken.trim() === "") {
    throw new Error(
      "OPS_TRIGGER_TOKEN is set but empty — refusing to mount probes router with insecure auth",
    );
  }
  // R3-A.5: trim defense-in-depth. The auth layer (auth.ts) also trims
  // both sides at construction, but normalising here keeps the orchestrator
  // contract honest — the value passed downstream is the same one the
  // bearer-auth middleware will compare against. Pre-fix, a "  abc  "
  // token boot'd successfully but the auth layer's asymmetric trimming
  // (presented trimmed, expected verbatim) silently 401'd every request.
  const triggerToken = rawTriggerToken?.trim(); // undefined or non-empty
  const probesDeps = triggerToken
    ? {
        scheduler,
        writer: runWriter,
        getProbeConfig: (id: string): ProbeConfig | undefined =>
          probeConfigs.get(id),
        triggerToken,
        now: () => Date.now(),
      }
    : undefined;
  if (!triggerToken) {
    logger.info("orchestrator.probes-router-disabled", {
      reason: "OPS_TRIGGER_TOKEN unset — /api/probes routes not mounted",
    });
  }

  const app = buildServer({
    pb,
    logger,
    ruleCount: () => rules.length,
    loopAlive: () => loopAlive,
    schedulerStarted: () => schedulerRunning,
    // Wire the scheduler's introspection probes through to /health so the
    // endpoint honours the two 503 contracts ServerDeps documents:
    //   - schedulerJobCount() == 0 → 503 loop:"no-jobs" (rule loader silently
    //     produced zero cron entries; HTTP up but nothing is ticking).
    //   - schedulerIsStopped() == true → 503 loop:"stopped" (post-shutdown
    //     window after scheduler.stop() resolved; takes priority over
    //     loopAlive which only flips on orchestrator.stop()).
    schedulerJobCount: () => scheduler.getJobCount(),
    schedulerIsStopped: () => scheduler.isStopped(),
    bus,
    webhookSecrets,
    metrics,
    probes: probesDeps,
  });

  // S3 backup — cron 0 3 * * * (daily 03:00 UTC). Retention handled via
  // bucket lifecycle policy (see storage/s3-backup.ts).
  //
  // The `readSource` producer below calls PB's `/api/backups` endpoint
  // which takes a SQLite-checkpoint-consistent snapshot (zip) of
  // `pb_data/`. Reading `data.db` off the live filesystem while PB is
  // serving writes can tear the copy — hence the PB-managed path.
  const s3Bucket = process.env.S3_BACKUP_BUCKET ?? "";
  const awsRegion = process.env.AWS_REGION ?? "us-east-1";
  if (s3Bucket) {
    try {
      const uploader = await createDefaultS3Uploader(awsRegion);
      const backup = createS3Backup({
        bucket: s3Bucket,
        region: awsRegion,
        readSource: async () => {
          // Name includes timestamp so PB doesn't reject a duplicate,
          // and so orphaned zips (if delete fails below) are traceable.
          const name = `showcase-harness-${new Date()
            .toISOString()
            .replace(/[:.]/g, "-")}.zip`;
          await pb.createBackup(name);
          let data: Uint8Array;
          try {
            data = await pb.downloadBackup(name);
          } catch (err) {
            // Attempt cleanup even if download failed — the create did
            // succeed so the zip is on disk. Await the delete so process
            // death between here and the next tick doesn't orphan the
            // zip on the volume.
            try {
              await pb.deleteBackup(name);
            } catch (delErr) {
              logger.warn("orchestrator.s3-backup-cleanup-failed", {
                name,
                err: String(delErr),
                context: "download_failed",
              });
            }
            throw err;
          }
          // Await the delete inside its own try/catch: a failure here is
          // NOT fatal (S3 is the source of truth once the upload lands)
          // but we must not return until the call has either succeeded
          // or thrown — the prior fire-and-forget could leak a zip if
          // the process exited between `return` and the async delete.
          try {
            await pb.deleteBackup(name);
          } catch (err) {
            logger.warn("orchestrator.s3-backup-cleanup-failed", {
              name,
              err: String(err),
            });
          }
          return data;
        },
        uploader,
        logger,
        now: () => new Date(),
        // Wire the bus so `internal.backup.failed` actually fires when a
        // run fails. Without this, the event type exists on BusEvents
        // but nobody emits it — alert rules matching on it are dead.
        onFailure: {
          emit(event, payload) {
            bus.emit(event, payload);
          },
        },
      });
      scheduler.register({
        id: "internal:s3-backup",
        cron: "0 3 * * *",
        handler: () => backup.run(),
      });
      logger.info("orchestrator.s3-backup-registered", {
        bucket: s3Bucket,
        awsRegion,
      });
    } catch (err) {
      // Log at error level AND emit on the bus so operators have a
      // first-class observable surface. Pre-fix, an init throw (missing
      // `@aws-sdk/client-s3`, bad region, credential provider throws)
      // only logged — the service booted green while backups silently
      // never ran. Alert rules can now subscribe to
      // `internal.backup.init-failed` to surface the degraded state.
      logErrorWithStack(logger, "orchestrator.s3-backup-init-failed", err, {
        bucket: s3Bucket,
      });
      bus.emit("internal.backup.init-failed", {
        err: String(err),
        bucket: s3Bucket,
      });
    }
  }

  const port = opts.port ?? Number(process.env.PORT ?? 8080);
  // CR-A2.1: start the scheduler BEFORE binding the HTTP server. Pre-fix,
  // `serve()` ran first and `scheduler.start()` second — if start() threw
  // (a stopped-scheduler reentry, future precondition check, etc.) the
  // bound socket was never closed. Boot rejected, but the http.Server kept
  // listening, leaking one socket per restart loop. The HTTP server has
  // no dependency on scheduler state at construction time (the /health
  // probes accept callbacks that read scheduler liveness lazily), so the
  // reorder is safe and obviates needing a try/catch around start() to
  // close the server before rethrowing.

  // Hydrate scheduler lastRun bookkeeping from PB probe_runs before the
  // first cron tick fires, so the dashboard immediately reflects historical
  // data instead of "never run" until each probe's first post-restart tick.
  // Non-fatal — PB being down at boot logs a warn and continues.
  await hydrateProbeLastRuns({ scheduler, runWriter, logger });

  scheduler.start();
  schedulerRunning = true;
  // R2-B.2: wrap serve() so a synchronous throw (EADDRINUSE, etc.) doesn't
  // leave the scheduler running with no stop handle. Pre-fix CR-A2.1
  // reordered start() before serve() to avoid orphaning the HTTP socket on
  // a scheduler.start() throw — but if serve() itself throws, the scheduler
  // is up with no owner and cron tasks fire indefinitely. Tear it down
  // before rethrowing so boot()'s rejection cleanly releases all resources.
  let server: ReturnType<typeof serve>;
  try {
    server = serve({ fetch: app.fetch, port });
  } catch (err) {
    await scheduler.stop().catch((stopErr) =>
      logger.error("orchestrator.stop-after-serve-failure", {
        err: String(stopErr),
      }),
    );
    // R2-B.2: init() launched long-lived chromium processes; shutdown() runs
    // only in the stop() closure a boot rejection never reaches. Tear the pool
    // down here too so a serve()-throw boot doesn't strand every browser (which
    // on a restart loop compounds into PID-ceiling exhaustion). Best-effort.
    if (browserPoolReady) {
      await browserPool.shutdown().catch((shutErr) =>
        logger.error("orchestrator.browser-pool-shutdown-after-serve-failure", {
          err: String(shutErr),
        }),
      );
    }
    schedulerRunning = false;
    throw err;
  }
  // R4-A.3: serve() returns the http.Server SYNCHRONOUSLY but bind happens
  // via server.listen() which emits 'error' ASYNCHRONOUSLY for conditions
  // like EADDRINUSE. The R2-B.2 try/catch only catches synchronous throws —
  // a real bind failure resolves boot() successfully with an orphaned
  // scheduler still ticking. Race 'listening' vs 'error' so async bind
  // errors propagate as boot() rejections AND tear down the scheduler.
  //
  // The returned object is a Node http.Server (or Http2Server) per
  // @hono/node-server's `ServerType`; both extend EventEmitter and emit
  // 'listening' on bind success and 'error' on bind failure. If the server
  // is already in `listening` state by the time we get here (sync bind
  // succeeded before we attached listeners), short-circuit to resolve.
  await new Promise<void>((resolve, reject) => {
    const srv = server as unknown as {
      listening?: boolean;
      once(event: string, cb: (...args: unknown[]) => void): unknown;
      removeListener(event: string, cb: (...args: unknown[]) => void): unknown;
    };
    const onListen = (): void => {
      srv.removeListener("error", onError);
      resolve();
    };
    const onError = (err: unknown): void => {
      srv.removeListener("listening", onListen);
      // Fire the cleanup as a separate promise chain so the rejection
      // below isn't gated on scheduler.stop() — operators see the original
      // bind error, not a stop-failure shadow. schedulerRunning flips
      // immediately so /health stops claiming "ok" before the stop awaits.
      schedulerRunning = false;
      scheduler.stop().catch((stopErr) =>
        logger.error("orchestrator.stop-after-async-bind-failure", {
          err: String(stopErr),
        }),
      );
      // R4-A.3: also release the browser pool init() launched, so an async
      // bind failure (EADDRINUSE) doesn't strand every chromium process. Same
      // fire-and-forget shape as scheduler.stop() above — operators see the
      // original bind error, not a shutdown-failure shadow. Best-effort.
      if (browserPoolReady) {
        browserPool
          .shutdown()
          .catch((shutErr) =>
            logger.error(
              "orchestrator.browser-pool-shutdown-after-async-bind-failure",
              { err: String(shutErr) },
            ),
          );
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    srv.once("listening", onListen);
    srv.once("error", onError);
    // If listen() resolved synchronously before we attached, the
    // 'listening' event already fired and we'd hang forever. Guard with
    // the `.listening` flag.
    if (srv.listening === true) {
      srv.removeListener("error", onError);
      srv.removeListener("listening", onListen);
      resolve();
    }
  });
  logger.info("showcase-harness.boot", { port, pbUrl, rules: rules.length });

  const sigHup = (): void => {
    logger.info("showcase-harness.sighup-reload");
    // Re-read LOG_LEVEL first so any log produced by reloadRules() (or its
    // downstream emissions) honours the new verbosity. logger.ts caches
    // LOG_LEVEL at module-load time; without this, operators who SIGHUP'd
    // to bump to debug saw the rule-reload log at the OLD level.
    reloadLogLevel();
    reloadRules().catch((err) => {
      logErrorWithStack(logger, "orchestrator.reload-failed", err);
      // R21 bucket-a: mirror the watch-path failure emission in
      // rule-loader.ts (~line 540). File-watch reload failures hit the
      // bus so the alert engine / dashboard can surface them; SIGHUP
      // previously only logged, leaving operators who use SIGHUP-based
      // reload blind to load failures. Use `<sighup>` as the synthetic
      // file so subscribers can distinguish the failure path.
      bus.emit("rules.reload.failed", {
        errors: [{ file: "<sighup>", error: String(err) }],
      });
    });
  };
  process.on("SIGHUP", sigHup);

  return {
    port,
    bus,
    async stop() {
      loopAlive = false;
      schedulerRunning = false;
      process.off("SIGHUP", sigHup);
      unwatch();
      unwatchProbes();
      engine.stop();
      await scheduler.stop();
      await browserPool.shutdown();
      // Release all bus subscriptions so repeated boot/stop don't accumulate
      // listeners on the shared EventEmitter.
      for (const u of busUnsubs) u();
      busUnsubs.length = 0;
      // Node http.Server.close() uses a callback; wrap so stop() truly waits.
      await new Promise<void>((resolve) => {
        const maybe = (
          server as unknown as {
            close(cb?: (err?: Error) => void): unknown;
          }
        ).close((err) => {
          if (err)
            logger.warn("orchestrator.server-close-error", {
              err: String(err),
            });
          resolve();
        });
        // Some mocks return a Promise directly — chain it if so.
        if (maybe && typeof (maybe as PromiseLike<void>).then === "function") {
          (maybe as PromiseLike<void>).then(
            () => resolve(),
            () => resolve(),
          );
        }
      });
    },
  };
}

/**
 * Construct the four POOLED per-service browser drivers (smoke/demos/deep/d6)
 * wired onto the SAME `BrowserPool`. This is the single shared construction
 * consumed by BOTH `registerAllProbeDrivers` (the in-process probe registry) and
 * the fleet worker's `DriverRegistry` (orchestrator.ts `runWorker`), so the two
 * can never drift on how the pooled drivers are built. Returned keyed by each
 * driver's `driverKind` constant; callers adapt (register the raw driver, or
 * pair it with a payload mapper for the worker registry).
 */
export function buildPooledBrowserDrivers(
  pool: BrowserPool,
  log: Logger,
): {
  smoke: ReturnType<typeof createE2eSmokeDriver>;
  demos: ReturnType<typeof createE2eDemosDriver>;
  deep: ReturnType<typeof createE2eDeepDriver>;
  d6: ReturnType<typeof createE2eFullDriver>;
} {
  return {
    smoke: createE2eSmokeDriver({
      launcher: createPooledE2eSmokeLauncher(pool, log),
    }),
    demos: createE2eDemosDriver({
      launcher: createPooledE2eDemosLauncher(pool, log),
    }),
    deep: createE2eDeepDriver({
      launcher: createPooledE2eDeepLauncher(pool, log),
    }),
    d6: createE2eFullDriver({
      launcher: createPooledE2eFullLauncher(pool, log),
    }),
  };
}

/**
 * The probe kinds that REQUIRE a browser (Playwright via the BrowserPool /
 * worker) and therefore must NOT run in-process on the fleet control-plane.
 * They route through the worker producer path instead. Everything else is an
 * HTTP-only family that the control-plane runs in-process (lifting the legacy
 * `boot()` probe-loader machinery). Used to partition `config/probes/*.yml`:
 * HTTP = every kind NOT in this set.
 *
 * Exported so unit tests can lock the partition without reaching into the
 * control-plane's private wiring, and so a future kind addition flows through
 * one source of truth rather than a drifting inline literal.
 */
export const BROWSER_KINDS: ReadonlySet<ProbeConfig["kind"]> = new Set<
  ProbeConfig["kind"]
>(["e2e_d6", "e2e_smoke", "e2e_demos", "e2e_deep"]);

/**
 * Register ONLY the HTTP-only probe drivers (no browser/BrowserPool drivers)
 * onto the given registry. This is the control-plane's in-process driver set:
 * the 8 families that need nothing but `fetch` + registry/API calls
 * (smoke, starter_smoke, image_drift, qa, aimock_wiring, version_drift,
 * pin_drift, redirect_decommission). The browser `e2e_*` kinds are
 * deliberately omitted — they run via the worker producer path, not in-process.
 *
 * Kept SEPARATE from `registerAllProbeDrivers` (which also registers the e2e
 * drivers) so the control-plane's `probeRegistry` contains only the HTTP
 * drivers; paired with the probe-loader's `includeKind` scoping this means a
 * browser YAML on disk is skipped at load, never rejected.
 */
export function registerHttpProbeDrivers(
  probeRegistry: Pick<ProbeRegistry, "register">,
): void {
  probeRegistry.register(aimockWiringDriver);
  probeRegistry.register(pinDriftDriver);
  // The `smoke` family is served by `livenessDriver` (whose `kind` is
  // `"smoke"`) — there is no separate "smoke" driver export.
  probeRegistry.register(livenessDriver);
  probeRegistry.register(imageDriftDriver);
  probeRegistry.register(versionDriftDriver);
  probeRegistry.register(redirectDecommissionDriver);
  probeRegistry.register(qaDriver);
  probeRegistry.register(starterSmokeDriver);
}

/**
 * Fail-loud invariant for the HTTP/browser kind partition. Given the list of
 * driver kinds the control-plane registered in-process (via
 * `registerHttpProbeDrivers`), assert that NONE of them is in `BROWSER_KINDS` —
 * the two sets must be DISJOINT, so an HTTP driver kind can never collide with a
 * browser kind.
 *
 * Today both sets are hand-maintained from a single 12-kind list, so this can
 * only trip on a future edit. But a kind mis-added to BROWSER_KINDS that ALSO
 * has an HTTP driver would go dark on the fleet — `includeKind` would skip the
 * YAML in-process while the browser path wouldn't pick up an HTTP family — so we
 * throw at control-plane boot rather than let a probe family vanish unnoticed.
 *
 * (The complementary JOINT-COVERAGE check — that the HTTP kinds + BROWSER_KINDS
 * together equal the full `registerAllProbeDrivers` universe — lives in the
 * drift-lock test, which can see the whole universe; this runtime guard only has
 * the HTTP set in hand.)
 *
 * Exported so the drift-lock test can assert the partition without booting the
 * full control-plane.
 */
export function assertHttpBrowserKindPartition(httpKinds: string[]): void {
  const overlap = httpKinds.filter((kind) =>
    BROWSER_KINDS.has(kind as ProbeConfig["kind"]),
  );
  if (overlap.length > 0) {
    throw new Error(
      `registerHttpProbeDrivers registered browser kind(s) that must NOT run ` +
        `in-process on the control-plane: ${overlap.sort().join(", ")}. The ` +
        `HTTP driver set and BROWSER_KINDS must be DISJOINT.`,
    );
  }
}

/**
 * The scheduler entry id + cron for each BROWSER probe family's fleet producer.
 *
 * The crons are LITERAL from `config/probes/*.yml` `schedule:` and the OFFSETS
 * ARE DELIBERATE — the four browser families share ONE BrowserPool (capped at
 * `BROWSER_POOL_MAX_CONTEXTS`, 24) on the pooled worker(s), so co-firing all
 * four Playwright fan-outs at the same minute would starve the pool. Staggering
 * their producer ticks (smoke every :15, demos at :10, deep at :05/:20/:35/:50,
 * d6 at :40) keeps the families from claiming the pool simultaneously. Do NOT
 * "tidy" these to a uniform cadence — keep each in lockstep with its YAML.
 *
 * The d6 entry keeps the historic `FLEET_PRODUCER_SCHEDULE_ID`
 * (`fleet-job-producer`) so the degenerate single-schedule behavior is
 * preserved exactly for d6 (and a `FLEET_PRODUCER_CRON` env override still wins
 * for d6 — see `buildProducerSchedules`).
 */
export const FLEET_PRODUCER_SMOKE_CRON = "*/15 * * * *";
export const FLEET_PRODUCER_DEMOS_CRON = "10 * * * *";
export const FLEET_PRODUCER_DEEP_CRON = "5,20,35,50 * * * *";

/** Scheduler entry ids for the three non-d6 browser-family producers. */
export const FLEET_PRODUCER_SMOKE_SCHEDULE_ID = "fleet-producer-e2e-smoke";
export const FLEET_PRODUCER_DEMOS_SCHEDULE_ID = "fleet-producer-e2e-demos";
export const FLEET_PRODUCER_DEEP_SCHEDULE_ID = "fleet-producer-e2e-deep";

/**
 * Assemble the multi-schedule producer manifest `runControlPlane` passes to
 * `createControlPlane`. Pure (no I/O) so the schedule ids + crons are
 * unit-testable without booting the control-plane. Each browser family ticks on
 * its own cron from the YAML (see the cron constants above for the offset
 * rationale); the d6 entry keeps `fleet-job-producer` and honors the
 * `FLEET_PRODUCER_CRON` env override (`d6Cron`) for the local fast-cadence seam.
 */
export function buildProducerSchedules(producers: {
  d6: JobProducer;
  smoke: JobProducer;
  demos: JobProducer;
  deep: JobProducer;
  /** d6 cron — `FLEET_PRODUCER_CRON` override or `DEFAULT_PRODUCER_CRON`. */
  d6Cron?: string;
}): ProducerSchedule[] {
  return [
    {
      scheduleId: FLEET_PRODUCER_SCHEDULE_ID,
      cron: producers.d6Cron ?? DEFAULT_PRODUCER_CRON,
      producer: producers.d6,
    },
    {
      scheduleId: FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
      cron: FLEET_PRODUCER_SMOKE_CRON,
      producer: producers.smoke,
    },
    {
      scheduleId: FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
      cron: FLEET_PRODUCER_DEMOS_CRON,
      producer: producers.demos,
    },
    {
      scheduleId: FLEET_PRODUCER_DEEP_SCHEDULE_ID,
      cron: FLEET_PRODUCER_DEEP_CRON,
      producer: producers.deep,
    },
  ];
}

/**
 * Register every probe driver this orchestrator knows about onto the
 * given registry. Single source of truth for the registered probe-kind
 * set so YAML probe configs (`config/probes/*.yml`) and orchestrator
 * boot can never drift: if a driver file ships without a registration
 * call here, the probe-loader rejects its YAML at boot with
 * `no driver registered for kind 'X'` — which is exactly the
 * production failure that motivated extracting this helper. Exported
 * so unit tests can lock the registered set without spinning up the
 * full boot path (PB, scheduler, http server, ...).
 */
export function registerAllProbeDrivers(
  probeRegistry: Pick<ProbeRegistry, "register">,
  pool?: BrowserPool,
): void {
  probeRegistry.register(aimockWiringDriver);
  probeRegistry.register(pinDriftDriver);
  probeRegistry.register(livenessDriver);
  probeRegistry.register(imageDriftDriver);
  probeRegistry.register(versionDriftDriver);
  probeRegistry.register(redirectDecommissionDriver);

  if (pool) {
    const pooled = buildPooledBrowserDrivers(pool, logger);
    probeRegistry.register(pooled.smoke);
    probeRegistry.register(pooled.demos);
    probeRegistry.register(pooled.deep);
    probeRegistry.register(pooled.d6);
  } else {
    probeRegistry.register(e2eChatToolsDriver);
    probeRegistry.register(e2eReadinessDriver);
    probeRegistry.register(e2eDeepDriver);
    probeRegistry.register(e2eFullDriver);
  }

  probeRegistry.register(qaDriver);
  probeRegistry.register(starterSmokeDriver);
}

/**
 * Thin reader over the `status` collection that the alert engine uses
 * when synthesizing a cron outcome's previousState. Defense-in-depth:
 * runs `assertSafeKey` on the incoming key so a control-char key never
 * reaches PB's filter parser (where the parse error would get swallowed
 * by dispatchCronAlert's wrapper and silently fail the rule).
 *
 * Exported for tests so the key-safety invariant can be asserted
 * without spinning up the full boot path.
 */
/**
 * The PB status key the browser-pool capacity-loss signal is written under.
 * Exported so the boot wiring and the health-signal factory share one source
 * of truth.
 */
export const BROWSER_POOL_DEGRADED_KEY = "system:browser-pool-degraded";

/**
 * Distinct PB status key the TERMINAL (give-up) browser-pool signal is written
 * under. Kept SEPARATE from `BROWSER_POOL_DEGRADED_KEY` so the dashboard /
 * alerting can distinguish a TRANSIENT self-heal-degraded (red, expected to
 * recover on its own) from an UNRECOVERABLE give-up (the breaker exhausted every
 * hard recovery — a redeploy is genuinely required). The terminal signal also
 * carries `severity: "critical"` + `terminal: true` so a consumer keying off the
 * degraded key alone still sees the escalation.
 */
export const BROWSER_POOL_UNRECOVERABLE_KEY =
  "system:browser-pool-unrecoverable";

/**
 * Env var holding the Slack incoming-webhook URL the TERMINAL browser-pool alarm
 * posts to. Intentionally UNSET by default (alerting discipline: deploy the code
 * first, wire the URL separately) — when unset the Slack post is skipped and
 * only the (unconditional) PB health-signal write fires. A `system:`-prefixed
 * health key drives the dashboard regardless; the Slack ping is a best-effort
 * operator nudge on top.
 */
export const BROWSER_POOL_ALERT_WEBHOOK_ENV =
  "SLACK_WEBHOOK_BROWSER_POOL_UNRECOVERABLE";

/** Breaker counters + resource gauges surfaced in the terminal alarm so an
 *  operator sees how hard the pool tried before giving up AND the PROVEN wedge
 *  signal (the cgroup PID/thread ceiling) that caused it. */
export interface BrowserPoolBreakerCounters {
  browserCount: number;
  waiters: number;
  maxHardRecoveries: number;
  /** cgroup `pids.current` at give-up — the measured PID/thread count against
   *  the ceiling. -1 off-Linux / when the cgroup PID controller is unreadable. */
  cgroupPidsCurrent?: number;
  /** cgroup `pids.max` ceiling at give-up (-1 = unbounded / unavailable). */
  cgroupPidsMax?: number;
  /** Process-tree thread count at give-up (demand against `pids.max`). */
  treeThreadCount?: number;
}

interface BrowserPoolHealthSignalsDeps {
  writer: { write(result: ProbeResultLike): Promise<unknown> };
  statusReader: { getStateByKey(key: string): Promise<State | null> };
  logger: Pick<Logger, "warn"> & Partial<Pick<Logger, "error" | "info">>;
  /** Env source (defaults to process.env) — injectable for tests. */
  env?: Readonly<Record<string, string | undefined>>;
  /** fetch impl (defaults to globalThis.fetch) — injectable for tests. */
  fetchImpl?: typeof fetch;
}

interface ProbeResultLike {
  key: string;
  state: State;
  signal: Record<string, unknown>;
  observedAt: string;
}

/**
 * Build the browser-pool degraded/healthy status writers.
 *
 * Two correctness properties the inline closures lacked (fix #6):
 *
 *  1. **The prior-state read failure is no longer swallowed.** The unfixed
 *     `writeHealthy` did `.catch(() => null)` on the prior-state read, silently
 *     coercing a transient PB read error into `null` — which reads as "cold
 *     boot", so a genuine degraded→recovered transition was MISREPORTED as a
 *     phantom healthy (never as `recovered`). Now a read failure is logged at
 *     warn before defaulting, so the misclassification is visible.
 *
 *  2. **The degraded↔healthy writes are SERIALIZED + observedAt-monotone.** The
 *     unfixed hooks fired `void writeDegraded()/writeHealthy()` — unordered
 *     fire-and-forget. Under flapping (red→green→red in quick succession) the
 *     two async writes could land at PB out of order, persisting the WRONG final
 *     state. We chain every write onto a single promise so they apply in call
 *     order, and stamp each with a monotonically non-decreasing `observedAt` so
 *     the LAST real transition always wins even if the system clock is coarse.
 *
 * Exported for unit tests so the read-error + flap-ordering invariants can be
 * asserted without the full boot path.
 */
/**
 * Abort the best-effort Slack ping after this long. The health-signal writes
 * are SERIALIZED (writeChain), so a hung webhook fetch would otherwise stall
 * the whole degraded↔healthy↔unrecoverable write chain indefinitely. The ping
 * is best-effort, so a timeout just logs and moves on.
 */
const BROWSER_POOL_SLACK_TIMEOUT_MS = 5_000;

export function createBrowserPoolHealthSignals(
  deps: BrowserPoolHealthSignalsDeps,
): {
  writeDegraded: (reason: string) => Promise<void>;
  writeHealthy: () => Promise<void>;
  writeUnrecoverable: (counters: BrowserPoolBreakerCounters) => Promise<void>;
} {
  const { writer, statusReader, logger } = deps;
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  // Serialize writes so the persisted state reflects call ORDER under flapping.
  let writeChain: Promise<unknown> = Promise.resolve();
  // Monotonic observedAt: never emit a timestamp <= the previously-emitted one,
  // so the last real transition wins even when Date.now() is coarse and two
  // back-to-back writes would otherwise share a timestamp.
  let lastObservedMs = 0;
  const nextObservedAt = (): string => {
    const now = Date.now();
    lastObservedMs = now > lastObservedMs ? now : lastObservedMs + 1;
    return new Date(lastObservedMs).toISOString();
  };

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const next = writeChain.then(task, task);
    writeChain = next.catch(() => undefined);
    return next;
  };

  const writeDegraded = (reason: string): Promise<void> =>
    enqueue(async () => {
      try {
        await writer.write({
          key: BROWSER_POOL_DEGRADED_KEY,
          state: "red",
          signal: {
            errorMessage: reason,
            degradedSince: new Date().toISOString(),
          },
          observedAt: nextObservedAt(),
        });
      } catch (writeErr) {
        logger.warn("boot.browser-pool-status-write-failed", {
          error:
            writeErr instanceof Error ? writeErr.message : String(writeErr),
        });
      }
    });

  const writeHealthy = (): Promise<void> =>
    enqueue(async () => {
      try {
        let priorState: State | null;
        try {
          priorState = await statusReader.getStateByKey(
            BROWSER_POOL_DEGRADED_KEY,
          );
        } catch (readErr) {
          // FIX #6 — do NOT silently coerce a read error to null. A swallowed
          // read failure misclassifies a genuine recovery as a cold boot
          // (healthy instead of recovered). Log it, then default to null.
          logger.warn("boot.browser-pool-prior-state-read-failed", {
            error: readErr instanceof Error ? readErr.message : String(readErr),
          });
          priorState = null;
        }
        const recovered = priorState === "red";
        await writer.write({
          key: BROWSER_POOL_DEGRADED_KEY,
          state: "green",
          signal: recovered
            ? { recovered: true, recoveredAt: new Date().toISOString() }
            : { healthy: true, healthyAt: new Date().toISOString() },
          observedAt: nextObservedAt(),
        });
      } catch (writeErr) {
        logger.warn("boot.browser-pool-status-write-failed", {
          error:
            writeErr instanceof Error ? writeErr.message : String(writeErr),
        });
      }
    });

  /**
   * TERMINAL alarm: the self-heal circuit-breaker exhausted every hard recovery
   * and gave up. This is the headline operator signal the PR's breaker mechanism
   * produces — distinct from a transient degraded.
   *
   * Two-part, with deliberately ASYMMETRIC guarantees:
   *  1. The PB health-signal write is UNCONDITIONAL (best-effort, errors logged):
   *     it writes a DISTINCT `system:browser-pool-unrecoverable` key (red) AND
   *     escalates the shared degraded key with `severity: "critical"` +
   *     `terminal: true`, so a give-up is distinguishable from a self-heal
   *     degraded regardless of which key a consumer watches. Redeploy guidance
   *     and the breaker counters are embedded so the operator knows what to do.
   *  2. The Slack ping is BEST-EFFORT and GUARDED on
   *     `SLACK_WEBHOOK_BROWSER_POOL_UNRECOVERABLE` being set (alerting discipline:
   *     ship the code with the URL unset; wire the URL separately). When unset we
   *     skip it loudly-in-logs but never fail the health-signal write.
   */
  const writeUnrecoverable = (
    counters: BrowserPoolBreakerCounters,
  ): Promise<void> =>
    enqueue(async () => {
      // Name the PROVEN wedge signal (cgroup PID/thread-ceiling exhaustion) in
      // the alert when it was measured, so the operator sees the real cause
      // rather than just the abstract breaker counters.
      const pidsClause =
        counters.cgroupPidsCurrent !== undefined &&
        counters.cgroupPidsCurrent >= 0
          ? `, pids.current=${counters.cgroupPidsCurrent}/pids.max=${counters.cgroupPidsMax}, threads=${counters.treeThreadCount}`
          : "";
      const message =
        "browser pool UNRECOVERABLE — self-heal circuit-breaker gave up after " +
        `${counters.maxHardRecoveries} hard recoveries; a REDEPLOY is required ` +
        `(browserCount=${counters.browserCount}, waiters=${counters.waiters}${pidsClause})`;
      const observedAt = nextObservedAt();
      // (1) UNCONDITIONAL health-signal writes — distinct terminal key + escalate
      //     the shared degraded key to critical/terminal.
      try {
        await writer.write({
          key: BROWSER_POOL_UNRECOVERABLE_KEY,
          state: "red",
          signal: {
            terminal: true,
            severity: "critical",
            errorMessage: message,
            redeployRequired: true,
            browserCount: counters.browserCount,
            waiters: counters.waiters,
            maxHardRecoveries: counters.maxHardRecoveries,
            cgroupPidsCurrent: counters.cgroupPidsCurrent,
            cgroupPidsMax: counters.cgroupPidsMax,
            treeThreadCount: counters.treeThreadCount,
            unrecoverableSince: new Date().toISOString(),
          },
          observedAt,
        });
      } catch (writeErr) {
        logger.warn("boot.browser-pool-status-write-failed", {
          key: BROWSER_POOL_UNRECOVERABLE_KEY,
          error:
            writeErr instanceof Error ? writeErr.message : String(writeErr),
        });
      }
      try {
        await writer.write({
          key: BROWSER_POOL_DEGRADED_KEY,
          state: "red",
          signal: {
            errorMessage: message,
            severity: "critical",
            terminal: true,
            redeployRequired: true,
            degradedSince: new Date().toISOString(),
          },
          observedAt: nextObservedAt(),
        });
      } catch (writeErr) {
        logger.warn("boot.browser-pool-status-write-failed", {
          key: BROWSER_POOL_DEGRADED_KEY,
          error:
            writeErr instanceof Error ? writeErr.message : String(writeErr),
        });
      }
      // (2) BEST-EFFORT, GUARDED Slack ping — only if the webhook URL is set.
      const webhookUrl = env[BROWSER_POOL_ALERT_WEBHOOK_ENV];
      if (!webhookUrl) {
        logger.info?.("boot.browser-pool-unrecoverable-slack-skipped", {
          reason: "webhook-env-unset",
          envVar: BROWSER_POOL_ALERT_WEBHOOK_ENV,
        });
        return;
      }
      // Timeout the ping so a hung webhook can't stall the serialized
      // health-signal write chain. Best-effort: an abort just logs + returns.
      const slackAbort = new AbortController();
      const slackTimer = setTimeout(
        () => slackAbort.abort(),
        BROWSER_POOL_SLACK_TIMEOUT_MS,
      );
      try {
        const res = await fetchImpl(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: `:rotating_light: ${message}` }),
          signal: slackAbort.signal,
        });
        if (!res.ok) {
          logger.warn("boot.browser-pool-unrecoverable-slack-failed", {
            status: res.status,
          });
        }
      } catch (slackErr) {
        logger.warn("boot.browser-pool-unrecoverable-slack-failed", {
          error:
            slackErr instanceof Error ? slackErr.message : String(slackErr),
        });
      } finally {
        clearTimeout(slackTimer);
      }
    });

  return { writeDegraded, writeHealthy, writeUnrecoverable };
}

export function createStatusReader(pb: {
  getFirst<T>(collection: string, filter: string): Promise<T | null>;
}): {
  getStateByKey(key: string): Promise<State | null>;
} {
  return {
    async getStateByKey(key: string): Promise<State | null> {
      // Mirror alert-state-store's defense-in-depth: reject keys with
      // C0/C1 control chars BEFORE they reach PB's filter parser.
      // Today's probes only emit printable-ASCII keys, but a future
      // probe emitting a control char would throw at PB filter parse
      // time — the throw gets swallowed by dispatchCronAlert's wrapper
      // and the rule silently fails. `assertSafeKey` throws with a
      // clear message; callers see a specific failure rather than an
      // opaque PB DSL error.
      assertSafeKey("key", key);
      const row = await pb.getFirst<StatusRecord>(
        "status",
        `key = ${JSON.stringify(key)}`,
      );
      return row?.state ?? null;
    },
  };
}

/**
 * Project a per-cfg env overlay for `buildProbeInvoker`. Drivers that
 * need YAML-derived knobs (e.g. `e2e_demos`'s `cfg.timeout_ms` —
 * threaded through as `E2E_DEMOS_TIMEOUT_MS`) read them from
 * `ctx.env`. Returning a FRESH overlay per cfg eliminates three classes
 * of bugs the prior `process.env` mutation introduced:
 *
 *   1. **Stale across reloads** — when a YAML reload drops `timeout_ms`,
 *      the previous value no longer leaks into subsequent ticks because
 *      the overlay is derived from `baseEnv` only (which the orchestrator
 *      snapshots once per `diffProbeSchedules`, untouched by prior probe
 *      iterations).
 *   2. **Last-write-wins across multiple configs** — two e2e_demos cfgs
 *      with different `timeout_ms` each get their own overlay; neither
 *      stomps the other.
 *   3. **Test isolation** — `process.env` is never written, so parallel
 *      tests don't see each other's bleed.
 *
 * Exported for unit-test access. Callers outside the orchestrator should
 * NOT use this — drivers should accept their config via constructor deps
 * (`createE2eDemosDriver({ timeoutMs })`) once the singleton-driver
 * registration pattern is replaced by per-cfg factories.
 */
export function envForCfg(
  cfg: ProbeConfig,
  baseEnv: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  if (
    cfg.kind === "e2e_demos" &&
    "timeout_ms" in cfg &&
    cfg.timeout_ms !== undefined
  ) {
    return { ...baseEnv, E2E_DEMOS_TIMEOUT_MS: String(cfg.timeout_ms) };
  }
  return baseEnv;
}

/**
 * Resolver that returns an async probe invoker for a given rule
 * dimension, or null if no in-process probe is available (cron tick
 * should emit `rule.scheduled` without a result and defer to external
 * triggers / the alert engine's synthesized outcome path).
 */
export type CronProbeResolver = (
  dimension: string,
) => (() => Promise<import("./types/index.js").ProbeResult<unknown>>) | null;

/**
 * Diff the currently-scheduled cron entries against the desired set derived
 * from the active rule list. Removes stale entries; registers missing ones
 * with a handler that invokes the dimension's probe (if available) and
 * emits `rule.scheduled` with the probe result. When no probe is wired
 * (pin_drift / version_drift / redirect_decommission — external webhook
 * triggers are the deliberate design for those), the handler emits
 * `rule.scheduled` with `result: undefined` and the alert-engine's
 * synthesized outcome path takes over.
 *
 * The previous implementation attempted to invoke the matching probe with
 * `undefined` input, which threw every tick for input-reading probes.
 * `aimock_wiring` now gets a real invocation via the orchestrator-provided
 * Railway adapter (orchestrator-level config: RAILWAY_TOKEN,
 * RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID, AIMOCK_URL).
 */
export async function diffCronSchedules(
  scheduler: ReturnType<typeof createScheduler>,
  rules: CompiledRule[],
  bus: ReturnType<typeof createEventBus>,
  cronProbeResolver: CronProbeResolver,
): Promise<void> {
  const desired = new Map<
    string,
    { schedule: string; ruleId: string; dimension: string }
  >();
  for (const r of rules) {
    for (const [idx, cron] of r.cronTriggers.entries()) {
      const id = `${r.id}:cron:${idx}`;
      desired.set(id, {
        schedule: cron.schedule,
        ruleId: r.id,
        dimension: r.signal.dimension,
      });
    }
  }
  const currentIds = scheduler.list().map((e) => e.id);
  for (const id of currentIds) {
    if (!desired.has(id) && id.includes(":cron:")) {
      // R2-B.1: await the unregister, mirroring the CR-A2.2 fix on the
      // probe-rule path. Pre-fix this was fire-and-forget — a rejection
      // became an unhandled rejection AND the orphan got no structured
      // log. On rejection we log (operators get a first-class signal)
      // and leave the entry in scheduler.list(); next diff sweep will
      // retry. Same design choice as CR-A2.2: the orphan stays VISIBLE
      // rather than being silently dropped from bookkeeping.
      try {
        await scheduler.unregister(id);
      } catch (err) {
        logger.error("orchestrator.cron-unregister-failed", {
          id,
          err: String(err),
        });
        // R2-B.4: dedicated `scheduler_unregister_failures_total` counter
        // would belong here, but adding it requires extending metrics.ts
        // COUNTER_NAMES (out of scope for this fix). Defer to bucket-b
        // follow-up; the structured log above is the first-class
        // observability surface in the meantime.
      }
    }
  }
  for (const [id, { schedule, ruleId, dimension }] of desired) {
    const invoker = cronProbeResolver(dimension);
    // A2: wrap `scheduler.register` per-rule so a single typoed cron
    // expression (validateCron throws synchronously inside register())
    // does NOT poison the rest of the reload. Pre-fix, one bad rule
    // aborted the for-loop → every subsequent rule silently unscheduled.
    // Pinned by the "continues registering subsequent rules" regression
    // test in orchestrator.test.ts — do not remove without updating it.
    try {
      scheduler.register({
        id,
        cron: schedule,
        handler: async () => {
          let result:
            | import("./types/index.js").ProbeResult<unknown>
            | undefined;
          if (invoker) {
            try {
              result = await invoker();
            } catch (err) {
              // Don't let a probe failure swallow the tick — still emit
              // `rule.scheduled` without a result so downstream rules can
              // still render something (or the alert-engine can synthesize
              // a sentinel). The scheduler also logs its own handler-error
              // when the handler itself throws; this try/catch keeps the
              // handler green so that layer stays quiet for probe bugs.
              logErrorWithStack(logger, "orchestrator.cron-probe-failed", err, {
                ruleId,
                dimension,
              });
            }
          }
          bus.emit("rule.scheduled", {
            ruleId,
            scheduledAt: new Date().toISOString(),
            result,
          });
        },
      });
    } catch (err) {
      logErrorWithStack(logger, "orchestrator.cron-register-failed", err, {
        id,
        ruleId,
        dimension,
        schedule,
      });
      // Continue the loop — other rules must still register.
    }
  }
}

/**
 * Build the cron probe resolver. Reads Railway and aimock config from env
 * and constructs the `aimock_wiring` invoker when everything is present.
 *
 * Other dimensions (pin_drift, version_drift, redirect_decommission) return
 * null here, meaning the cron handler emits `rule.scheduled` with no probe
 * result. Alert-engine's dispatchCronAlert still fires with a synthesized
 * `resolvedState=green` outcome and `triggered=["first"]` (when the rule
 * declares `first` as a trigger) — so a weekly report rule with a cron_only
 * trigger and a static template does render on every tick, using whatever
 * is in its default template. For rules that truly need a probe-produced
 * signal (e.g. pin-drift expecting `{{signal.actualCount}}`), a CI webhook
 * POST is the expected source of that signal.
 */
export function buildCronProbeResolver(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CronProbeResolver {
  const railwayToken = env.RAILWAY_TOKEN;
  const railwayProjectId = env.RAILWAY_PROJECT_ID;
  const railwayEnvironmentId = env.RAILWAY_ENVIRONMENT_ID;
  const aimockUrl = env.AIMOCK_URL;

  // Construct once at boot; each cron tick reuses these closures. Env
  // reads at boot only — rotating RAILWAY_TOKEN requires a restart, same
  // as every other env-driven adapter in this service.
  let aimockInvoker:
    | (() => Promise<import("./types/index.js").ProbeResult<unknown>>)
    | null = null;
  if (railwayToken && railwayProjectId && railwayEnvironmentId && aimockUrl) {
    const adapter = createRailwayAdapter({
      token: railwayToken,
      projectId: railwayProjectId,
      environmentId: railwayEnvironmentId,
    });
    // Boot-time auth probe. Without this, a bad RAILWAY_TOKEN only surfaces
    // as a generic "railway gql 401: ..." error on the first cron tick —
    // hours or days after deploy. We fire `listServices` once at
    // construction; a 401 is logged with a specific
    // `RAILWAY_AUTH_FAILED` hint that operators can grep for. We do NOT
    // throw / exit non-zero — other probes (deploy/e2e) run without
    // Railway and must stay up — but we log at error level so the
    // healthcheck or log-alerts pipeline catches it.
    adapter.listServices().catch((err) => {
      logErrorWithStack(logger, "orchestrator.RAILWAY_AUTH_FAILED", err, {
        hint: "aimock-wiring probe will fail on every cron tick — check RAILWAY_TOKEN / RAILWAY_PROJECT_ID",
      });
    });
    aimockInvoker = async () =>
      aimockWiringProbe.run(
        {
          aimockUrl,
          listServices: adapter.listServices,
          getServiceEnv: adapter.getServiceEnv,
        },
        {
          now: () => new Date(),
          logger,
          env: process.env as Readonly<Record<string, string | undefined>>,
        },
      );
  } else {
    logger.info("orchestrator.aimock-wiring-probe-disabled", {
      hasToken: !!railwayToken,
      hasProjectId: !!railwayProjectId,
      hasEnvironmentId: !!railwayEnvironmentId,
      hasAimockUrl: !!aimockUrl,
    });
  }

  return (dimension: string) => {
    if (dimension === "aimock_wiring") return aimockInvoker;
    // Other cron-only dimensions require an external webhook trigger to
    // supply signal data. See diffCronSchedules JSDoc for rationale.
    return null;
  };
}

/**
 * Minimal Railway GraphQL adapter used by the aimock-wiring probe.
 * Lists services in a project and fetches per-service env-var values
 * for a given environment. Endpoint: https://backboard.railway.app/graphql/v2.
 *
 * Routes through the shared `makeGql` helper exported from
 * `probes/discovery/railway-services.ts` so error taxonomy (Auth /
 * Backend / Schema / Transport class hierarchy) and partial-success
 * envelope handling stay aligned with the discovery source. Pre-fix,
 * the orchestrator's inline gql threw on any non-empty `errors[]` even
 * when `data` was present, and surfaced raw `SyntaxError` from
 * `res.json()` on HTML edge-proxy error pages — both diverged from
 * makeGql's behaviour.
 *
 * Per-tick: each `listServices()` issues one fresh GraphQL roundtrip,
 * so renamed/added Railway services surface on the next cron tick
 * without orchestrator restart. (The prior in-adapter cache survived
 * across ticks and would silently miss service-list changes.)
 *
 * Exported for unit-test access. Production callers go through
 * `buildCronProbeResolver`.
 */

/**
 * Hydrate scheduler `lastRun*` bookkeeping from the PocketBase `probe_runs`
 * collection at boot time so the dashboard doesn't show "never run" for
 * probes that haven't ticked since the last restart.
 *
 * Non-fatal: PB being down at boot must NOT prevent the orchestrator from
 * starting. Individual fetch failures are logged at warn level and skipped.
 */
export async function hydrateProbeLastRuns(deps: {
  scheduler: Scheduler;
  runWriter: ProbeRunWriter;
  logger: Logger;
}): Promise<void> {
  const { scheduler, runWriter, logger: log } = deps;
  const entries = scheduler.list();
  const probeIds = entries
    .filter((e) => e.id.startsWith("probe:"))
    .map((e) => e.id);

  const results = await Promise.allSettled(
    probeIds.map(async (schedulerId) => {
      const probeId = schedulerId.slice("probe:".length);
      const runs = await runWriter.recent(probeId, 1);
      return { schedulerId, runs };
    }),
  );

  let seeded = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      log.warn("orchestrator.hydrate-lastrun-failed", {
        probeId: probeIds[i],
        err: String(result.reason),
      });
      continue;
    }
    const { schedulerId, runs } = result.value;
    if (runs.length === 0) continue;
    const run = runs[0];
    if (!run.finishedAt || run.durationMs === null) continue;
    const startedMs = Date.parse(run.startedAt);
    const finishedMs = Date.parse(run.finishedAt);
    if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs)) continue;
    scheduler.seedEntryLastRun(schedulerId, {
      startedAt: startedMs,
      finishedAt: finishedMs,
      durationMs: run.durationMs,
      summary: run.summary ?? null,
    });
    seeded++;
  }

  if (seeded > 0) {
    log.info("orchestrator.hydrate-lastrun", {
      seeded,
      total: probeIds.length,
    });
  }
}

export function createRailwayAdapter(
  opts: {
    token: string;
    projectId: string;
    environmentId: string;
  },
  deps: { fetchImpl?: typeof fetch } = {},
): {
  listServices: () => Promise<{ name: string; id: string }[]>;
  getServiceEnv: (name: string) => Promise<Record<string, string | undefined>>;
} {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const gql = makeGql({
    fetchImpl,
    token: opts.token,
    sourceName: "orchestrator-railway-adapter",
    abortSignal: undefined,
    logger,
  });

  // `listServices` is pulled into a plain binding so `getServiceEnv`
  // can call it regardless of how it's invoked. The previous `this.listServices()`
  // form broke the moment a caller destructured the adapter
  // (`const { getServiceEnv } = adapter`) or bound `getServiceEnv` as a
  // property of another object (`input.getServiceEnv`).
  const listServices = async (): Promise<{ name: string; id: string }[]> => {
    const { data } = await gql<{
      project: {
        services: { edges: { node: { id: string; name: string } }[] };
      };
    }>(
      `query project($id: String!) {
        project(id: $id) {
          services { edges { node { id name } } }
        }
      }`,
      { id: opts.projectId },
    );
    return data.project.services.edges.map((e) => e.node);
  };

  // In-memory cache for the service list so N getServiceEnv() calls
  // within a single probe tick don't issue N redundant listServices()
  // GraphQL round-trips. TTL of 60s ensures fresh data across ticks
  // while collapsing intra-tick fan-out into a single fetch.
  let cachedServices: {
    data: { name: string; id: string }[];
    fetchedAt: number;
  } | null = null;
  const SERVICE_CACHE_TTL_MS = 60_000;

  const cachedListServices = async (): Promise<
    { name: string; id: string }[]
  > => {
    const now = Date.now();
    if (
      cachedServices &&
      now - cachedServices.fetchedAt < SERVICE_CACHE_TTL_MS
    ) {
      return cachedServices.data;
    }
    const data = await listServices();
    cachedServices = { data, fetchedAt: now };
    return data;
  };

  const getServiceEnv = async (
    name: string,
  ): Promise<Record<string, string | undefined>> => {
    // Use the cached service list so N getServiceEnv() calls within a
    // single probe tick share one listServices() round-trip. The cache
    // TTL (60s) ensures cross-tick freshness while eliminating the N+1
    // fan-out within a tick.
    const services = await cachedListServices();
    const match = services.find((s) => s.name === name);
    if (!match) {
      throw new Error(`railway service not found: ${name}`);
    }
    const { data } = await gql<{ variables: Record<string, string> }>(
      `query variables($projectId: String!, $environmentId: String!, $serviceId: String!) {
        variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
      }`,
      {
        projectId: opts.projectId,
        environmentId: opts.environmentId,
        serviceId: match.id,
      },
    );
    // Sealed Railway variables come back as the literal string "*****"
    // (masking). For wiring-drift detection specifically that's a false
    // drift signal if we map it to undefined — the probe treats undefined
    // as "not wired" and flags a correctly-configured-but-sealed service
    // as drift. We can't un-mask the value, so the defensible behavior is
    // to emit a SENTINEL string that probes can recognize as "sealed, do
    // not conclude (un)wired from this value". The probe treats the
    // sentinel as "unknown" and excludes the service from the drift bucket.
    const vars = data.variables ?? {};
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      if (v === "*****") {
        // __SEALED__ is a stable, probe-facing sentinel: probes compare
        // against this exact string to distinguish "sealed" from "unset".
        // Mapping to undefined conflated the two — an actually-unset var
        // looked identical to a masked one, silently clearing the drift
        // signal on configured services.
        out[k] = "__SEALED__";
      } else {
        out[k] = v;
      }
    }
    return out;
  };

  return { listServices: cachedListServices, getServiceEnv };
}

// ---------------------------------------------------------------------------
// FLEET ROLE DISPATCH
//
// The single harness image boots in one of two runtime ROLES, selected by
// HARNESS_ROLE (see fleet/role-config.ts):
//
//   control-plane — scheduler / queue / aggregator; runs NO Chromium.
//   worker        — runs the BrowserPool, pulls jobs from the control-plane.
//
// `boot()` above is the CURRENT single-process orchestrator (scheduler + pool
// in one process). The fleet split moves those responsibilities into the two
// role bodies below. Those bodies are built in PARALLEL slots — the stubs here
// are intentionally minimal and clearly marked; this slot (S8) owns ONLY the
// config + role-based dispatch wiring so the image boots in the selected mode.
// ---------------------------------------------------------------------------

/**
 * Minimal PB surface `surfaceReclaimedCommErrors` reads — a structural subset
 * of `PbClient` so the real client satisfies it and tests can pass a tiny fake.
 * Exported so unit tests can type their fake against it without `as any`.
 */
export interface CommErrorSurfacePb {
  getOne<T>(collection: string, id: string): Promise<T | null>;
  getFirst<T>(collection: string, filter: string): Promise<T | null>;
}

/** Deps for the REQ-B comm-error surfacer (injectable for unit tests). */
export interface SurfaceReclaimedCommErrorsDeps {
  pb: CommErrorSurfacePb;
  statusWriter: { write(result: ProbeResult<unknown>): Promise<unknown> };
  logger: Logger;
}

/**
 * REQ-B surfacing: fleet-health DETECTS a dead worker and reclaims its in-flight
 * jobs, returning a `worker-crashed-mid-job` PoolCommError per reclaimed job —
 * but a comm error only reaches the dashboard once it is mirrored onto the job's
 * STATUS row (under FLEET_COMM_ERROR_SIGNAL_KEY). The worker-self-report path
 * does that via the aggregator; the control-plane-detected (worker-death) path
 * has no result to aggregate, so we persist it here.
 *
 * Per reclaimed job we resolve the job row's `probe_key` (the dashboard status-
 * row key) and surface the comm error under FLEET_COMM_ERROR_SIGNAL_KEY. HOW
 * depends on whether the cell was EVER OBSERVED:
 *
 *   OBSERVED (a status row exists): re-write the existing row's last-known
 *   colour carrying the overlaid signal. We deliberately do NOT write state
 *   "error" here — the status-writer's error path persists the signal only to
 *   `status_history`, not the `status` row the dashboard reads — so to get the
 *   overlay onto the readable row while PRESERVING its colour we re-write the
 *   real prior state.
 *
 *   NEVER OBSERVED (no status row): there is NO last-known colour to carry. The
 *   previous code INVENTED "green" here, a false green — a service whose worker
 *   crashed before it was ever probed would be reported healthy. Instead we
 *   route an "error"-state result through the writer. Per the writer's F2.1
 *   discipline this records the comm error to `status_history` WITHOUT seeding a
 *   status row, so the cell stays "no data" (the codebase's no-data
 *   representation: absent status row) rather than a fabricated green. The first
 *   real worker observation then establishes the true baseline.
 */
export async function surfaceReclaimedCommErrors(
  deps: SurfaceReclaimedCommErrorsDeps,
  commErrors: readonly PoolCommError[],
): Promise<void> {
  const { pb, statusWriter, logger } = deps;
  for (const err of commErrors) {
    if (!err.jobId) continue;
    try {
      const job = await pb.getOne<{ probe_key?: string }>(
        PROBE_JOBS_COLLECTION,
        err.jobId,
      );
      const probeKey = job?.probe_key;
      if (!probeKey) {
        logger.warn("fleet.control-plane.commerror-no-probekey", {
          jobId: err.jobId,
        });
        continue;
      }
      const existing = await pb.getFirst<{ state?: string; signal?: unknown }>(
        "status",
        `key = ${JSON.stringify(probeKey)}`,
      );
      const baseSignal =
        existing?.signal && typeof existing.signal === "object"
          ? (existing.signal as Record<string, unknown>)
          : {};
      const overlaidSignal = { ...baseSignal, ...commErrorToStatusSignal(err) };
      // Validate the PB string against the known State set rather than
      // blind-casting it — a malformed/legacy `state` degrades to the no-data
      // ("error") path below instead of being re-persisted as a bogus colour.
      const priorState = asKnownState(existing?.state);
      // Never observed → write as "error" so NO green status row is invented;
      // observed → re-write the real prior colour carrying the overlay.
      await statusWriter.write({
        key: probeKey,
        state: priorState ?? "error",
        signal: overlaidSignal,
        observedAt: err.observedAt,
      });
      logger.info("fleet.control-plane.commerror-surfaced", {
        jobId: err.jobId,
        probeKey,
        kind: err.kind,
        carriedState: priorState ?? "no-data",
      });
    } catch (writeErr) {
      // Best-effort: a failed surface must not wedge the monitor — the job is
      // already reclaimed; the next cycle's worker run re-establishes the row.
      logger.warn("fleet.control-plane.commerror-surface-failed", {
        jobId: err.jobId,
        err: writeErr instanceof Error ? writeErr.message : String(writeErr),
      });
    }
  }
}

/**
 * Control-plane role entrypoint: scheduler / queue / aggregator. Runs NO
 * Chromium / BrowserPool.
 *
 * Fully implemented. It:
 *   - stands up the scheduler + the fleet job producer (the non-pool half of
 *     `boot()`), driving enqueue on the producer cron cadence,
 *   - exposes the PocketBase-backed job queue the workers pull from,
 *   - aggregates worker results into the existing status/alert write path via
 *     the result-consumer→aggregator bridge,
 *   - runs the fleet-health monitor that reclaims a dead worker's in-flight
 *     jobs and surfaces the resulting comm errors onto the dashboard, and
 *   - returns the same `{ stop, port, bus }` shape `boot()` returns so the
 *     entrypoint's lifecycle handling stays uniform.
 */
export async function runControlPlane(
  config: FleetRoleConfig,
  opts: BootOptions = {},
): Promise<Awaited<ReturnType<typeof boot>>> {
  logger.info("showcase-harness.fleet.role-selected", {
    role: config.role,
    poolCount: config.poolCount,
  });

  const env = process.env;
  const port = opts.port ?? (Number(env.PORT ?? 8080) || 8080);

  const pbCfg = resolveFleetPbConfig();
  const pb = createPbClient({
    url: pbCfg.url,
    email: pbCfg.email,
    password: pbCfg.password,
    logger,
  });
  const claim = createJobClaimClient({
    url: pbCfg.url,
    email: pbCfg.email,
    password: pbCfg.password,
    logger,
  });
  const bus = createEventBus();
  const queue = createFleetQueueClient({ pb, claim, logger });
  const scheduler = createScheduler({ logger });

  // S5 aggregator — the ONLY authoritative dashboard writer — over the
  // UNCHANGED status + run-history pipelines (preserves the dashboard row
  // shapes exactly; see result-aggregator.ts). It is the single sink for BOTH
  // worker-self-report results AND the REQ-B crash-path comm-error overlays:
  // the control-plane feeds the producer-sweep + fleet-health legs into its
  // `aggregateCommError`.
  const statusWriter = createStatusWriter({ pb, bus, logger });
  // REQ-B: read the CURRENT dashboard status-row colour for an aggregate key so
  // EVERY comm-error leg preserves it on the overlay (a `red` service whose
  // worker crashes — or whose worker self-reports a comm error — stays `red` +
  // unreachable) instead of stomping it to green/degraded. Validates the read
  // value against the known State set; a never-observed key (no row) returns
  // null → the no-data ("error") path, never a fabricated green. Self-defensive:
  // a lookup throw returns null. This SAME resolver is passed into BOTH the
  // aggregator (its `aggregate()` worker-self-report leg) AND the control-plane
  // (its `aggregateCommError` crash/lease-expiry legs) so all three legs share
  // identical prior-colour semantics.
  const statusReader = createStatusReader(pb);
  const resolvePriorState: PriorStateResolver = async (
    aggregateKey,
  ): Promise<State | null> => {
    try {
      const state = await statusReader.getStateByKey(aggregateKey);
      return asKnownState(state) ?? null;
    } catch (err) {
      logger.warn("fleet.control-plane.prior-state-lookup-failed", {
        aggregateKey,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };
  const aggregator = createResultAggregator({
    statusWriter,
    runWriter: createProbeRunWriter(pb),
    logger,
    now: () => Date.now(),
    // Preserve the prior observed colour on the worker-self-report comm-error
    // leg (REQ-B): without this, `aggregate()` falls back to the "degraded"
    // no-data colour for a service whose worker reports a comm error, stomping
    // a previously-RED service. Sharing the control-plane's resolver keeps the
    // aggregate() leg consistent with the aggregateCommError() crash legs.
    resolvePriorState,
  });
  // The worker->aggregator bridge: polls terminal rows carrying an unprocessed
  // ServiceJobResult and aggregates each exactly once. REQ-B (Fix A1): share the
  // SAME prior-state resolver the aggregator + control-plane legs use so the
  // consumer's result-lost leg preserves a previously-observed service's colour
  // on its ⚡ "unreachable" overlay (lands on the LIVE status row, not
  // history-only) instead of falling back to the no-data "error" path.
  const consumer = createResultConsumer({
    pb,
    aggregator,
    logger,
    resolvePriorState,
  });

  // S10 fleet-health: a HEARTBEAT-driven monitor (the complement to the
  // producer's lease-driven sweepExpired) that reads the `workers` roster,
  // detects stale/offline workers, and reclaims their in-flight jobs back to
  // pending — emitting a `worker-crashed-mid-job` comm error (REQ-B) per
  // reclaimed job so the dashboard surfaces the pool outage. The restart hook is
  // best-effort and env-guarded (Railway serviceInstanceRedeploy in staging);
  // locally it stays a no-op so N=1 docker needs no Railway wiring.
  const fleetHealth = createFleetHealthMonitor({
    pb,
    claim,
    logger,
    staleAfterMs: resolveWorkerStaleAfterMs(),
    restartWorker: resolveWorkerRestartHook(logger),
  });

  // CATALOG-AWARE ENUMERATION: the per-service unit enumerator resolves the
  // showcase service catalog (Railway discovery → backendUrl, declared demos,
  // manifest NSF, shape) into one ServiceJobSpec per service, with the d6 driver
  // input serialized into `driverInputs` (the worker re-hydrates it via
  // createD6PayloadToInput). This is the SAME `railway-services` source + d6
  // filter the in-process `d6-all-pills-e2e` probe uses, so the fleet enumerates
  // the IDENTICAL service set (and the LOCAL_SERVICES_JSON local-injection seam
  // works unchanged for the N=1 gate). `opts.fleetEnumerate` still overrides for
  // tests / bespoke runs.
  const enumerate: ServiceEnumerator =
    opts.fleetEnumerate ??
    createD6ServiceEnumerator({
      source: railwayServicesSource,
      env: process.env,
      fetchImpl: globalThis.fetch,
      logger,
    });
  // The three non-d6 BROWSER families (smoke/demos/deep) each get their own
  // catalog enumerator over the SAME `railway-services` source + shared showcase
  // filter, differing only in driverKind + dashboard probeKey prefix (and, for
  // demos, the conveyed `timeout_ms` outer cap). `opts.fleetEnumerate` is a
  // d6-ONLY test seam (it overrides the d6 enumerate above) — the new families
  // always use their real enumerators so a d6-focused test override never
  // accidentally re-points them. Each becomes its own fleet producer below.
  const enumerateSmoke = createE2eSmokeServiceEnumerator({
    source: railwayServicesSource,
    env: process.env,
    fetchImpl: globalThis.fetch,
    logger,
  });
  const enumerateDemos = createE2eDemosServiceEnumerator({
    source: railwayServicesSource,
    env: process.env,
    fetchImpl: globalThis.fetch,
    logger,
  });
  const enumerateDeep = createE2eDeepServiceEnumerator({
    source: railwayServicesSource,
    env: process.env,
    fetchImpl: globalThis.fetch,
    logger,
  });
  // REQ-B producer-sweep leg: the producer's lease-driven `sweepExpired`
  // synthesizes a `worker-crashed-mid-job` comm error per reclaimed job, but a
  // bare swept error carries only the `jobId`, not the `d6:<slug>` dashboard
  // key. This resolver maps each error to its aggregate key via the SAME
  // `probe_jobs` row lookup `surfaceReclaimedCommErrors` used (the job row's
  // `probe_key` IS the `d6:<slug>` aggregate status-row key). Returns null to
  // SKIP an error whose row vanished — the control-plane's surfaceSweepCommErrors
  // logs+skips it. SELF-DEFENSIVE: a lookup throw is caught HERE and returns null
  // (mirroring surfaceReclaimedCommErrors's own try/catch) so one bad lookup
  // skips just this error and never aborts the sweep leg — we do NOT delegate
  // the catch to the caller.
  const resolveSweepAggregateKey: SweepAggregateKeyResolver = async (
    commError,
  ): Promise<string | null> => {
    if (!commError.jobId) return null;
    try {
      const job = await pb.getOne<{ probe_key?: string }>(
        PROBE_JOBS_COLLECTION,
        commError.jobId,
      );
      return job?.probe_key ?? null;
    } catch (err) {
      logger.warn("fleet.control-plane.sweep-aggregate-key-lookup-failed", {
        jobId: commError.jobId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  // Forward-reference the assembled control-plane so the producer's sweep sink
  // can call `surfaceSweepCommErrors` (the control-plane needs the producer, the
  // producer needs the control-plane's sink — break the cycle with a late bind).
  let controlPlaneRef: ControlPlane | undefined;
  const producer = buildJobProducer({
    queue,
    enumerate,
    logger,
    // REQ-B: forward swept comm errors into the control-plane's surfacing sink,
    // which resolves each `d6:<slug>` key and writes the overlay through the
    // aggregator. Best-effort; never aborts production. Only the d6 producer
    // wires this sweep leg — it's the historic REQ-B path and stays unchanged;
    // the three new browser-family producers below do not forward sweep errors.
    onSweepCommErrors: async (commErrors) => {
      await controlPlaneRef?.surfaceSweepCommErrors(commErrors);
    },
  });
  // The three non-d6 browser families each get their own producer over their
  // family enumerator. They intentionally do NOT wire `onSweepCommErrors`: the
  // single REQ-B sweep-surfacing leg stays on the d6 producer (preserving the
  // current behavior); adding parallel sweep legs is out of scope for Phase 2.
  const smokeProducer = buildJobProducer({
    queue,
    enumerate: enumerateSmoke,
    logger,
  });
  const demosProducer = buildJobProducer({
    queue,
    enumerate: enumerateDemos,
    logger,
  });
  const deepProducer = buildJobProducer({
    queue,
    enumerate: enumerateDeep,
    logger,
  });

  // Producer cron cadence. Defaults to the hourly-at-:40 rhythm
  // (DEFAULT_PRODUCER_CRON) that mirrors the legacy in-process d6 probe.
  // Env-overridable via FLEET_PRODUCER_CRON so a local N=1 run can drive the
  // SAME enqueue path on a fast cadence (e.g. `* * * * *`) instead of waiting
  // up to an hour for the top-of-:40 tick — local exercises the identical
  // producer→queue→worker→consumer chain prod runs, just more often. The env
  // override applies to the d6 producer only; the three new browser families
  // keep their literal YAML crons (the deliberate offsets that stagger the
  // shared BrowserPool — see buildProducerSchedules).
  const producerCron = process.env.FLEET_PRODUCER_CRON?.trim() || undefined;

  // Multi-schedule manifest: one producer per browser family, each on its own
  // cron. d6 keeps `fleet-job-producer` @ its (optionally env-overridden) cron;
  // smoke/demos/deep tick on their staggered YAML crons.
  const schedules: ProducerSchedule[] = buildProducerSchedules({
    d6: producer,
    smoke: smokeProducer,
    demos: demosProducer,
    deep: deepProducer,
    ...(producerCron ? { d6Cron: producerCron } : {}),
  });

  // REQ-B: wire the real aggregator + fleet-health monitor + sweep-key resolver
  // into the control-plane assembly so BOTH crash-path legs surface onto the
  // dashboard through the proper module seams (the control-plane runs the
  // fleet-health monitor on its own interval and feeds each reclaimedOverlays
  // entry — and each swept error via surfaceSweepCommErrors — to the aggregator).
  const controlPlane = createControlPlane({
    // `producer` is still required by the API (the degenerate single-d6 case),
    // but it's IGNORED when `schedules` is provided — the d6 producer is already
    // the first entry in `schedules`. The `FLEET_PRODUCER_CRON` env override is
    // threaded into the d6 schedule's cron via `buildProducerSchedules`, so the
    // degenerate `producerCron` knob is intentionally not passed here.
    producer,
    schedules,
    consumer,
    scheduler,
    logger,
    aggregator,
    fleetHealth,
    resolveSweepAggregateKey,
    resolvePriorState,
  });
  controlPlaneRef = controlPlane;

  // ---- In-process HTTP-only probe families ----
  //
  // The control-plane runs the 8 HTTP-only probe families IN-PROCESS by
  // lifting the legacy boot() probe-loader machinery: an HTTP-only
  // `probeRegistry` (no browser drivers), a `createProbeLoader` scoped to the
  // HTTP `kind`s via `includeKind` (browser `e2e_*` YAMLs are SKIPPED, not
  // rejected — they route through the worker producer path), and the same
  // `buildProbeInvoker` loop boot() uses to register one `probe:<id>` entry per
  // config on THIS control-plane's scheduler. Crons are driven FROM the YAML
  // (`cfg.schedule`), never hardcoded. Each tick flows through the SAME
  // status-writer pipeline (`statusWriter`) the worker-result aggregator uses,
  // so a smoke/qa/image_drift result lands on the dashboard identically.
  //
  // The browser families (e2e_d6 / e2e_smoke / e2e_demos / e2e_deep) are NOT
  // run here — d6 goes via the producer; the rest need a BrowserPool the
  // control-plane deliberately does not own.

  // Crash-recovery parity with boot(): finalize any `running` probe_runs rows
  // orphaned by a prior crash BEFORE registering the in-process HTTP probes.
  // boot() does this at startup, but boot() never runs in fleet mode — so
  // without this the control-plane (which now writes probe_runs via the HTTP
  // probes) would leak orphaned `running` rows forever. Best-effort: a sweep
  // failure must NOT abort control-plane boot (mirrors boot's
  // `boot.sweep-stale-runs-failed`).
  try {
    const swept = await sweepStaleRuns(pb);
    if (swept > 0) {
      logger.info("fleet.control-plane.swept-stale-runs", { swept });
    }
  } catch (err) {
    logger.error("fleet.control-plane.sweep-stale-runs-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const httpProbeRegistry = createProbeRegistry();
  registerHttpProbeDrivers(httpProbeRegistry);

  // Drift-guard: the registered HTTP driver kinds and BROWSER_KINDS must be
  // DISJOINT and together cover the full registered driver-kind universe. This
  // is theoretical today (the two sets are hand-maintained from one list), but
  // a future kind mis-added to BROWSER_KINDS — or an HTTP driver whose kind
  // overlaps a browser kind — would silently drop a family from the in-process
  // schedule (it'd be skipped by includeKind yet never run anywhere). Fail loud
  // at boot rather than let a probe go dark unnoticed.
  assertHttpBrowserKindPartition(httpProbeRegistry.list());

  const httpDiscoveryRegistry = createDiscoveryRegistry();
  // `qa` and `image_drift` are per-service discovery probes (railway-services);
  // `version_drift` uses pnpm-packages discovery. (`pin_drift` is single-target
  // — it has NO discovery source.) Register the SAME discovery sources boot()
  // wires so the HTTP families fan out to the identical target set.
  // railway-services is cached (24h TTL) with an auth-failure tracker,
  // mirroring boot().
  const httpAuthTracker = new DiscoveryAuthTracker({
    threshold: 3,
    writer: statusWriter,
    logger,
    now: () => Date.now(),
  });
  httpDiscoveryRegistry.register(
    withCache(railwayServicesSource, {
      ttlMs: 86_400_000,
      logger,
      authTracker: httpAuthTracker,
    }),
  );
  httpDiscoveryRegistry.register(pnpmPackagesDiscoverySource);

  const httpProbeConfigDir =
    opts.configDir !== undefined
      ? path.resolve(opts.configDir, "../probes")
      : path.resolve(process.cwd(), "config/probes");
  const httpProbeLoader = createProbeLoader(httpProbeConfigDir, {
    probeRegistry: httpProbeRegistry,
    discoveryRegistry: httpDiscoveryRegistry,
    // Scope to HTTP-only kinds — browser YAMLs are skipped at load (see
    // BROWSER_KINDS). Without this, a browser YAML on disk would fail the
    // driver-resolution check against the HTTP-only registry and surface a
    // spurious `probes.reload.failed`.
    includeKind: (kind) => !BROWSER_KINDS.has(kind),
    bus: {
      emit(event, payload) {
        bus.emit(event, payload);
      },
    },
    logger,
  });

  // probe_runs writer reused by every per-probe invoker (start/finish a
  // `running` row per tick), constructed once so its PB client is shared.
  const httpRunWriter = createProbeRunWriter(pb);

  // Per-cfg map of scheduler-id → config so /health can count the in-process
  // HTTP rules (and a future /api/probes surface could read it). Keyed by the
  // prefixed scheduler id (`probe:<cfg.id>`).
  const httpProbeConfigs = new Map<string, ProbeConfig>();

  async function diffHttpProbeSchedules(configs: ProbeConfig[]): Promise<void> {
    const desired = new Map<string, ProbeConfig>();
    for (const cfg of configs) {
      desired.set(`probe:${cfg.id}`, cfg);
    }
    // Unregister probe ids no longer desired (YAML deleted on a reload).
    // Unregister-failure post-state (mirrors boot()'s diffProbeSchedules
    // intent): await the unregister and only drop the config from
    // `httpProbeConfigs` on SUCCESS. If unregister REJECTS, the scheduler still
    // holds the old entry, so we deliberately KEEP the config in
    // `httpProbeConfigs` — the orphaned entry stays VISIBLE on /health (its
    // `rules` count still includes it) and a future surface could report its
    // real kind/config rather than an "unknown" orphan. We log the drift; the
    // next successful diff sweep cleans it up once the YAML is restored or the
    // service restarts.
    for (const entry of scheduler.list()) {
      if (!entry.id.startsWith("probe:")) continue;
      if (!desired.has(entry.id)) {
        try {
          await scheduler.unregister(entry.id);
          httpProbeConfigs.delete(entry.id);
        } catch (err) {
          logErrorWithStack(
            logger,
            "fleet.control-plane.probe-unregister-failed",
            err,
            { id: entry.id },
          );
          // Intentionally do NOT delete from httpProbeConfigs — keep the
          // orphan observable with proper metadata (see comment above).
        }
      }
    }
    const baseEnv: Readonly<Record<string, string | undefined>> = {
      ...process.env,
    };
    for (const [id, cfg] of desired) {
      const driver = httpProbeRegistry.get(cfg.kind);
      if (!driver) {
        // Unreachable: the loader already validates kind→driver at load time
        // (and skips browser kinds via includeKind). Cheap guard.
        logger.error("fleet.control-plane.probe-driver-missing", {
          id: cfg.id,
          kind: cfg.kind,
        });
        continue;
      }
      const invoker = buildProbeInvoker(cfg, {
        driver,
        discoveryRegistry: httpDiscoveryRegistry,
        writer: statusWriter,
        logger,
        fetchImpl: globalThis.fetch,
        env: envForCfg(cfg, baseEnv),
        now: () => new Date(),
        scheduler,
        schedulerId: id,
        runWriter: httpRunWriter,
      });
      try {
        scheduler.register({ id, cron: cfg.schedule, handler: invoker });
        httpProbeConfigs.set(id, cfg);
      } catch (err) {
        logErrorWithStack(
          logger,
          "fleet.control-plane.probe-register-failed",
          err,
          { id, kind: cfg.kind, schedule: cfg.schedule },
        );
      }
    }
  }

  try {
    const httpConfigs = await httpProbeLoader.load();
    await diffHttpProbeSchedules(httpConfigs);
    bus.emit("probes.reloaded", { count: httpConfigs.length });
  } catch (err) {
    // A probe-load failure must NOT take down the control-plane — the d6
    // producer + fleet-health legs still function. The failure surface is the
    // structured error log below PLUS the /health `rules` count dropping to 0
    // (see ruleCount wiring), which dashboards/alerting can observe. We also
    // emit `probes.reload.failed` on the bus for any future subscriber, but the
    // control-plane wires NO bus subscriber for it today (unlike boot(), it has
    // no metrics registry) — so the log + ruleCount are the live surface.
    logErrorWithStack(
      logger,
      "fleet.control-plane.initial-probe-load-failed",
      err,
    );
    bus.emit("probes.reload.failed", {
      errors: [{ file: "(initial-load)", error: String(err) }],
    });
  }

  // Hot-reload: re-diff on YAML edits, mirroring boot()'s fire-and-forget
  // watch callback (the chokidar callback is sync/void-returning).
  let unwatchHttpProbes: () => void = () => {};
  try {
    unwatchHttpProbes = httpProbeLoader.watch((next) => {
      diffHttpProbeSchedules(next)
        .then(() => bus.emit("probes.reloaded", { count: next.length }))
        .catch((err) => {
          logErrorWithStack(
            logger,
            "fleet.control-plane.probe-watch-reload-failed",
            err,
          );
          bus.emit("probes.reload.failed", {
            errors: [{ file: "(watch-reload)", error: String(err) }],
          });
        });
    });
  } catch (err) {
    logErrorWithStack(
      logger,
      "fleet.control-plane.probe-watch-init-failed",
      err,
    );
  }

  // On-demand /api/probes trigger surface. The control-plane now runs the
  // in-process HTTP probe families, so operators need the same manual-trigger
  // endpoint boot() exposes (fire a family immediately instead of waiting on
  // its slow cron). Mounted via the SAME `registerProbesRoutes` boot() uses —
  // wired from the control-plane's own `httpProbeRegistry`/`httpProbeConfigs`/
  // `scheduler`/`httpRunWriter`. The router id namespace is the prefixed
  // scheduler id (`probe:<cfg.id>`), matching both `httpProbeConfigs`'s keying
  // and the `scheduler.register({ id: "probe:<id>" })` entries — so the
  // `isProbeId` guard inside the router admits exactly the in-process HTTP
  // families and 404s everything else (browser-only `probe:e2e_*` ids, the
  // producer's own entries, and unknown ids).
  //
  // Token handling mirrors boot() exactly (fail-safe): unset → router omitted;
  // set-but-empty (incl. whitespace-only) → fail-loud at boot so a mistyped
  // `OPS_TRIGGER_TOKEN=` can't silently ship an insecure/always-reject route.
  const rawTriggerToken = process.env.OPS_TRIGGER_TOKEN;
  if (rawTriggerToken !== undefined && rawTriggerToken.trim() === "") {
    throw new Error(
      "OPS_TRIGGER_TOKEN is set but empty — refusing to mount probes router with insecure auth",
    );
  }
  const triggerToken = rawTriggerToken?.trim(); // undefined or non-empty
  const probesDeps = triggerToken
    ? {
        scheduler,
        writer: httpRunWriter,
        getProbeConfig: (id: string): ProbeConfig | undefined =>
          httpProbeConfigs.get(id),
        triggerToken,
        now: () => Date.now(),
      }
    : undefined;
  if (!triggerToken) {
    logger.info("fleet.control-plane.probes-router-disabled", {
      reason: "OPS_TRIGGER_TOKEN unset — /api/probes routes not mounted",
    });
  }

  // Minimal HTTP surface for the role's liveness `port` (fleet-health probes
  // hit this). /health reports OK once the producer's scheduler entry is live.
  const app = buildServer({
    pb,
    logger,
    // The control-plane is a scheduler/queue/aggregator. It now ALSO runs the
    // HTTP-only probe families in-process, so it DOES own probe rules — the
    // count is the number of in-process HTTP probe configs. We keep
    // `role: "control-plane"` (its liveness is still governed by the scheduler
    // signals folded into loopOk — schedulerJobCount>0 covers BOTH the
    // producer entry AND the probe entries). `ruleCount` now reports the REAL
    // in-process probe count instead of a hardcoded 0, so a zero-probe load is
    // OBSERVABLE in the /health JSON `rules` field (for dashboards / alerting).
    // NOTE: the role still DROPS the `rules > 0` gate (server.ts forces
    // `rulesOk = true` for the control-plane role), so a zero-probe load does
    // NOT flip `status` to degraded — the visibility is for dashboards/alerts,
    // not container liveness. Keeping the gate dropped is deliberate: the
    // control-plane's liveness is its scheduler/producer signals, not its probe
    // count.
    role: "control-plane",
    ruleCount: () => httpProbeConfigs.size,
    schedulerStarted: () => scheduler.isStarted(),
    schedulerJobCount: () => scheduler.list().length,
    schedulerIsStopped: () => scheduler.isStopped(),
    bus,
    probes: probesDeps,
  });

  scheduler.start();
  // controlPlane.start() ALSO starts the fleet-health monitor on its own
  // internal interval (REQ-B): because the real `fleetHealth` + `aggregator`
  // are now injected above, each cycle's `reclaimedOverlays` is fed straight to
  // `aggregator.aggregateCommError`, and the producer's swept errors flow
  // through `surfaceSweepCommErrors`. This supersedes the prior ad-hoc
  // fleet-health timer that lived here (which dropped the producer-sweep leg
  // entirely) — the surfacing now lives in the proper control-plane module seams.
  controlPlane.start();

  // Teardown of everything stood up above, used by BOTH bind-failure paths
  // (the synchronous serve() throw and the async server.listen() 'error') so a
  // failed bind never leaves the control-plane's fleet-health + consumer loops
  // and scheduler orphaned (the orphan/restart-loop class boot()'s R4-A.3 race
  // exists to prevent — see boot() above). controlPlane.stop() clears its own
  // internal intervals. Best-effort: operators see the original bind error, not
  // a teardown-failure shadow.
  async function teardownAfterBindFailure(): Promise<void> {
    // Tear down the HTTP-probe file watcher so a failed bind never leaks a
    // chokidar watcher (best-effort; the watcher's own unsubscribe is sync).
    try {
      unwatchHttpProbes();
    } catch (unwatchErr) {
      logger.error("fleet.control-plane.probe-unwatch-after-bind-failure", {
        err:
          unwatchErr instanceof Error ? unwatchErr.message : String(unwatchErr),
      });
    }
    await controlPlane.stop().catch((stopErr) =>
      logger.error("fleet.control-plane.stop-after-bind-failure", {
        err: stopErr instanceof Error ? stopErr.message : String(stopErr),
      }),
    );
    await scheduler.stop().catch((stopErr) =>
      logger.error("fleet.control-plane.scheduler-stop-after-bind-failure", {
        err: stopErr instanceof Error ? stopErr.message : String(stopErr),
      }),
    );
  }

  let server: ReturnType<typeof serve>;
  try {
    server = serve({ fetch: app.fetch, port });
  } catch (err) {
    await teardownAfterBindFailure();
    throw err;
  }

  // R4-A.3 (mirrors boot()): serve() returns the http.Server SYNCHRONOUSLY but
  // bind happens via server.listen() which emits 'error' ASYNCHRONOUSLY for
  // conditions like EADDRINUSE. The try/catch above only catches synchronous
  // throws — a real async bind failure would resolve runControlPlane()
  // "successfully" while leaving the control-plane's fleet-health + consumer
  // loops and scheduler orphaned. Race 'listening' vs 'error' so async bind
  // errors propagate as a rejection AND tear those down. If the server is
  // already `listening` by the time we attach (sync bind raced ahead), short-
  // circuit to resolve.
  await new Promise<void>((resolve, reject) => {
    const srv = server as unknown as {
      listening?: boolean;
      once(event: string, cb: (...args: unknown[]) => void): unknown;
      removeListener(event: string, cb: (...args: unknown[]) => void): unknown;
    };
    const onListen = (): void => {
      srv.removeListener("error", onError);
      resolve();
    };
    const onError = (err: unknown): void => {
      srv.removeListener("listening", onListen);
      // Fire teardown as its own chain so the rejection below isn't gated on
      // stop() — operators see the original bind error, not a stop-failure
      // shadow.
      void teardownAfterBindFailure();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    srv.once("listening", onListen);
    srv.once("error", onError);
    if (srv.listening === true) {
      srv.removeListener("error", onError);
      srv.removeListener("listening", onListen);
      resolve();
    }
  });

  logger.info("showcase-harness.fleet.control-plane.boot", {
    port,
    pbUrl: pbCfg.url,
    poolCount: config.poolCount,
  });

  return {
    port,
    bus,
    async stop(): Promise<void> {
      // Tear down the HTTP-probe file watcher first so no reload fires mid-stop.
      try {
        unwatchHttpProbes();
      } catch (err) {
        logger.error("fleet.control-plane.probe-unwatch-on-stop-failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
      // controlPlane.stop() clears its own internal fleet-health + consumer
      // intervals (REQ-B seams now own that lifecycle).
      await controlPlane.stop();
      await scheduler.stop();
      await new Promise<void>((resolve) => {
        const srv = server as unknown as {
          close?: (cb?: () => void) => void;
        };
        if (typeof srv.close === "function") srv.close(() => resolve());
        else resolve();
      });
      logger.info("showcase-harness.fleet.control-plane.stopped");
    },
  };
}

/**
 * Resolve the heartbeat staleness window (ms): how long since a worker's last
 * heartbeat before fleet-health treats it as dead and reclaims its jobs.
 * Env-overridable via WORKER_STALE_AFTER_MS; defaults to
 * DEFAULT_WORKER_STALE_AFTER_MS. A non-positive / unparseable override falls
 * back to the default rather than disabling the monitor.
 */
function resolveWorkerStaleAfterMs(): number {
  const raw = process.env.WORKER_STALE_AFTER_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_WORKER_STALE_AFTER_MS;
}

/**
 * Resolve the best-effort worker-restart hook fleet-health fires for a wedged
 * worker. In STAGING a wedged worker is recovered by a Railway
 * `serviceInstanceRedeploy`; the wiring is env-guarded so it only engages when
 * the Railway recovery creds are present (RAILWAY_TOKEN + RAILWAY_ENVIRONMENT_ID
 * + the worker service id). LOCALLY (no creds) the hook stays a NO-OP — docker /
 * the worker's own relaunch handles recovery, so N=1 needs no Railway wiring.
 *
 * The actual Railway GraphQL redeploy call is owned by the deploy/ops slot; this
 * resolver only DECIDES whether a real hook or the no-op is installed, logging
 * the decision so the recovery posture is greppable at boot.
 */
function resolveWorkerRestartHook(log: Logger): RestartWorkerHook | undefined {
  const hasRailwayRecovery =
    !!process.env.RAILWAY_TOKEN &&
    !!process.env.RAILWAY_ENVIRONMENT_ID &&
    !!process.env.FLEET_WORKER_SERVICE_ID;
  if (!hasRailwayRecovery) {
    log.info("fleet.control-plane.health-restart-noop", {
      msg: "no Railway recovery creds — wedged-worker restart is a no-op (docker handles local recovery)",
    });
    // undefined → fleet-health installs its default no-op.
    return undefined;
  }
  log.info("fleet.control-plane.health-restart-armed", {
    msg: "Railway recovery creds present — wedged workers will be redeployed best-effort",
  });
  return async (workerId: string): Promise<void> => {
    // Best-effort staging recovery: a wedged worker is redeployed via Railway's
    // serviceInstanceRedeploy. The concrete GraphQL call is owned by the
    // deploy/ops slot; until that lands we log the intent so the recovery path
    // is observable without silently pretending it fired.
    log.warn("fleet.control-plane.health-restart-requested", {
      workerId,
      serviceId: process.env.FLEET_WORKER_SERVICE_ID,
      msg: "wedged worker flagged for Railway serviceInstanceRedeploy (deploy-slot wiring pending)",
    });
  };
}

/**
 * Resolve the PocketBase URL + superuser creds the fleet clients authenticate
 * with, mirroring `boot()`'s fail-loud-in-prod discipline so a worker that
 * can't reach PB dies on boot (visible in deploy CI / Railway health-check)
 * rather than silently claiming nothing.
 */
function resolveFleetPbConfig(): {
  url: string;
  email?: string;
  password?: string;
} {
  const rawPbUrl = process.env.POCKETBASE_URL;
  if (!rawPbUrl && process.env.NODE_ENV === "production") {
    logger.error("orchestrator.FATAL-CONFIG", {
      msg: "POCKETBASE_URL required in production",
      nodeEnv: process.env.NODE_ENV,
    });
    throw new Error(
      "FATAL-CONFIG: POCKETBASE_URL required in production (NODE_ENV=production)",
    );
  }
  return {
    url: rawPbUrl ?? "http://localhost:8090",
    email: process.env.POCKETBASE_SUPERUSER_EMAIL,
    password: process.env.POCKETBASE_SUPERUSER_PASSWORD,
  };
}

/**
 * Minimal PB surface `verifyWorkerRegistered` needs (injectable for tests).
 * Exported so unit tests can type their fake against it without `as any`.
 */
export interface WorkerRegistryReadPb {
  getFirst<T>(collection: string, filter: string): Promise<T | null>;
}

/**
 * Verify a worker's registration row actually PERSISTED, returning the true
 * `registered` value the worker's /health probe reports.
 *
 * `registerWorker` (fleet/worker/registration.ts) is best-effort: it swallows
 * the boot upsert's failure (missing migration, PB 400/outage) and never
 * rejects — so "it returned" is NOT proof the row landed. Pre-fix the worker set
 * `registered = true` regardless, so a failed registration still reported
 * healthy (or, under a /health hard-gate, silently restart-looped). We instead
 * read the row back: present → true, absent OR read error → false. Best-effort
 * by design — a verify failure must not break the worker (it only governs the
 * /health roster signal), so we warn and return false rather than throw.
 */
export async function verifyWorkerRegistered(deps: {
  pb: WorkerRegistryReadPb;
  workerId: string;
  logger: Logger;
}): Promise<boolean> {
  const { pb, workerId, logger } = deps;
  let registered = false;
  try {
    const row = await pb.getFirst<{ id?: string }>(
      WORKERS_COLLECTION,
      `worker_id = ${JSON.stringify(workerId)}`,
    );
    registered = !!row?.id;
  } catch (err) {
    logger.warn("showcase-harness.fleet.worker.registration-verify-failed", {
      workerId,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  if (!registered) {
    logger.warn("showcase-harness.fleet.worker.registration-not-persisted", {
      workerId,
      msg: "worker registration row did not persist — /health will report unregistered until a heartbeat lands it",
    });
  }
  return registered;
}

/**
 * Worker role entrypoint: runs the BrowserPool and pulls per-service jobs from
 * the control-plane queue.
 *
 * Assembles the fleet worker from its slots and hands them to S7's real
 * `runWorker` (fleet/orchestrator.ts), which owns the pool + driver + loop:
 *   - the queue client (S3 `createFleetQueueClient`) over S0's `JobClaimClient`
 *     + the harness `PbClient`,
 *   - the worker's own `BrowserPool` (the self-bounded context budget) + the
 *     pooled d6 driver wired onto it,
 *   - self-registration + heartbeat (S9 `registerWorker`) keyed on the same
 *     workerId the claim CAS stamps as `claimed_by`,
 *   - the catalog-aware payload→d6-input mapping (`createD6PayloadToInput`).
 *
 * Returns the `{ stop, port, bus }` shape symmetric with `boot()` — `stop()`
 * tears down BOTH the registration heartbeat and the worker loop/pool.
 */
export async function runWorker(
  config: FleetRoleConfig,
  opts: BootOptions = {},
): Promise<Awaited<ReturnType<typeof boot>>> {
  logger.info("showcase-harness.fleet.role-selected", {
    role: config.role,
    poolCount: config.poolCount,
  });

  const env = process.env;
  const workerId =
    env.HOSTNAME && env.HOSTNAME.trim().length > 0
      ? `worker-${env.HOSTNAME.trim()}`
      : `worker-${Math.random().toString(36).slice(2, 10)}`;
  // Default to 8080 (the EXPOSE/Dockerfile/healthcheck port the compose worker
  // sets via PORT=8080) — NOT 8090, which is PocketBase's port and never
  // matched the worker healthcheck.
  const port = opts.port ?? (Number(env.PORT ?? 8080) || 8080);

  const pbCfg = resolveFleetPbConfig();
  const pb = createPbClient({
    url: pbCfg.url,
    email: pbCfg.email,
    password: pbCfg.password,
    logger,
  });
  const claim = createJobClaimClient({
    url: pbCfg.url,
    email: pbCfg.email,
    password: pbCfg.password,
    logger,
  });
  const queue = createFleetQueueClient({ pb, claim, logger });

  // The worker's own pool: the self-bounded context budget that gates claiming
  // and keeps the worker under its cgroup pids ceiling. We construct it HERE
  // (rather than letting fleet runWorker construct its own) so the SAME pool
  // backs both the registration capacity heartbeat (S9) and the driver runs.
  const pool = new BrowserPool({ logger });
  await pool.init();

  // Build the worker's DRIVER REGISTRY: every per-service browser driver family
  // wired onto the SAME pooled launcher (via the shared `buildPooledBrowserDrivers`
  // that `registerAllProbeDrivers` also uses, so the fleet worker and the
  // in-process probe registry build the same pooled drivers the same way), keyed
  // by its `driverKind`. The worker loop dispatches each claimed job by
  // `payload.driverKind` to the matching entry, so one worker can run
  // d6/d5/demos/smoke jobs. Each kind carries the shared re-hydration mapper
  // (`createPayloadToInput`) since the four driver input shapes are identical and
  // each driver's own zod schema is the validation gate.
  const pooled = buildPooledBrowserDrivers(pool, logger);

  // Construction-time fail-loud: each factory's self-reported `kind` MUST equal
  // the key constant we register it under, BEFORE the concrete `ProbeDriver` is
  // erased to `ServiceJobDriver` (which drops `.kind`). A key→factory copy-paste
  // swap would otherwise route silently to the wrong driver. Die immediately
  // (visible in deploy CI / Railway health-check).
  const kindChecks: Array<[string, { kind: string }]> = [
    [E2E_D6_DRIVER_KIND, pooled.d6],
    [E2E_DEEP_DRIVER_KIND, pooled.deep],
    [E2E_DEMOS_DRIVER_KIND, pooled.demos],
    [E2E_SMOKE_DRIVER_KIND, pooled.smoke],
  ];
  for (const [key, drv] of kindChecks) {
    if (drv.kind !== key) {
      throw new Error(
        `Fleet worker driver registry mis-wired: driver factory reports kind "${drv.kind}" but is registered under key "${key}" — fix the key→factory mapping in runWorker.`,
      );
    }
  }

  const drivers: DriverRegistry = new Map([
    [
      E2E_D6_DRIVER_KIND,
      {
        driver: pooled.d6,
        payloadToInput: createPayloadToInput(),
        aggregateSlugKey: (serviceSlug: string) => `d6:${serviceSlug}`,
      },
    ],
    [
      E2E_DEEP_DRIVER_KIND,
      {
        driver: pooled.deep,
        payloadToInput: createPayloadToInput(),
      },
    ],
    [
      E2E_DEMOS_DRIVER_KIND,
      {
        driver: pooled.demos,
        payloadToInput: createPayloadToInput(),
      },
    ],
    [
      E2E_SMOKE_DRIVER_KIND,
      {
        driver: pooled.smoke,
        payloadToInput: createPayloadToInput(),
      },
    ],
  ]);

  // Self-register + start the capacity heartbeat against this worker's pool.
  // Best-effort by contract (registerWorker never rejects); a missing workers
  // migration / PB blip warns but never blocks the loop. The endpoint carries a
  // scheme (http://) so the control-plane can probe it as a URL rather than
  // having to synthesize one from a bare host:port.
  const host = env.HOSTNAME?.trim() || "localhost";
  let registered = false;
  const registration = await registerWorker({
    pb,
    pool,
    logger,
    workerId,
    endpoint: `http://${host}:${port}`,
  });
  // registerWorker's boot upsert is best-effort: it SWALLOWS a PB failure
  // (missing migration, 400, outage) and never rejects, so the mere fact that
  // it returned tells us nothing about whether the row actually persisted.
  // Pre-fix this code set `registered = true` unconditionally — a failed
  // registration still reported the worker as on the roster (and, combined with
  // a /health hard-gate, silently restart-looped). Instead VERIFY the row truly
  // landed by reading it back, so `registered` reflects the ACTUAL upsert
  // outcome (see `verifyWorkerRegistered`). The worker still runs its claim/loop
  // regardless; this flag only governs what /health reports.
  registered = await verifyWorkerRegistered({ pb, workerId, logger });

  let worker: Awaited<ReturnType<typeof runFleetWorker>>;
  try {
    worker = await runFleetWorker(config, {
      queue,
      workerId,
      port,
      logger,
      env,
      // Inject the pool we own as the budget gate and the driver REGISTRY
      // (driverKind → { driver, payloadToInput }) we built above — fleet
      // runWorker skips constructing its own pool when both are supplied.
      budgetSource: pool,
      drivers,
      // Wire the worker /health server's liveness probes: pb reachability +
      // registration. The fleet runWorker binds /health on the resolved port so
      // the docker/Railway healthcheck answers (no restart-loop).
      pbHealth: () => pb.health(),
      registered: () => registered,
      // Reflect the live job on the registration row: heartbeat with the
      // claimed jobId when a job starts, null when it settles. Best-effort —
      // registration.heartbeat swallows its own errors, and the loop guards
      // the call, so this can never break the worker.
      onCurrentJobChange: (currentJobId) => {
        void registration.heartbeat(currentJobId);
      },
    });
  } catch (err) {
    // Never strand the registration heartbeat or the pool's chromium processes
    // if the loop fails to start.
    registration.stop();
    await pool.shutdown().catch(() => {});
    throw err;
  }

  return {
    port: worker.port,
    bus: worker.bus,
    async stop(): Promise<void> {
      registration.stop();
      // We injected BOTH budgetSource and driver, so fleet runWorker did NOT
      // construct its own pool — its stop() only drains the in-flight job and
      // stops the loop. WE own the pool, so we shut it down ourselves below.
      await worker.stop();
      await pool.shutdown().catch((err) =>
        logger.error("showcase-harness.fleet.worker.pool-shutdown-failed", {
          workerId,
          err: err instanceof Error ? err.message : String(err),
        }),
      );
    },
  };
}

/**
 * Resolve the fleet role from env and dispatch to the matching role body.
 *
 * HARNESS_ROLE is REQUIRED — there is no default. An unset or empty/whitespace
 * HARNESS_ROLE throws at boot (fail loud) rather than silently defaulting to
 * `control-plane`. This is deliberate: a defaulted control-plane boots POOLLESS
 * and runs NO Chromium probes itself (it only schedules/queues jobs for workers
 * and aggregates their results), so an un-migrated deploy that left HARNESS_ROLE
 * unset would silently stop probing. Failing loud makes that misconfiguration
 * die immediately (visible in deploy CI / Railway health-check). Every fleet
 * member MUST set HARNESS_ROLE explicitly (control-plane or worker) — see
 * docker-compose.local.yml, which sets it on both services.
 */
export async function bootFleet(
  opts: BootOptions = {},
): Promise<Awaited<ReturnType<typeof boot>>> {
  const config = resolveFleetRoleConfig();
  switch (config.role) {
    case "control-plane":
      return runControlPlane(config, opts);
    case "worker":
      return runWorker(config, opts);
    default: {
      // Exhaustiveness guard: a new HarnessRole added without a dispatch arm
      // is a compile error here, not a silent fall-through.
      const _exhaustive: never = config.role;
      throw new Error(`Unhandled HARNESS_ROLE: ${String(_exhaustive)}`);
    }
  }
}

// Only run on direct execution (not when imported). Use fileURLToPath so
// symlinks and cross-platform path normalization don't break the check. The
// entrypoint goes through bootFleet() so HARNESS_ROLE selects the runtime mode.
if (process.argv[1] && url.fileURLToPath(import.meta.url) === process.argv[1]) {
  bootFleet().catch((err) => {
    logErrorWithStack(logger, "showcase-harness.boot-failed", err);
    process.exit(1);
  });
}
