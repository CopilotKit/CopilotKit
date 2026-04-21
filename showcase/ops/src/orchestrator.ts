import path from "node:path";
import url from "node:url";
import { promises as fs } from "node:fs";
import { serve } from "@hono/node-server";
import { buildServer } from "./http/server.js";
import { createPbClient } from "./storage/pb-client.js";
import { createAlertStateStore } from "./storage/alert-state-store.js";
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
import { logger } from "./logger.js";
import type { Target } from "./types/index.js";

export interface BootOptions {
  configDir?: string;
  port?: number;
  bootstrapWindowMs?: number;
}

export async function boot(opts: BootOptions = {}): Promise<{
  stop: () => Promise<void>;
  port: number;
}> {
  const pbUrl = process.env.POCKETBASE_URL ?? "http://localhost:8090";
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
  // Backup failures are first-class signals: increment a dimension-labelled
  // probe_runs series so the existing dashboards/alert rules can catch them
  // via the same `dimension=` grouping used for every other signal, and
  // emit a warn log for human-visible triage.
  busUnsubs.push(
    bus.on("internal.backup.failed", (payload) => {
      metrics.inc("probe_runs", { dimension: "internal_backup" });
      logger.warn("orchestrator.backup-failed", { err: payload.err });
    }),
  );

  const targets = new Map<string, Target>();
  targets.set("slack_webhook", createSlackWebhookTarget({ logger }));

  const configDir =
    opts.configDir ?? path.resolve(process.cwd(), "config/alerts");
  const slackSafeFields: Record<string, Set<string>> = {
    redirect_decommission: new Set(REDIRECT_DECOMMISSION_SLACK_SAFE_FIELDS),
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
  });
  engine.start();

  let rules: CompiledRule[] = [];

  async function reloadRules(): Promise<void> {
    const next = await loader.load();
    rules = next;
    engine.reload(next);
    diffCronSchedules(scheduler, next, bus);
    bus.emit("rules.reloaded", { count: next.length });
  }

  try {
    await reloadRules();
  } catch (err) {
    logger.error("orchestrator.initial-rule-load-failed", { err: String(err) });
    throw err;
  }

  const unwatch = loader.watch((next) => {
    rules = next;
    engine.reload(next);
    diffCronSchedules(scheduler, next, bus);
    // Emit rules.reloaded on file-watch reload too so the metric stays
    // accurate regardless of reload source (SIGHUP vs file event).
    bus.emit("rules.reloaded", { count: next.length });
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
  const app = buildServer({
    pb,
    logger,
    ruleCount: () => rules.length,
    loopAlive: () => loopAlive,
    schedulerStarted: () => schedulerRunning,
    bus,
    webhookSecrets,
    metrics,
  });

  // S3 backup — cron 0 3 * * * (daily 03:00 UTC). Retention handled via
  // bucket lifecycle policy (see storage/s3-backup.ts).
  const s3Bucket = process.env.S3_BACKUP_BUCKET ?? "";
  const awsRegion = process.env.AWS_REGION ?? "us-east-1";
  const pbDataPath = process.env.PB_DATA_PATH ?? "/app/pb_data/data.db";
  if (s3Bucket) {
    try {
      const uploader = await createDefaultS3Uploader(awsRegion);
      const backup = createS3Backup({
        bucket: s3Bucket,
        region: awsRegion,
        readSource: () => fs.readFile(pbDataPath),
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
      logger.error("orchestrator.s3-backup-init-failed", { err: String(err) });
    }
  }

  const port = opts.port ?? Number(process.env.PORT ?? 8080);
  const server = serve({ fetch: app.fetch, port });
  scheduler.start();
  schedulerRunning = true;
  logger.info("showcase-ops.boot", { port, pbUrl, rules: rules.length });

  const sigHup = (): void => {
    logger.info("showcase-ops.sighup-reload");
    reloadRules().catch((err) =>
      logger.error("orchestrator.reload-failed", { err: String(err) }),
    );
  };
  process.on("SIGHUP", sigHup);

  return {
    port,
    async stop() {
      loopAlive = false;
      schedulerRunning = false;
      process.off("SIGHUP", sigHup);
      unwatch();
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
 * Diff the currently-scheduled cron entries against the desired set derived
 * from the active rule list. Removes stale entries; registers missing ones
 * with a handler that simply emits `rule.scheduled` with no probe result.
 *
 * Cron-only rules DO NOT get a live probe result from this handler. They are
 * either (a) purely scheduled reports whose alert template reads only static
 * text + env, or (b) driven by upstream jobs that POST the ProbeResult in via
 * a webhook which in turn emits `rule.scheduled` with a `result` field.
 *
 * The previous implementation attempted to invoke the matching probe with
 * `undefined` input, which threw every tick for input-reading probes. The
 * alert-engine's cron-alert path already handles `result: undefined` by
 * synthesizing a sentinel outcome, so emitting without a probe call is both
 * safer and matches the existing fake-result flow.
 */
function diffCronSchedules(
  scheduler: ReturnType<typeof createScheduler>,
  rules: CompiledRule[],
  bus: ReturnType<typeof createEventBus>,
): void {
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
    if (!desired.has(id) && id.includes(":cron:")) scheduler.unregister(id);
  }
  for (const [id, { schedule, ruleId }] of desired) {
    scheduler.register({
      id,
      cron: schedule,
      handler: async () => {
        bus.emit("rule.scheduled", {
          ruleId,
          scheduledAt: new Date().toISOString(),
          // No probe invocation — cron-only rules use the alert-engine's
          // synthesized outcome path (or are driven by upstream POSTs).
          result: undefined,
        });
      },
    });
  }
}

// Only run boot() when executed directly (not when imported). Use fileURLToPath
// so symlinks and cross-platform path normalization don't break the check.
if (process.argv[1] && url.fileURLToPath(import.meta.url) === process.argv[1]) {
  boot().catch((err) => {
    logger.error("showcase-ops.boot-failed", { err: String(err) });
    process.exit(1);
  });
}
