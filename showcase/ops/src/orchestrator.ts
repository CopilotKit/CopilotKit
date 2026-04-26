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
import { createRuleLoader, type CompiledRule } from "./rules/rule-loader.js";
import { createRenderer } from "./render/renderer.js";
import { createAlertEngine } from "./alerts/alert-engine.js";
import { createScheduler } from "./scheduler/scheduler.js";
import { createStatusWriter } from "./writers/status-writer.js";
import { createSlackWebhookTarget } from "./targets/slack-webhook.js";
import { createMetricsRegistry } from "./http/metrics.js";
import {
  createS3Backup,
  createDefaultS3Uploader,
} from "./storage/s3-backup.js";
import { deployEventToProbeResult } from "./probes/deploy-result.js";
import { REDIRECT_DECOMMISSION_SLACK_SAFE_FIELDS } from "./probes/redirect-decommission.js";
import { SMOKE_SLACK_SAFE_FIELDS } from "./probes/smoke.js";
import { aimockWiringProbe } from "./probes/aimock-wiring.js";
import { createProbeRegistry } from "./probes/drivers/index.js";
import { createDiscoveryRegistry } from "./probes/discovery/index.js";
import { createProbeLoader } from "./probes/loader/probe-loader.js";
import { buildProbeInvoker } from "./probes/loader/probe-invoker.js";
import type { ProbeConfig } from "./probes/loader/schema.js";
import { createProbeRunWriter } from "./probes/run-history.js";
import { aimockWiringDriver } from "./probes/drivers/aimock-wiring.js";
import { pinDriftDriver } from "./probes/drivers/pin-drift.js";
import { smokeDriver } from "./probes/drivers/smoke.js";
import { imageDriftDriver } from "./probes/drivers/image-drift.js";
import { versionDriftDriver } from "./probes/drivers/version-drift.js";
import { redirectDecommissionDriver } from "./probes/drivers/redirect-decommission.js";
import { e2eSmokeDriver } from "./probes/drivers/e2e-smoke.js";
import { e2eDemosDriver } from "./probes/drivers/e2e-demos.js";
import { qaDriver } from "./probes/drivers/qa.js";
import { railwayServicesSource } from "./probes/discovery/railway-services.js";
import { pnpmPackagesDiscoverySource } from "./probes/discovery/pnpm-packages.js";
import { logger, reloadLogLevel } from "./logger.js";
import type { State, StatusRecord, Target } from "./types/index.js";

export interface BootOptions {
  configDir?: string;
  port?: number;
  bootstrapWindowMs?: number;
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
  // as side-emissions (see probes/drivers/smoke.ts). The safe-field sets for
  // them mirror smoke's sanitized-errorDesc allow-list so triple-brace
  // {{{signal.errorDesc}}} in the red-tick YAMLs loads. Keep these in lockstep
  // with SMOKE_SLACK_SAFE_FIELDS — any new sanitized field added there SHOULD
  // be added here too unless there's a dimension-specific reason otherwise.
  const L1_L4_SLACK_SAFE_FIELDS = ["errorDesc"] as const;
  const slackSafeFields: Record<string, Set<string>> = {
    redirect_decommission: new Set(REDIRECT_DECOMMISSION_SLACK_SAFE_FIELDS),
    smoke: new Set(SMOKE_SLACK_SAFE_FIELDS),
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
    logger.error("orchestrator.initial-rule-load-failed", { err: String(err) });
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

  const probeRegistry = createProbeRegistry();
  const discoveryRegistry = createDiscoveryRegistry();
  probeRegistry.register(aimockWiringDriver);
  probeRegistry.register(pinDriftDriver);
  probeRegistry.register(smokeDriver);
  probeRegistry.register(imageDriftDriver);
  probeRegistry.register(versionDriftDriver);
  probeRegistry.register(redirectDecommissionDriver);
  probeRegistry.register(e2eSmokeDriver);
  probeRegistry.register(e2eDemosDriver);
  probeRegistry.register(qaDriver);
  discoveryRegistry.register(railwayServicesSource);
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
          logger.error("orchestrator.probe-unregister-failed", {
            id: entry.id,
            err: String(err),
          });
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
        env: process.env as Readonly<Record<string, string | undefined>>,
        now: () => new Date(),
        // F1: thread the live scheduler + runWriter through so the invoker's
        // optional B7 hooks (ProbeRunTracker registration, probe_runs row
        // start/finish) actually fire in production. Pre-fix both deps were
        // unset and tracker + run-history were dead code.
        scheduler,
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
        logger.error("orchestrator.probe-register-failed", {
          id,
          kind: cfg.kind,
          schedule: cfg.schedule,
          err: String(err),
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
    logger.error("orchestrator.initial-probe-load-failed", {
      err: String(err),
    });
    bus.emit("probes.reload.failed", {
      errors: [{ file: "(initial-load)", error: String(err) }],
    });
  }

  const unwatchProbes = probeLoader.watch((next) => {
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
        logger.error("orchestrator.probe-watch-reload-failed", {
          err: String(err),
        });
        bus.emit("probes.reload.failed", {
          errors: [{ file: "(watch-reload)", error: String(err) }],
        });
      });
  });

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
      writer.write(result).catch((err) =>
        logger.error("orchestrator.deploy-writer-failed", {
          err: String(err),
        }),
      );
    }),
  );

  const sharedSecret = process.env.SHARED_SECRET;
  const sharedSecretPrev = process.env.SHARED_SECRET_PREV;
  const webhookSecrets = [sharedSecret, sharedSecretPrev].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );

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
  const triggerToken = rawTriggerToken; // undefined or non-empty
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
          const name = `showcase-ops-${new Date()
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
      logger.error("orchestrator.s3-backup-init-failed", { err: String(err) });
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
    schedulerRunning = false;
    throw err;
  }
  logger.info("showcase-ops.boot", { port, pbUrl, rules: rules.length });

  const sigHup = (): void => {
    logger.info("showcase-ops.sighup-reload");
    // Re-read LOG_LEVEL first so any log produced by reloadRules() (or its
    // downstream emissions) honours the new verbosity. logger.ts caches
    // LOG_LEVEL at module-load time; without this, operators who SIGHUP'd
    // to bump to debug saw the rule-reload log at the OLD level.
    reloadLogLevel();
    reloadRules().catch((err) => {
      logger.error("orchestrator.reload-failed", { err: String(err) });
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
 * Thin reader over the `status` collection that the alert engine uses
 * when synthesizing a cron outcome's previousState. Defense-in-depth:
 * runs `assertSafeKey` on the incoming key so a control-char key never
 * reaches PB's filter parser (where the parse error would get swallowed
 * by dispatchCronAlert's wrapper and silently fail the rule).
 *
 * Exported for tests so the key-safety invariant can be asserted
 * without spinning up the full boot path.
 */
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
              logger.error("orchestrator.cron-probe-failed", {
                ruleId,
                dimension,
                err: String(err),
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
      logger.error("orchestrator.cron-register-failed", {
        id,
        ruleId,
        dimension,
        schedule,
        err: String(err),
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
      logger.error("orchestrator.RAILWAY_AUTH_FAILED", {
        err: String(err),
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
 * for a given environment. Endpoint: https://backboard.railway.com/graphql/v2.
 *
 * Kept in-file (rather than spun out into a module) because this is the
 * only consumer today — if pin_drift or version_drift ever grow in-process
 * probes that also need Railway, promote this to `src/adapters/railway.ts`.
 */
function createRailwayAdapter(opts: {
  token: string;
  projectId: string;
  environmentId: string;
}): {
  listServices: () => Promise<{ name: string; id: string }[]>;
  getServiceEnv: (name: string) => Promise<Record<string, string | undefined>>;
} {
  const endpoint = "https://backboard.railway.com/graphql/v2";

  async function gql<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`railway gql ${res.status}: ${text}`);
    }
    const json = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      throw new Error(
        `railway gql errors: ${json.errors.map((e) => e.message).join("; ")}`,
      );
    }
    return json.data as T;
  }

  // Cache services by name so getServiceEnv doesn't refetch the service
  // list on every call. A cron tick on `aimock_wiring` calls listServices
  // once and getServiceEnv once per service — keeping the mapping around
  // shaves one extra GraphQL round-trip per invocation.
  let cachedServices: { name: string; id: string }[] | null = null;

  // `listServices` is pulled into a plain binding so `getServiceEnv`
  // can call it regardless of how it's invoked. The previous `this.listServices()`
  // form broke the moment a caller destructured the adapter
  // (`const { getServiceEnv } = adapter`) or bound `getServiceEnv` as a
  // property of another object (`input.getServiceEnv`) — both patterns
  // already in use (see buildCronProbeResolver passing `adapter.getServiceEnv`
  // into `aimockWiringProbe.run` as `input.getServiceEnv`). Pre-fix the
  // fallback path would throw `TypeError: Cannot read properties of
  // undefined (reading 'listServices')` as soon as the cache was cold.
  const listServices = async (): Promise<{ name: string; id: string }[]> => {
    const data = await gql<{
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
    const out = data.project.services.edges.map((e) => e.node);
    cachedServices = out;
    return out;
  };

  const getServiceEnv = async (
    name: string,
  ): Promise<Record<string, string | undefined>> => {
    if (!cachedServices) {
      // Fallback path for callers that skip listServices — still fetch.
      // Uses the lexically-captured binding instead of `this.listServices`,
      // which would be undefined when this method is passed as a callback.
      await listServices();
    }
    const match = cachedServices!.find((s) => s.name === name);
    if (!match) {
      throw new Error(`railway service not found: ${name}`);
    }
    const data = await gql<{ variables: Record<string, string> }>(
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

  return { listServices, getServiceEnv };
}

// Only run boot() when executed directly (not when imported). Use fileURLToPath
// so symlinks and cross-platform path normalization don't break the check.
if (process.argv[1] && url.fileURLToPath(import.meta.url) === process.argv[1]) {
  boot().catch((err) => {
    logger.error("showcase-ops.boot-failed", { err: String(err) });
    process.exit(1);
  });
}
