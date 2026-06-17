import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import {
  boot,
  buildCronProbeResolver,
  createStatusReader,
  createBrowserPoolHealthSignals,
  BROWSER_POOL_DEGRADED_KEY,
  BROWSER_POOL_UNRECOVERABLE_KEY,
  BROWSER_POOL_ALERT_WEBHOOK_ENV,
  diffCronSchedules,
  envForCfg,
  createRailwayAdapter,
  registerAllProbeDrivers,
  buildPooledBrowserDrivers,
  buildProducerSchedules,
  buildSweepCommErrorSink,
  FLEET_FAMILY_PERIODS_MS,
  PRODUCER_FAMILY_WIRING,
  FLEET_PRODUCER_SMOKE_CRON,
  FLEET_PRODUCER_DEMOS_CRON,
  FLEET_PRODUCER_DEEP_CRON,
  FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
  FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
  FLEET_PRODUCER_DEEP_SCHEDULE_ID,
  hydrateProbeLastRuns,
  verifyWorkerRegistered,
  drainFleetWorker,
  DRAIN_DEREGISTER_TIMEOUT_MS,
} from "./orchestrator.js";
import { runWorker as runFleetWorker } from "./fleet/orchestrator.js";
import { registerWorker } from "./fleet/worker/registration.js";
import type { RegistrationPbClient } from "./fleet/worker/registration.js";
import type { FleetRoleConfig } from "./fleet/role-config.js";
import type {
  FleetQueueClient,
  ClaimedJob,
  JobLease,
} from "./fleet/contracts.js";
import type {
  ServiceJobDriver,
  ServiceDriverContext,
} from "./fleet/worker/worker-loop.js";
import {
  DEFAULT_PRODUCER_CRON,
  FLEET_PRODUCER_SCHEDULE_ID,
} from "./fleet/control-plane/control-plane.js";
import { FLEET_FAMILIES } from "./fleet/control-plane/run-view.js";
import type { JobProducer } from "./fleet/control-plane/job-producer.js";
import { createE2eFullDriver } from "./probes/drivers/d6-all-pills.js";
import { createE2eDemosDriver } from "./probes/drivers/d3-readiness.js";
import { createE2eSmokeDriver } from "./probes/drivers/d4-chat-roundtrip.js";
import {
  E2E_D6_DRIVER_KIND,
  E2E_DEMOS_DRIVER_KIND,
  E2E_SMOKE_DRIVER_KIND,
} from "./fleet/worker/payload-mapper.js";
import type { WorkerRegistryReadPb } from "./orchestrator.js";
import type { State, ProbeResult } from "./types/index.js";
import type {
  StatusWriter,
  OverlayWriteOutcome,
} from "./writers/status-writer.js";
import {
  FLEET_COMM_ERROR_SIGNAL_KEY,
  probeKeyFamily,
} from "./fleet/contracts.js";
import type { PoolCommError } from "./fleet/contracts.js";
import {
  createD6ServiceEnumerator,
  createE2eSmokeServiceEnumerator,
  createE2eDeepServiceEnumerator,
  createE2eDemosServiceEnumerator,
} from "./fleet/control-plane/catalog-enumerator.js";
import type { DiscoverySource } from "./probes/types.js";
import type { RailwayServiceInfo } from "./probes/discovery/railway-services.js";
import { BrowserPool } from "./probes/helpers/browser-pool.js";
import { createProbeRegistry } from "./probes/drivers/index.js";
import type { createScheduler } from "./scheduler/scheduler.js";
import { createEventBus } from "./events/event-bus.js";
import { logger } from "./logger.js";
import type { CompiledRule } from "./rules/rule-loader.js";
import type { ProbeConfig } from "./probes/loader/schema.js";
import { buildWorkerHealthServer } from "./fleet/worker/worker-health.js";

/**
 * F1.1 integration coverage: `buildServer` in orchestrator.ts must pass
 * `schedulerJobCount` + `schedulerIsStopped` probes through to /health, NOT
 * just `schedulerStarted`. Pre-fix these probes were never wired — the HTTP
 * unit tests in src/http/server.test.ts already lock the contract at the
 * buildServer boundary, but nothing verified orchestrator.ts uses them.
 *
 * The integration test boots a real orchestrator against:
 *   - an isolated temp `configDir` with zero YAML rule files (so
 *     scheduler.getJobCount() stays at 0)
 *   - an arbitrary open port discovered via net.createServer() + close()
 *   - no PB credentials (pb.health() returns false against localhost:8090
 *     which normally isn't up in CI — that degrades status but /health
 *     still returns the canonical loop label)
 *
 * The assertions focus on the `loop` field + status-code because those are
 * the two probes F1.1 is about; pb-up status is orthogonal and already
 * covered by server.test.ts.
 */
// FILE-LEVEL MOCK HYGIENE: vi.doMock factories persist across the whole file
// (vi.resetModules clears the module CACHE, not the mock REGISTRY), so a
// describe that doMocks a module and only runs resetModules/restoreAllMocks in
// its afterEach leaks its factory into every later test that imports the same
// module without re-mocking it. The HTTP-probes describe already doUnmocks its
// own set per-describe; these three are doMocked by the REQ-B / worker-self-
// report / 4-schedules describes which did NOT unmock them. Unmock after EVERY
// test so a leaked queue-client/status-writer/result-consumer stub can never
// poison a sibling.
afterEach(() => {
  vi.doUnmock("./fleet/queue-client.js");
  vi.doUnmock("./writers/status-writer.js");
  vi.doUnmock("./fleet/control-plane/result-consumer.js");
});

async function pickPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (typeof addr === "object" && addr) s.close(() => resolve(addr.port));
      else {
        s.close();
        reject(new Error("port-pick failed"));
      }
    });
  });
}

async function mkTempConfigDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-orch-test-"));
  return dir;
}

describe("orchestrator /health wiring (F1.1)", () => {
  let tempDir: string;
  let stopFn: (() => Promise<void>) | null = null;
  let port = 0;

  beforeEach(async () => {
    tempDir = await mkTempConfigDir();
    // No _defaults.yml, no rule files — rule-loader returns []
    // and scheduler.getJobCount() stays at 0. That's the point: assert
    // /health surfaces the pathological state.
    port = await pickPort();
  });

  afterEach(async () => {
    if (stopFn) {
      await stopFn();
      stopFn = null;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('/health returns 503 with loop:"no-jobs" when scheduler has zero jobs', async () => {
    // Boot with empty configDir → zero rules → zero cron entries.
    // bootstrapWindowMs=0 so the alert engine isn't chatty in logs.
    const booted = await boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    stopFn = booted.stop;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      loop: string;
      schedulerJobs?: number;
    };
    // Pre-fix: schedulerJobCount was not wired → body had no schedulerJobs
    // field, and loop reported "ok" despite zero registered jobs. Post-fix:
    // loop reflects "no-jobs" and the schedulerJobs count is surfaced.
    expect(body.loop).toBe("no-jobs");
    expect(body.schedulerJobs).toBe(0);
  });

  it('/health returns 503 with loop:"stopped" after stop() completes', async () => {
    const booted = await boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    // Call stop() then try to /health AFTER stop. The HTTP server is
    // closed by stop() so the fetch MUST fail with a connection-level
    // error. Anything else — 200 "ok", silent hang, 5xx with a body that
    // claims healthy — is a bug. The pre-fix shape of this test had a
    // `|| true` tautology that silently accepted any outcome; this
    // rewrite fails loud if the stopped orchestrator keeps serving.
    await booted.stop();
    stopFn = null; // don't double-stop in afterEach
    let networkErrored = false;
    let errorMessage = "";
    let statusIfServed: number | null = null;
    let bodyLoopIfServed: string | undefined;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      statusIfServed = r.status;
      const body = (await r.json()) as { loop?: string; status?: string };
      bodyLoopIfServed = body.loop;
    } catch (err) {
      networkErrored = true;
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    if (networkErrored) {
      // Connection refused / fetch-failed / socket hang-up are all
      // acceptable — they prove the server shut down. HF-A8: the old
      // `expect(networkErrored).toBe(true)` was tautological inside this
      // truthy branch; assert a meaningful shape of the error string so
      // we catch regressions where `fetch()` rejects for some unrelated
      // reason (DNS failure, bad URL, TLS error) but the port is
      // actually still serving.
      expect(errorMessage.length).toBeGreaterThan(0);
      expect(errorMessage).toMatch(
        /fetch failed|ECONNREFUSED|ECONN|network|socket|closed/i,
      );
    } else {
      // If the port was somehow reclaimed and another process answered,
      // the body MUST NOT claim "ok". This is the real regression guard
      // the old `|| true` assertion was meant to express.
      expect(statusIfServed).not.toBe(200);
      expect(bodyLoopIfServed).not.toBe("ok");
    }
  });

  // HF13-A2: orchestrator must fail loud on missing POCKETBASE_URL in prod.
  // Pre-fix the `?? "http://localhost:8090"` fallback silently bound a prod
  // orchestrator to a non-existent localhost PB.
  it("HF13-A2: boot throws FATAL-CONFIG when NODE_ENV=production and POCKETBASE_URL unset", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevPbUrl = process.env.POCKETBASE_URL;
    const prevSecret = process.env.SHARED_SECRET;
    process.env.NODE_ENV = "production";
    delete process.env.POCKETBASE_URL;
    // R1-F3: hoisted POCKETBASE_URL check now fires BEFORE
    // loadWebhookSecrets — but production still requires both, so set a
    // real SHARED_SECRET to ensure the test specifically asserts the
    // POCKETBASE_URL guard, not the SHARED_SECRET one.
    process.env.SHARED_SECRET = "hf13-a2-test-secret";
    try {
      await expect(
        boot({ configDir: tempDir, port, bootstrapWindowMs: 0 }),
      ).rejects.toThrow(/FATAL-CONFIG: POCKETBASE_URL/);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevPbUrl !== undefined) process.env.POCKETBASE_URL = prevPbUrl;
      if (prevSecret === undefined) delete process.env.SHARED_SECRET;
      else process.env.SHARED_SECRET = prevSecret;
    }
  });

  // R1-F3: POCKETBASE_URL fail-loud is now symmetric with SHARED_SECRET —
  // it throws on NODE_ENV=development (pre-fix this only fired on
  // production), and the new HARNESS_ALLOW_NO_PB_URL=1 escape hatch
  // permits unset POCKETBASE_URL the same way HARNESS_ALLOW_NO_SECRET=1
  // does for SHARED_SECRET. Tests both branches.
  it("R1-F3: boot throws FATAL-CONFIG when POCKETBASE_URL unset AND NODE_ENV is non-test (regardless of production)", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevPbUrl = process.env.POCKETBASE_URL;
    const prevSecret = process.env.SHARED_SECRET;
    const prevEscape = process.env.HARNESS_ALLOW_NO_PB_URL;
    process.env.NODE_ENV = "development";
    delete process.env.POCKETBASE_URL;
    delete process.env.HARNESS_ALLOW_NO_PB_URL;
    process.env.SHARED_SECRET = "r1f3-test-secret";
    try {
      await expect(
        boot({ configDir: tempDir, port, bootstrapWindowMs: 0 }),
      ).rejects.toThrow(/FATAL-CONFIG: POCKETBASE_URL/);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevPbUrl !== undefined) process.env.POCKETBASE_URL = prevPbUrl;
      if (prevSecret === undefined) delete process.env.SHARED_SECRET;
      else process.env.SHARED_SECRET = prevSecret;
      if (prevEscape !== undefined)
        process.env.HARNESS_ALLOW_NO_PB_URL = prevEscape;
    }
  });

  it("R1-F3: boot succeeds when POCKETBASE_URL unset AND HARNESS_ALLOW_NO_PB_URL=1 (escape hatch)", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevPbUrl = process.env.POCKETBASE_URL;
    const prevEscape = process.env.HARNESS_ALLOW_NO_PB_URL;
    const prevSecret = process.env.SHARED_SECRET;
    process.env.NODE_ENV = "development";
    delete process.env.POCKETBASE_URL;
    process.env.HARNESS_ALLOW_NO_PB_URL = "1";
    // SHARED_SECRET also fail-loud on non-test NODE_ENV; set it so this
    // test specifically exercises the POCKETBASE_URL escape hatch.
    process.env.SHARED_SECRET = "r1f3-escape-test-secret";
    try {
      const booted = await boot({
        configDir: tempDir,
        port,
        bootstrapWindowMs: 0,
      });
      stopFn = booted.stop;
      expect(booted.port).toBe(port);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevPbUrl !== undefined) process.env.POCKETBASE_URL = prevPbUrl;
      if (prevEscape === undefined) delete process.env.HARNESS_ALLOW_NO_PB_URL;
      else process.env.HARNESS_ALLOW_NO_PB_URL = prevEscape;
      if (prevSecret === undefined) delete process.env.SHARED_SECRET;
      else process.env.SHARED_SECRET = prevSecret;
    }
  });

  // HF13-A2 negative: non-prod boot with unset POCKETBASE_URL still succeeds
  // (localhost fallback preserved for dev / tests).
  it("HF13-A2: boot succeeds without POCKETBASE_URL when NODE_ENV is not production", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevPbUrl = process.env.POCKETBASE_URL;
    process.env.NODE_ENV = "test";
    delete process.env.POCKETBASE_URL;
    try {
      const booted = await boot({
        configDir: tempDir,
        port,
        bootstrapWindowMs: 0,
      });
      stopFn = booted.stop;
      // Any successful boot returning a port proves the fallback still works.
      expect(booted.port).toBe(port);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevPbUrl !== undefined) process.env.POCKETBASE_URL = prevPbUrl;
    }
  });

  // R2-B.2 / R4-A.3: a boot that successfully init()s the browser pool but
  // then FAILS TO BIND (sync serve() throw OR async EADDRINUSE) must tear down
  // the pool, not just the scheduler. The pool launches long-lived chromium
  // processes in init(); browserPool.shutdown() only runs in the returned
  // stop() closure, which a boot rejection never reaches. So a leaked boot
  // strands every chromium process — on a restart loop this compounds into the
  // PID-ceiling exhaustion the pool hardening exists to prevent.
  it("R4-A.3: a boot that inits the pool then fails to bind shuts the pool down (no chromium leak)", async () => {
    // Stub init() so the pool reports ready WITHOUT launching real chromium,
    // and spy shutdown() so we can assert the boot-failure path tears it down.
    const initSpy = vi
      .spyOn(BrowserPool.prototype, "init")
      .mockResolvedValue(undefined);
    const shutdownSpy = vi
      .spyOn(BrowserPool.prototype, "shutdown")
      .mockResolvedValue(undefined);

    // Occupy `port` so boot()'s serve() bind fails with EADDRINUSE — the async
    // 'error' path that only called scheduler.stop(). boot() passes no
    // hostname to serve(), so it binds the wildcard; the blocker must also bind
    // the wildcard (no hostname) to guarantee the conflict on macOS.
    const blocker = net.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(port, () => resolve());
    });

    try {
      await expect(
        boot({ configDir: tempDir, port, bootstrapWindowMs: 0 }),
      ).rejects.toThrow();
      // init() ran (pool launched), so the boot-failure path MUST shut it down.
      expect(initSpy).toHaveBeenCalled();
      expect(shutdownSpy).toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      initSpy.mockRestore();
      shutdownSpy.mockRestore();
    }
  });

  // R21 bucket-a: SIGHUP reload failure must emit rules.reload.failed
  // on the bus. File-watch-driven reload failures already emit (see
  // rule-loader.ts:540); SIGHUP was asymmetric — it only logged, so
  // operators who used SIGHUP to reload saw no dashboard/alert signal
  // on failure. Fix: sigHup.catch emits the same event with
  // file: "<sighup>" synthetic marker.
  it("R21-a: SIGHUP reload failure emits rules.reload.failed on the bus", async () => {
    // Seed a minimal valid rule (valid cron) so initial boot succeeds.
    const validYaml = [
      "id: sighup-reload-probe",
      'name: "SIGHUP reload probe"',
      'owner: "@test"',
      "signal:",
      "  dimension: aimock_wiring",
      "triggers:",
      "  - cron_only:",
      '      schedule: "0 9 * * 1"',
      "conditions:",
      "  rate_limit: null",
      "targets:",
      "  - kind: slack",
      "    webhook: oss_alerts",
      "template:",
      '  text: "noop"',
      "",
    ].join("\n");
    const rulePath = path.join(tempDir, "sighup-probe.yml");
    await fs.writeFile(rulePath, validYaml, "utf8");

    const booted = await boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    stopFn = booted.stop;

    // Capture all rules.reload.failed emissions so we can assert on the
    // synthetic SIGHUP marker specifically (chokidar may independently
    // pick up the file rewrite at its 100ms debounce and emit under the
    // real file path).
    const emissions: { file: string; error: string }[] = [];
    booted.bus.on("rules.reload.failed", (payload) => {
      for (const e of payload.errors) emissions.push(e);
    });

    // Delete the configDir entirely. loader.load() → loadWithErrors() →
    // fs.readdir(dir) will throw ENOENT, reloadRules rejects, and the
    // sigHup .catch path emits rules.reload.failed. (Rewriting YAML
    // with invalid content wouldn't work: diffCronSchedules already
    // per-rule-catches cron-register errors (orchestrator.ts:487-496)
    // and the parse-error path inside rule-loader returns errors
    // rather than throwing — so neither bubbles out of reloadRules.)
    await fs.rm(tempDir, { recursive: true, force: true });

    // Fire SIGHUP. sigHup handler is synchronous up to the reloadRules
    // promise; the .catch runs on the microtask queue. Pre-fix this just
    // slept 100ms — but on macOS the rule-loader load() chain (loadDefaults
    // readFile ENOENT → fs.readdir ENOENT) settles 2-3s later under load,
    // so the test failed even though the production path was correct.
    // Poll for the synthetic `<sighup>` emission with a 15s ceiling so a
    // genuine regression (no emission ever fires) still surfaces clearly.
    // Empirically the SIGHUP reload chain (loader.load → loadDefaults
    // readFile ENOENT → fs.readdir ENOENT → reloadRules .catch) settles
    // in 2-5s on macOS under test load — well under the ceiling but well
    // over the prior 100ms budget.
    process.emit("SIGHUP");
    const sigHupDeadline = Date.now() + 15_000;
    while (
      !emissions.some((e) => e.file === "<sighup>") &&
      Date.now() < sigHupDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const sigHupEmission = emissions.find((e) => e.file === "<sighup>");
    expect(sigHupEmission).toBeDefined();
    // ENOENT from fs.readdir carries the tmpdir path; just assert the
    // error string is non-empty so the test doesn't over-couple to
    // libuv's exact wording.
    expect(sigHupEmission!.error.length).toBeGreaterThan(0);
  });

  it('/health returns 200 with loop:"ok" and schedulerJobs>=1 when a rule is loaded (happy path)', async () => {
    // E2 happy-path coverage. Pre-fix we only asserted the pathological
    // no-jobs and stopped states; an accidental regression where the
    // cron scheduler silently registered zero jobs despite a valid rule
    // file would pass the existing suite. Here we seed a minimal valid
    // rule YAML, boot the orchestrator, and assert the positive contract
    // /health returns 200 + loop:"ok" + schedulerJobs>=1.
    // Shape matches showcase/harness/config/alerts/version-drift-weekly.yml:
    // a cron_only trigger registers a scheduler entry via
    // diffCronSchedules in orchestrator.ts. We pick a dimension
    // (aimock_wiring) that has no orchestrator-provided invoker in a
    // test tempdir → the handler runs without an invoker, which is
    // exactly what we want: the scheduler entry EXISTS (schedulerJobs
    // >= 1) and /health reports loop:"ok" because jobs > 0 and the
    // scheduler is running.
    const ruleYaml = [
      "id: e2-happy-path-probe",
      'name: "E2 happy-path probe"',
      'owner: "@test"',
      "",
      "signal:",
      "  dimension: aimock_wiring",
      "",
      "triggers:",
      "  - cron_only:",
      '      schedule: "0 9 * * 1"',
      "",
      "conditions:",
      "  rate_limit: null",
      "",
      "targets:",
      "  - kind: slack",
      "    webhook: oss_alerts",
      "",
      "template:",
      '  text: "noop"',
      "",
    ].join("\n");
    await fs.writeFile(
      path.join(tempDir, "e2-happy-path.yml"),
      ruleYaml,
      "utf8",
    );
    const booted = await boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    stopFn = booted.stop;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const body = (await res.json()) as {
      loop: string;
      pb: string;
      schedulerJobs?: number;
    };
    // This test validates the loop-probe wiring (F1.1). The outer HTTP
    // status also folds in `pb.health()`, which is down in CI — so the
    // envelope reports 503 / status:"degraded" even when loop:"ok". The
    // canonical F1.1 contract lives in the `loop` label + schedulerJobs
    // field; pb-up is covered separately by server.test.ts.
    expect(body.loop).toBe("ok");
    expect(body.schedulerJobs).toBeGreaterThanOrEqual(1);
  });
});

/**
 * R25 slot 3 A1: guard the per-rule try/catch in `diffCronSchedules`.
 *
 * Pre-fix, one rule with a typoed cron (validateCron throws synchronously
 * inside scheduler.register) aborted the for-loop → every subsequent rule
 * silently unscheduled. The try/catch was added specifically to keep the
 * iteration going; this test pins that invariant so a refactor that moves
 * the try/catch outside the loop (or drops it entirely) can't regress
 * without a failing test.
 *
 * Strategy: use a stub scheduler that throws for `ruleB` (middle rule) and
 * succeeds for `ruleA` and `ruleC`. Invoke `diffCronSchedules` with all 3
 * rules and assert:
 *   1. scheduler.register was called exactly 3 times (one per rule).
 *   2. ruleA and ruleC were successfully registered.
 *   3. ruleB's failure was logged at error level with its id surfaced.
 *   4. ruleC's registration was NOT skipped — the bug this try/catch
 *      guards is "ruleC never registers because ruleB threw".
 */
describe("orchestrator.diffCronSchedules per-rule isolation (R25-slot3-A1)", () => {
  it("continues registering subsequent rules when one rule's register throws", () => {
    // Build a stub scheduler satisfying only the surface `diffCronSchedules`
    // touches: register / unregister / list. register() throws for ruleB,
    // succeeds for the others — mirroring croner's validateCron throw on a
    // bad expression.
    const registerCalls: Array<{
      id: string;
      cron: string;
    }> = [];
    const registeredIds = new Set<string>();
    const throwingId = "ruleB:cron:0";

    const stubScheduler = {
      register: vi.fn((entry: { id: string; cron: string }) => {
        registerCalls.push({ id: entry.id, cron: entry.cron });
        if (entry.id === throwingId) {
          // Simulate validateCron's behaviour on a bad expression.
          throw new Error(
            `invalid cron for ${entry.id}: ${entry.cron} (croner: bad expression)`,
          );
        }
        registeredIds.add(entry.id);
      }),
      unregister: vi.fn(async () => true),
      hasEntry: (id: string) => registeredIds.has(id),
      list: vi.fn(() => []),
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
      isStarted: () => false,
      isStopped: () => false,
      getJobCount: () => registeredIds.size,
    } as unknown as ReturnType<typeof createScheduler>;

    const bus = createEventBus();
    const resolver: Parameters<typeof diffCronSchedules>[3] = () => null;

    const rules: CompiledRule[] = [
      makeCronRule("ruleA", "0 9 * * 1"),
      makeCronRule("ruleB", "this-is-not-a-valid-cron"),
      makeCronRule("ruleC", "0 10 * * 2"),
    ];

    // MUST NOT throw out of diffCronSchedules — the per-rule try/catch
    // swallows the middle rule's failure.
    expect(() =>
      diffCronSchedules(stubScheduler, rules, bus, resolver),
    ).not.toThrow();

    // 1. register called exactly 3 times — every rule in the iteration
    //    was reached. If ruleB's throw escaped the try/catch, the for-loop
    //    would abort and register would have been called only twice.
    expect(stubScheduler.register).toHaveBeenCalledTimes(3);
    const registeredOrder = registerCalls.map((c) => c.id);
    expect(registeredOrder).toEqual([
      "ruleA:cron:0",
      "ruleB:cron:0",
      "ruleC:cron:0",
    ]);

    // 2. ruleA and ruleC successfully registered (survived the iteration
    //    despite ruleB's middle-of-the-loop throw).
    expect(registeredIds.has("ruleA:cron:0")).toBe(true);
    expect(registeredIds.has("ruleC:cron:0")).toBe(true);
    // ruleB did NOT register (the throw prevented the Set add).
    expect(registeredIds.has("ruleB:cron:0")).toBe(false);
  });

  /**
   * R28 slot #1: when a rule id is in `currentIds` but NOT in `desired`,
   * diffCronSchedules must call `scheduler.unregister(id)` exactly once
   * for that id and leave the other ids alone. R26 covered the
   * register-throws-in-the-middle case; this locks the stale-unregister
   * path so a refactor that drops the unregister loop can't silently
   * regress into "dead cron entries keep firing after their rule is
   * removed".
   */
  it("unregisters stale cron entries and leaves active ones alone", () => {
    // Track what's currently registered; stub scheduler.list() to return
    // entries built from it. unregister() removes from the set and is
    // spied so we can assert on the call sequence.
    const registered = new Map<string, { id: string; cron: string }>();

    const stubScheduler = {
      register: vi.fn((entry: { id: string; cron: string }) => {
        registered.set(entry.id, entry);
      }),
      unregister: vi.fn(async (id: string) => {
        return registered.delete(id);
      }),
      hasEntry: (id: string) => registered.has(id),
      list: vi.fn(() =>
        Array.from(registered.values()).map((e) => ({
          id: e.id,
          cron: e.cron,
          handler: async () => undefined,
        })),
      ),
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
      isStarted: () => false,
      isStopped: () => false,
      getJobCount: () => registered.size,
    } as unknown as ReturnType<typeof createScheduler>;

    const bus = createEventBus();
    const resolver: Parameters<typeof diffCronSchedules>[3] = () => null;

    // First pass: register three rules.
    const firstPass: CompiledRule[] = [
      makeCronRule("ruleA", "0 9 * * 1"),
      makeCronRule("ruleB", "0 10 * * 2"),
      makeCronRule("ruleC", "0 11 * * 3"),
    ];
    diffCronSchedules(stubScheduler, firstPass, bus, resolver);
    expect(registered.size).toBe(3);
    expect(registered.has("ruleA:cron:0")).toBe(true);
    expect(registered.has("ruleB:cron:0")).toBe(true);
    expect(registered.has("ruleC:cron:0")).toBe(true);

    // Clear spies for the second-pass assertions.
    (stubScheduler.unregister as ReturnType<typeof vi.fn>).mockClear();
    (stubScheduler.register as ReturnType<typeof vi.fn>).mockClear();

    // Second pass: drop ruleB. diffCronSchedules must call
    // scheduler.unregister("ruleB:cron:0") exactly once and NOT touch
    // ruleA or ruleC.
    const secondPass: CompiledRule[] = [
      makeCronRule("ruleA", "0 9 * * 1"),
      makeCronRule("ruleC", "0 11 * * 3"),
    ];
    diffCronSchedules(stubScheduler, secondPass, bus, resolver);

    const unregisterCalls = (
      stubScheduler.unregister as ReturnType<typeof vi.fn>
    ).mock.calls.map((args) => args[0]);
    expect(unregisterCalls).toEqual(["ruleB:cron:0"]);
    // ruleA and ruleC must NOT have been unregistered.
    expect(unregisterCalls).not.toContain("ruleA:cron:0");
    expect(unregisterCalls).not.toContain("ruleC:cron:0");
    // And nothing spurious beyond the single drop.
    expect(stubScheduler.unregister).toHaveBeenCalledTimes(1);
  });

  /**
   * R28 slot #2: when a cron handler's invoker throws, the handler MUST
   * still emit `rule.scheduled` on the bus (with `result: undefined`) so
   * downstream alert-engine logic can synthesize a sentinel outcome.
   * Pre-fix a probe-failure swallowed the tick entirely — the rule
   * would silently stop firing. The try/catch in diffCronSchedules'
   * inner handler keeps the emit on the happy path.
   */
  it("cron handler emits rule.scheduled with result=undefined when invoker throws", async () => {
    let handlerRef: ((...args: unknown[]) => Promise<void> | void) | undefined;
    const stubScheduler = {
      register: vi.fn(
        (entry: {
          id: string;
          cron: string;
          handler: (...args: unknown[]) => Promise<void> | void;
        }) => {
          handlerRef = entry.handler;
        },
      ),
      unregister: vi.fn(async () => true),
      hasEntry: () => false,
      list: vi.fn(() => []),
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
      isStarted: () => false,
      isStopped: () => false,
      getJobCount: () => 0,
    } as unknown as ReturnType<typeof createScheduler>;

    const bus = createEventBus();
    const emissions: Array<{
      ruleId: string;
      scheduledAt: string;
      result: unknown;
    }> = [];
    bus.on("rule.scheduled", (p) =>
      emissions.push({
        ruleId: p.ruleId,
        scheduledAt: p.scheduledAt,
        result: p.result,
      }),
    );

    // Resolver returns an invoker that throws — simulates a probe bug.
    const resolver: Parameters<typeof diffCronSchedules>[3] =
      () => async () => {
        throw new Error("probe boom");
      };

    diffCronSchedules(
      stubScheduler,
      [makeCronRule("probe-fail", "0 9 * * 1")],
      bus,
      resolver,
    );

    // The register call captured the handler; invoke it directly to
    // simulate a cron tick.
    expect(handlerRef).toBeDefined();
    await handlerRef!();

    // Exactly one rule.scheduled emission with result: undefined.
    expect(emissions).toHaveLength(1);
    expect(emissions[0]!.ruleId).toBe("probe-fail");
    expect(emissions[0]!.result).toBeUndefined();
    // scheduledAt is a stringified ISO date — just assert non-empty.
    expect(emissions[0]!.scheduledAt.length).toBeGreaterThan(0);
  });
});

/**
 * R28 slot #3: buildCronProbeResolver must return null for
 * `aimock_wiring` unless ALL FOUR of RAILWAY_TOKEN, RAILWAY_PROJECT_ID,
 * RAILWAY_ENVIRONMENT_ID, AIMOCK_URL are set. Table-driven so each
 * partial-configuration branch has explicit coverage.
 */
describe("orchestrator.buildCronProbeResolver env-branch predicate (R28-slot3-#3)", () => {
  const allVars = {
    RAILWAY_TOKEN: "tok",
    RAILWAY_PROJECT_ID: "proj",
    RAILWAY_ENVIRONMENT_ID: "env",
    AIMOCK_URL: "https://aimock.test",
  } as const;

  it("returns null for aimock_wiring when ALL four vars are missing", () => {
    const resolver = buildCronProbeResolver({});
    expect(resolver("aimock_wiring")).toBeNull();
  });

  it.each(
    (Object.keys(allVars) as Array<keyof typeof allVars>).map((missing) => [
      missing,
    ]),
  )(
    "returns null for aimock_wiring when %s is missing (3 of 4 doesn't enable)",
    (missing) => {
      const partial: Record<string, string | undefined> = { ...allVars };
      delete partial[missing];
      const resolver = buildCronProbeResolver(partial);
      expect(resolver("aimock_wiring")).toBeNull();
    },
  );

  it("returns a non-null invoker for aimock_wiring when ALL four vars are present", () => {
    const resolver = buildCronProbeResolver(allVars);
    const invoker = resolver("aimock_wiring");
    expect(invoker).not.toBeNull();
    expect(typeof invoker).toBe("function");
  });

  it("returns null for any non-aimock_wiring dimension (e.g. pin_drift) regardless of env", () => {
    const resolver = buildCronProbeResolver(allVars);
    expect(resolver("pin_drift")).toBeNull();
    expect(resolver("version_drift")).toBeNull();
    expect(resolver("redirect_decommission")).toBeNull();
  });
});

/**
 * R28 slot #4: createStatusReader must reject keys containing control
 * characters (\n, \t, C0/C1) BEFORE reaching PB's filter parser. Pre-fix,
 * today's probes only emitted printable-ASCII keys — but a future probe
 * with a control-char in `result.key` would throw at PB's filter-parse
 * time, get swallowed by dispatchCronAlert's wrapper, and silently kill
 * the rule. assertSafeKey fails loud with an explicit "unsafe key"
 * message before any PB call.
 */
describe("orchestrator.createStatusReader key safety (R28-slot1-A10)", () => {
  it("throws on a key containing a newline before reaching PB", async () => {
    const getFirst = vi.fn(
      async (_collection: string, _filter: string) => null,
    );
    const reader = createStatusReader({
      getFirst: getFirst as unknown as <T>(
        collection: string,
        filter: string,
      ) => Promise<T | null>,
    });
    await expect(
      reader.getStateByKey("smoke:langchain\nattacker=1"),
    ).rejects.toThrow(/printable Unicode|no control chars|key/i);
    // PB layer must NOT have been reached — the assertion is pre-filter.
    expect(getFirst).not.toHaveBeenCalled();
  });

  it("throws on a key containing a C0 control char before reaching PB", async () => {
    const getFirst = vi.fn(
      async (_collection: string, _filter: string) => null,
    );
    const reader = createStatusReader({
      getFirst: getFirst as unknown as <T>(
        collection: string,
        filter: string,
      ) => Promise<T | null>,
    });
    //  (BEL) is a C0 control char — printable-Unicode regex rejects.
    await expect(reader.getStateByKey("smoke:belevil")).rejects.toThrow(
      /printable Unicode|no control chars|key/i,
    );
    expect(getFirst).not.toHaveBeenCalled();
  });

  it("accepts a normal printable-ASCII key and passes through to PB", async () => {
    const getFirst = vi.fn(
      async (_collection: string, _filter: string) => null,
    );
    const reader = createStatusReader({
      getFirst: getFirst as unknown as <T>(
        collection: string,
        filter: string,
      ) => Promise<T | null>,
    });
    await reader.getStateByKey("smoke:langchain");
    expect(getFirst).toHaveBeenCalledTimes(1);
    expect(getFirst.mock.calls[0]![0]).toBe("status");
    // Filter string quotes the key via JSON.stringify.
    expect(getFirst.mock.calls[0]![1]).toBe(`key = "smoke:langchain"`);
  });

  it("degrades a corrupt durable state read-back to null instead of echoing it (A6(viii) round 7)", async () => {
    // Red-green (round-7 A6viii): the reader returned `row?.state ?? null`
    // RAW — a corrupt/legacy PB value (anything outside green|red|degraded)
    // flowed into dispatchCronAlert's synthesized WriteOutcome as a bogus
    // prior state. Same degrade-don't-trust posture as every other PB
    // state read (asKnownState).
    const getFirst = vi.fn(async (_c: string, _f: string) => ({
      id: "r1",
      key: "smoke:langchain",
      state: "blue", // corrupt PB value
    }));
    const reader = createStatusReader({
      getFirst: getFirst as unknown as <T>(
        collection: string,
        filter: string,
      ) => Promise<T | null>,
    });
    await expect(reader.getStateByKey("smoke:langchain")).resolves.toBeNull();
    // A valid value still passes through.
    getFirst.mockResolvedValueOnce({
      id: "r1",
      key: "smoke:langchain",
      state: "red",
    });
    await expect(reader.getStateByKey("smoke:langchain")).resolves.toBe("red");
  });
});

/**
 * CR-FIX #6: createBrowserPoolHealthSignals must (a) log a prior-state READ
 * failure at warn instead of silently coercing it to null (which misreports a
 * recovery as a cold boot), and (b) SERIALIZE the degraded↔healthy writes with
 * monotonic observedAt so a flap converges to the correct final persisted
 * state.
 */
describe("orchestrator.createBrowserPoolHealthSignals (CR-FIX #6)", () => {
  interface CapturedWrite {
    state: State;
    signal: Record<string, unknown>;
    observedAt: string;
  }

  function makeHarness(opts?: {
    priorState?: State | null;
    readThrows?: boolean;
  }) {
    const writes: CapturedWrite[] = [];
    const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const writer = {
      write: vi.fn(async (result: CapturedWrite & { key: string }) => {
        writes.push({
          state: result.state,
          signal: result.signal,
          observedAt: result.observedAt,
        });
        return {};
      }),
    };
    const statusReader = {
      getStateByKey: vi.fn(async (key: string): Promise<State | null> => {
        if (opts?.readThrows) throw new Error("PB read boom");
        // `priorState` models the DEGRADED key only; the unrecoverable key
        // is never-written (null) in these fixtures — its recovery leg has
        // dedicated A2 (round 6) tests below.
        if (key !== BROWSER_POOL_DEGRADED_KEY) return null;
        return opts?.priorState ?? null;
      }),
    };
    const testLogger = {
      warn: (msg: string, meta?: Record<string, unknown>) =>
        warns.push({ msg, meta }),
    };
    return { writes, warns, writer, statusReader, testLogger };
  }

  it("logs (does not swallow) a prior-state read failure and still reports a transition", async () => {
    const { writes, warns, writer, statusReader, testLogger } = makeHarness({
      readThrows: true,
    });
    const { writeHealthy } = createBrowserPoolHealthSignals({
      writer,
      statusReader,
      logger: testLogger,
    });

    await writeHealthy();

    // The read failure was LOGGED at warn (not silently swallowed).
    expect(
      warns.some((w) => w.msg === "boot.browser-pool-prior-state-read-failed"),
    ).toBe(true);
    // A green write still landed (best-effort) under the read failure.
    expect(writes.length).toBe(1);
    expect(writes[0]!.state).toBe("green");
  });

  it("stamps `recovered` when the prior persisted state was red", async () => {
    const { writes, writer, statusReader, testLogger } = makeHarness({
      priorState: "red",
    });
    const { writeHealthy } = createBrowserPoolHealthSignals({
      writer,
      statusReader,
      logger: testLogger,
    });
    await writeHealthy();
    expect(writes[0]!.state).toBe("green");
    expect(writes[0]!.signal.recovered).toBe(true);
  });

  it("serializes a rapid degraded→healthy→degraded flap to the correct final persisted state with monotonic observedAt", async () => {
    const { writes, writer, statusReader, testLogger } = makeHarness({
      priorState: "red",
    });
    const { writeDegraded, writeHealthy } = createBrowserPoolHealthSignals({
      writer,
      statusReader,
      logger: testLogger,
    });

    // Fire three transitions back-to-back WITHOUT awaiting in between (the
    // fire-and-forget flap the unfixed `void write...()` hooks produced). The
    // serialization chain must apply them IN ORDER so the last one wins.
    const p1 = writeDegraded("first red");
    const p2 = writeHealthy();
    const p3 = writeDegraded("second red");
    await Promise.all([p1, p2, p3]);

    // All three writes landed in call order: red, green, red.
    expect(writes.map((w) => w.state)).toEqual(["red", "green", "red"]);
    // The persisted FINAL state is the last transition (red).
    expect(writes[writes.length - 1]!.state).toBe("red");
    // observedAt is strictly increasing so a coarse clock can never let an
    // earlier write appear "newer" than a later one.
    const stamps = writes.map((w) => Date.parse(w.observedAt));
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]!).toBeGreaterThan(stamps[i - 1]!);
    }
    // Sanity: the key written is the shared degraded key.
    expect(
      writer.write.mock.calls.every(
        (c) => c[0].key === BROWSER_POOL_DEGRADED_KEY,
      ),
    ).toBe(true);
  });

  // A2 (round 6): BROWSER_POOL_UNRECOVERABLE_KEY was write-only red —
  // writeUnrecoverable painted it red but writeHealthy only greened the
  // DEGRADED key, so after the redeploy the terminal alarm demands, the
  // unrecoverable row stayed red forever.
  it("greens the unrecoverable key on writeHealthy when its prior state is red (A2 round 6)", async () => {
    const writes: Array<CapturedWrite & { key: string }> = [];
    const writer = {
      write: vi.fn(async (result: CapturedWrite & { key: string }) => {
        writes.push(result);
        return {};
      }),
    };
    // Post-redeploy shape: BOTH keys persisted red by writeUnrecoverable.
    const statusReader = {
      getStateByKey: vi.fn(async (_key: string): Promise<State | null> => {
        return "red";
      }),
    };
    const { writeHealthy } = createBrowserPoolHealthSignals({
      writer,
      statusReader,
      logger: { warn: () => {} },
    });
    await writeHealthy();
    const unrecoverable = writes.filter(
      (w) => w.key === BROWSER_POOL_UNRECOVERABLE_KEY,
    );
    expect(unrecoverable).toHaveLength(1);
    expect(unrecoverable[0]!.state).toBe("green");
    expect(unrecoverable[0]!.signal.recovered).toBe(true);
    // The shared degraded key still greens as before.
    const degraded = writes.filter((w) => w.key === BROWSER_POOL_DEGRADED_KEY);
    expect(degraded).toHaveLength(1);
    expect(degraded[0]!.state).toBe("green");
  });

  it("does NOT seed a never-written unrecoverable key on writeHealthy (A2 round 6 — F2.1 discipline)", async () => {
    const writes: Array<CapturedWrite & { key: string }> = [];
    const writer = {
      write: vi.fn(async (result: CapturedWrite & { key: string }) => {
        writes.push(result);
        return {};
      }),
    };
    // Cold boot: neither key has ever been written (prior state null).
    const statusReader = {
      getStateByKey: vi.fn(async (): Promise<State | null> => null),
    };
    const { writeHealthy } = createBrowserPoolHealthSignals({
      writer,
      statusReader,
      logger: { warn: () => {} },
    });
    await writeHealthy();
    // The degraded key greens (cold-boot healthy stamp, as before)…
    expect(writes.some((w) => w.key === BROWSER_POOL_DEGRADED_KEY)).toBe(true);
    // …but the never-written unrecoverable key is NOT seeded.
    expect(writes.some((w) => w.key === BROWSER_POOL_UNRECOVERABLE_KEY)).toBe(
      false,
    );
  });

  it("does NOT green the unrecoverable key when its prior state is already green (A2 round 6)", async () => {
    const writes: Array<CapturedWrite & { key: string }> = [];
    const writer = {
      write: vi.fn(async (result: CapturedWrite & { key: string }) => {
        writes.push(result);
        return {};
      }),
    };
    const statusReader = {
      getStateByKey: vi.fn(async (key: string): Promise<State | null> => {
        return key === BROWSER_POOL_UNRECOVERABLE_KEY ? "green" : "red";
      }),
    };
    const { writeHealthy } = createBrowserPoolHealthSignals({
      writer,
      statusReader,
      logger: { warn: () => {} },
    });
    await writeHealthy();
    expect(writes.some((w) => w.key === BROWSER_POOL_UNRECOVERABLE_KEY)).toBe(
      false,
    );
  });
});

/**
 * Headline-fix coverage: `writeUnrecoverable` is the production wiring for the
 * self-heal circuit-breaker's TERMINAL give-up. The breaker mechanism existed in
 * the PR but the alarm was a production NO-OP (the pool's onUnrecoverable hook
 * was never wired). These tests pin: (1) an UNCONDITIONAL distinct terminal
 * health-signal write (+ escalation of the shared degraded key to
 * critical/terminal) so a give-up is distinguishable from a transient degraded,
 * and (2) a BEST-EFFORT, env-GUARDED Slack ping that is SKIPPED when the webhook
 * URL is unset (alerting discipline) yet never blocks the health-signal write.
 */
describe("orchestrator.createBrowserPoolHealthSignals — writeUnrecoverable (terminal alarm)", () => {
  interface KeyedWrite {
    key: string;
    state: State;
    signal: Record<string, unknown>;
    observedAt: string;
  }
  function makeHarness() {
    const writes: KeyedWrite[] = [];
    const logs: Array<{
      level: string;
      msg: string;
      meta?: Record<string, unknown>;
    }> = [];
    const writer = {
      write: vi.fn(async (result: KeyedWrite) => {
        writes.push(result);
        return {};
      }),
    };
    const statusReader = {
      getStateByKey: vi.fn(async (): Promise<State | null> => null),
    };
    const testLogger = {
      warn: (msg: string, meta?: Record<string, unknown>) =>
        logs.push({ level: "warn", msg, meta }),
      error: (msg: string, meta?: Record<string, unknown>) =>
        logs.push({ level: "error", msg, meta }),
      info: (msg: string, meta?: Record<string, unknown>) =>
        logs.push({ level: "info", msg, meta }),
    };
    return { writes, logs, writer, statusReader, testLogger };
  }
  const counters = { browserCount: 3, waiters: 7, maxHardRecoveries: 3 };

  it("writes a DISTINCT terminal health signal AND escalates the degraded key to critical/terminal", async () => {
    const { writes, logs, writer, statusReader, testLogger } = makeHarness();
    const fetchImpl = vi.fn();
    const { writeUnrecoverable } = createBrowserPoolHealthSignals({
      writer,
      statusReader,
      logger: testLogger,
      env: {}, // webhook UNSET
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await writeUnrecoverable(counters);

    // (1a) The distinct terminal key was written, red + terminal + critical +
    //      redeployRequired, carrying the breaker counters.
    const terminal = writes.find(
      (w) => w.key === BROWSER_POOL_UNRECOVERABLE_KEY,
    );
    expect(terminal).toBeDefined();
    expect(terminal!.state).toBe("red");
    expect(terminal!.signal.terminal).toBe(true);
    expect(terminal!.signal.severity).toBe("critical");
    expect(terminal!.signal.redeployRequired).toBe(true);
    expect(terminal!.signal.browserCount).toBe(3);
    expect(terminal!.signal.waiters).toBe(7);

    // (1b) The shared degraded key was ALSO escalated so a consumer keying off
    //      it alone still sees the critical/terminal state.
    const degraded = writes.find((w) => w.key === BROWSER_POOL_DEGRADED_KEY);
    expect(degraded).toBeDefined();
    expect(degraded!.state).toBe("red");
    expect(degraded!.signal.severity).toBe("critical");
    expect(degraded!.signal.terminal).toBe(true);

    // (2) Slack was SKIPPED (URL unset) — logged, not attempted.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      logs.some(
        (l) => l.msg === "boot.browser-pool-unrecoverable-slack-skipped",
      ),
    ).toBe(true);
  });

  it("posts a best-effort Slack alert when the webhook URL IS set", async () => {
    const { writes, writer, statusReader, testLogger } = makeHarness();
    const fetchImpl = vi.fn(async (_url: string, _init: { body: string }) => ({
      ok: true,
      status: 200,
    }));
    const { writeUnrecoverable } = createBrowserPoolHealthSignals({
      writer,
      statusReader,
      logger: testLogger,
      env: { [BROWSER_POOL_ALERT_WEBHOOK_ENV]: "https://hooks.example/abc" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await writeUnrecoverable(counters);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://hooks.example/abc");
    const body = JSON.parse(init.body) as {
      text: string;
    };
    expect(body.text).toContain("UNRECOVERABLE");
    expect(body.text).toContain("REDEPLOY");
    // The health-signal writes still happened (Slack is additive).
    expect(writes.some((w) => w.key === BROWSER_POOL_UNRECOVERABLE_KEY)).toBe(
      true,
    );
  });

  it("NAMES the cgroup pids signal in the Slack/alarm message when pids are present (>=0)", async () => {
    // slot-6 F1: when the give-up snapshot measured the cgroup PID ceiling
    // (cgroupPidsCurrent >= 0), the alarm must NAME it — pids.current/pids.max +
    // threads — so the operator sees the PROVEN wedge cause, not just the
    // abstract breaker counters. Off-Linux (-1 sentinel) the clause is omitted.
    const { writes, writer, statusReader, testLogger } = makeHarness();
    const fetchImpl = vi.fn(async (_url: string, _init: { body: string }) => ({
      ok: true,
      status: 200,
    }));
    const { writeUnrecoverable } = createBrowserPoolHealthSignals({
      writer,
      statusReader,
      logger: testLogger,
      env: { [BROWSER_POOL_ALERT_WEBHOOK_ENV]: "https://hooks.example/abc" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await writeUnrecoverable({
      ...counters,
      cgroupPidsCurrent: 998,
      cgroupPidsMax: 1000,
      treeThreadCount: 950,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(init.body) as { text: string };
    expect(body.text).toContain("pids.current=998/pids.max=1000");
    expect(body.text).toContain("threads=950");
    // The headline gauges are also persisted on the terminal health signal.
    const terminal = writes.find(
      (w) => w.key === BROWSER_POOL_UNRECOVERABLE_KEY,
    );
    expect(terminal!.signal.cgroupPidsCurrent).toBe(998);
    expect(terminal!.signal.cgroupPidsMax).toBe(1000);
    expect(terminal!.signal.treeThreadCount).toBe(950);
  });

  it("OMITS the pids clause when pids are unavailable (-1 sentinel, off-Linux)", async () => {
    const { writer, statusReader, testLogger } = makeHarness();
    const fetchImpl = vi.fn(async (_url: string, _init: { body: string }) => ({
      ok: true,
      status: 200,
    }));
    const { writeUnrecoverable } = createBrowserPoolHealthSignals({
      writer,
      statusReader,
      logger: testLogger,
      env: { [BROWSER_POOL_ALERT_WEBHOOK_ENV]: "https://hooks.example/abc" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await writeUnrecoverable({
      ...counters,
      cgroupPidsCurrent: -1,
      cgroupPidsMax: -1,
      treeThreadCount: -1,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(init.body) as { text: string };
    expect(body.text).not.toContain("pids.current");
  });

  it("a failing Slack post never prevents the (unconditional) health-signal write", async () => {
    const { writes, writer, statusReader, testLogger } = makeHarness();
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const { writeUnrecoverable } = createBrowserPoolHealthSignals({
      writer,
      statusReader,
      logger: testLogger,
      env: { [BROWSER_POOL_ALERT_WEBHOOK_ENV]: "https://hooks.example/abc" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(writeUnrecoverable(counters)).resolves.toBeUndefined();
    // The health signals landed despite the Slack failure.
    expect(writes.some((w) => w.key === BROWSER_POOL_UNRECOVERABLE_KEY)).toBe(
      true,
    );
    expect(writes.some((w) => w.key === BROWSER_POOL_DEGRADED_KEY)).toBe(true);
  });

  it("a HUNG Slack webhook is ABORTED at the timeout so the serialized health-signal chain is not stalled", async () => {
    // A hung webhook fetch must not stall the SERIALIZED degraded↔healthy↔
    // unrecoverable write chain indefinitely: the ping is aborted at
    // BROWSER_POOL_SLACK_TIMEOUT_MS, logged best-effort, and the write resolves.
    vi.useFakeTimers();
    try {
      const { writes, logs, writer, statusReader, testLogger } = makeHarness();
      // fetch hangs until its AbortSignal fires, then rejects like a real abort.
      const fetchImpl = vi.fn(
        (_url: string, init: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(
                Object.assign(new Error("The operation was aborted"), {
                  name: "AbortError",
                }),
              ),
            );
          }),
      );
      const { writeUnrecoverable } = createBrowserPoolHealthSignals({
        writer,
        statusReader,
        logger: testLogger,
        env: { [BROWSER_POOL_ALERT_WEBHOOK_ENV]: "https://hooks.example/abc" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const done = writeUnrecoverable(counters);
      // Advance past the Slack timeout — the abort fires and the ping rejects.
      await vi.advanceTimersByTimeAsync(5_000);
      // The chain resolves (not stalled) within the bound.
      await expect(done).resolves.toBeUndefined();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      // The hung ping was aborted + logged best-effort.
      expect(
        logs.some(
          (l) => l.msg === "boot.browser-pool-unrecoverable-slack-failed",
        ),
      ).toBe(true);
      // The (unconditional) health-signal writes still landed.
      expect(writes.some((w) => w.key === BROWSER_POOL_UNRECOVERABLE_KEY)).toBe(
        true,
      );
      expect(writes.some((w) => w.key === BROWSER_POOL_DEGRADED_KEY)).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * R28 slot #5: when `S3_BACKUP_BUCKET` is set but the S3 uploader
 * factory throws at boot (missing @aws-sdk/client-s3, bad region,
 * credential provider throws), the orchestrator must log at error
 * level AND emit `internal.backup.init-failed` on the bus. Pre-fix
 * the failure only logged; the service booted green and backups
 * silently never ran. This test pins the bus-emit contract so a
 * refactor that drops the emit can't regress the observable surface.
 */
describe("orchestrator S3 backup init failure (R28-slot2-A1)", () => {
  let tempDir: string;
  let port = 0;
  let stopFn: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-orch-s3-"));
    port = await pickPort();
  });

  afterEach(async () => {
    if (stopFn) {
      await stopFn();
      stopFn = null;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.S3_BACKUP_BUCKET;
  });

  it("emits internal.backup.init-failed synchronously during boot (observed via pre-hooked bus)", async () => {
    // This test uses a module-mock hook to intercept the bus BEFORE
    // boot emits the init-failed event.
    vi.resetModules();

    const emissions: Array<{
      event: string;
      payload: { err?: string; bucket?: string };
    }> = [];

    vi.doMock("./storage/s3-backup.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/s3-backup.js")
      >("./storage/s3-backup.js");
      return {
        ...actual,
        createDefaultS3Uploader: vi.fn(async () => {
          throw new Error("simulated: @aws-sdk/client-s3 missing");
        }),
      };
    });

    // Wrap createEventBus so every emit is captured. The orchestrator
    // imports createEventBus from ./events/event-bus.js — we intercept
    // there.
    vi.doMock("./events/event-bus.js", async () => {
      const actual = await vi.importActual<
        typeof import("./events/event-bus.js")
      >("./events/event-bus.js");
      return {
        ...actual,
        createEventBus: () => {
          const real = actual.createEventBus();
          return {
            ...real,
            emit: (event: string, payload: unknown) => {
              emissions.push({
                event,
                payload: payload as { err?: string; bucket?: string },
              });
              (real.emit as (e: string, p: unknown) => void)(event, payload);
            },
          };
        },
      };
    });

    const orchMod = await import("./orchestrator.js");
    process.env.S3_BACKUP_BUCKET = "test-bucket-init-fail";

    const booted = await orchMod.boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    stopFn = booted.stop;

    // Exactly one internal.backup.init-failed emission with bucket + err.
    const initFailed = emissions.filter(
      (e) => e.event === "internal.backup.init-failed",
    );
    expect(initFailed).toHaveLength(1);
    expect(initFailed[0]!.payload.bucket).toBe("test-bucket-init-fail");
    expect(initFailed[0]!.payload.err).toMatch(
      /@aws-sdk\/client-s3 missing|simulated/i,
    );
  });
});

/**
 * R5-G4 D1: e2e-demos cfg.timeout_ms must thread per-cfg into the driver's
 * env WITHOUT mutating process.env. Pre-fix, diffProbeSchedules wrote
 * `process.env.E2E_DEMOS_TIMEOUT_MS = String(cfg.timeout_ms)` directly,
 * which:
 *   1. Stayed set across YAML reloads when the cfg removed timeout_ms,
 *      leaking the previous value into every subsequent probe tick.
 *   2. Last-write-wins silently if multiple e2e_demos configs existed.
 *   3. Broke test isolation by mutating shared global state from a diff
 *      function.
 *
 * The fix: a pure `envForCfg(cfg, baseEnv)` projects the per-cfg overlay
 * into a fresh Readonly map; the invoker's `env` is built from this and
 * never escapes into `process.env`.
 */
describe("orchestrator.envForCfg per-cfg env overlay (R5-G4 D1)", () => {
  function e2eDemosCfg(id: string, timeout_ms?: number): ProbeConfig {
    const base = {
      kind: "e2e_demos" as const,
      id,
      schedule: "0 * * * *",
      max_concurrency: 1,
      target: { key: `e2e_demos:${id}` },
    };
    return (
      timeout_ms !== undefined ? { ...base, timeout_ms } : base
    ) as ProbeConfig;
  }

  function pinDriftCfg(id: string, timeout_ms?: number): ProbeConfig {
    const base = {
      kind: "pin_drift" as const,
      id,
      schedule: "0 * * * *",
      max_concurrency: 1,
      target: { key: `pin_drift:${id}` },
    };
    return (
      timeout_ms !== undefined ? { ...base, timeout_ms } : base
    ) as ProbeConfig;
  }

  it("does NOT mutate process.env when cfg has timeout_ms (test isolation)", () => {
    const before = process.env.E2E_DEMOS_TIMEOUT_MS;
    delete process.env.E2E_DEMOS_TIMEOUT_MS;
    try {
      const cfg = e2eDemosCfg("e2e-demos", 600_000);
      const overlay = envForCfg(cfg, { ...process.env });
      expect(overlay.E2E_DEMOS_TIMEOUT_MS).toBe("600000");
      // Critical invariant: process.env was NOT touched. Pre-fix this
      // assertion would fail because diffProbeSchedules mutated the
      // global directly.
      expect(process.env.E2E_DEMOS_TIMEOUT_MS).toBeUndefined();
    } finally {
      if (before !== undefined) process.env.E2E_DEMOS_TIMEOUT_MS = before;
    }
  });

  it("returns distinct overlays per cfg so two e2e_demos configs each see their own value", () => {
    const cfgA = e2eDemosCfg("demos-a", 300_000);
    const cfgB = e2eDemosCfg("demos-b", 1_200_000);
    const baseEnv = { OTHER: "preserved" } as const;
    const overlayA = envForCfg(cfgA, baseEnv);
    const overlayB = envForCfg(cfgB, baseEnv);
    expect(overlayA.E2E_DEMOS_TIMEOUT_MS).toBe("300000");
    expect(overlayB.E2E_DEMOS_TIMEOUT_MS).toBe("1200000");
    // Base env passes through untouched in both overlays.
    expect(overlayA.OTHER).toBe("preserved");
    expect(overlayB.OTHER).toBe("preserved");
  });

  it("does NOT carry over a previous timeout when cfg has no timeout_ms", () => {
    // Reload that DROPS timeout_ms must NOT see a stale value. Pre-fix
    // this would still expose 600_000 because process.env.E2E_DEMOS_TIMEOUT_MS
    // stayed set from the previous reload.
    const baseEnv = { E2E_DEMOS_TIMEOUT_MS: "600000" } as const;
    const cfg = e2eDemosCfg("e2e-demos");
    const overlay = envForCfg(cfg, baseEnv);
    // The overlay leaves baseEnv alone — it's the orchestrator's job
    // to ensure baseEnv at this point doesn't have the stale value.
    // Specifically: the orchestrator passes a snapshot of process.env
    // (without prior probe mutations) so a reload that drops timeout_ms
    // produces an overlay that does NOT inject E2E_DEMOS_TIMEOUT_MS.
    expect("E2E_DEMOS_TIMEOUT_MS" in overlay).toBe(true);
    // Same as base — we didn't INJECT a fresh one.
    expect(overlay.E2E_DEMOS_TIMEOUT_MS).toBe("600000");
    // Now the canonical case: baseEnv WITHOUT the var (the orchestrator's
    // process.env snapshot taken AFTER the global mutation was eliminated).
    const cleanBase = {} as const;
    const cleanOverlay = envForCfg(cfg, cleanBase);
    expect(cleanOverlay.E2E_DEMOS_TIMEOUT_MS).toBeUndefined();
  });

  it("ignores timeout_ms for non-e2e_demos kinds", () => {
    const cfg = pinDriftCfg("pin-drift", 600_000);
    const overlay = envForCfg(cfg, {});
    // pin_drift's timeout_ms is the invoker outer race, NOT a driver-internal
    // env knob — overlay must NOT inject E2E_DEMOS_TIMEOUT_MS.
    expect(overlay.E2E_DEMOS_TIMEOUT_MS).toBeUndefined();
  });
});

/**
 * R5-G4 D2/D3: createRailwayAdapter must use the shared `makeGql` helper
 * so error taxonomy (Auth / Backend / Schema / Transport classes) and
 * partial-success envelope handling stay aligned with the discovery
 * source. Pre-fix the orchestrator's inline gql diverged on two axes:
 *   - non-JSON response bodies (HTML edge-proxy 5xx pages) surfaced as
 *     raw `SyntaxError` from `res.json()` instead of a schema-class
 *     classification.
 *   - any non-empty `errors[]` threw even when `data` was present,
 *     where makeGql instead returns the partial data and logs the
 *     errors.
 */
describe("createRailwayAdapter via shared makeGql (R5-G4 D2/D3)", () => {
  it("classifies non-JSON response bodies as a schema-class error (D3)", async () => {
    const fetchImpl = (async () =>
      new Response("<html>503 Bad Gateway</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })) as unknown as typeof fetch;
    const adapter = createRailwayAdapter(
      {
        token: "tok",
        projectId: "proj",
        environmentId: "env",
      },
      { fetchImpl },
    );
    // makeGql throws DiscoverySourceSchemaError with a clear "response
    // body was not JSON" message — the inline gql would throw a raw
    // `SyntaxError: Unexpected token` from res.json().
    await expect(adapter.listServices()).rejects.toThrow(
      /response body was not JSON|JSON|Schema/i,
    );
  });

  it("surfaces 401 as an auth-class error (D2 taxonomy alignment)", async () => {
    const fetchImpl = (async () =>
      new Response("unauthorized", {
        status: 401,
      })) as unknown as typeof fetch;
    const adapter = createRailwayAdapter(
      {
        token: "tok",
        projectId: "proj",
        environmentId: "env",
      },
      { fetchImpl },
    );
    await expect(adapter.listServices()).rejects.toThrow(/401|auth/i);
  });
});

/**
 * R5-G4 D5: webhook secrets must be configured in production. Pre-fix,
 * if both SHARED_SECRET and SHARED_SECRET_PREV were unset/empty,
 * webhookSecrets resolved to `[]` and webhook auth was silently
 * disabled — anyone could POST a deploy.result. Mirror the
 * POCKETBASE_URL fail-loud pattern: throw FATAL-CONFIG in prod, log
 * info in dev/test.
 */
describe("orchestrator webhook secrets fail-loud in production (R5-G4 D5)", () => {
  let tempDir: string;
  let port = 0;
  let stopFn: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-orch-secrets-"));
    port = await pickPort();
  });

  afterEach(async () => {
    if (stopFn) {
      await stopFn();
      stopFn = null;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("throws FATAL-CONFIG when NODE_ENV=production and both webhook secrets are unset", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSecret = process.env.SHARED_SECRET;
    const prevPrev = process.env.SHARED_SECRET_PREV;
    // Save/restore POCKETBASE_URL like the HF13-A2 tests — an unconditional
    // `delete` in finally would clobber a pre-existing value for later tests.
    const prevPbUrl = process.env.POCKETBASE_URL;
    process.env.NODE_ENV = "production";
    delete process.env.SHARED_SECRET;
    delete process.env.SHARED_SECRET_PREV;
    // POCKETBASE_URL must be set so the prior FATAL-CONFIG throw
    // doesn't pre-empt the SHARED_SECRET check.
    process.env.POCKETBASE_URL = "http://localhost:8090";
    try {
      await expect(
        boot({ configDir: tempDir, port, bootstrapWindowMs: 0 }),
        // B2 fix tightened the predicate (now fails loud in any deployable
        // mode, not just NODE_ENV='production') — the error message changed
        // accordingly. Match the message common to both the old and new
        // throws: FATAL-CONFIG + SHARED_SECRET.
      ).rejects.toThrow(/FATAL-CONFIG.*SHARED_SECRET/);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevSecret !== undefined) process.env.SHARED_SECRET = prevSecret;
      if (prevPrev !== undefined) process.env.SHARED_SECRET_PREV = prevPrev;
      if (prevPbUrl === undefined) delete process.env.POCKETBASE_URL;
      else process.env.POCKETBASE_URL = prevPbUrl;
    }
  });

  it("boots successfully without webhook secrets when NODE_ENV is not production", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSecret = process.env.SHARED_SECRET;
    const prevPrev = process.env.SHARED_SECRET_PREV;
    process.env.NODE_ENV = "test";
    delete process.env.SHARED_SECRET;
    delete process.env.SHARED_SECRET_PREV;
    try {
      const booted = await boot({
        configDir: tempDir,
        port,
        bootstrapWindowMs: 0,
      });
      stopFn = booted.stop;
      expect(booted.port).toBe(port);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevSecret !== undefined) process.env.SHARED_SECRET = prevSecret;
      if (prevPrev !== undefined) process.env.SHARED_SECRET_PREV = prevPrev;
    }
  });

  it("boots successfully in production when at least one webhook secret is set", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSecret = process.env.SHARED_SECRET;
    // Save/restore POCKETBASE_URL like the HF13-A2 tests — an unconditional
    // `delete` in finally would clobber a pre-existing value for later tests.
    const prevPbUrl = process.env.POCKETBASE_URL;
    process.env.NODE_ENV = "production";
    process.env.SHARED_SECRET = "test-secret-prod-ok";
    process.env.POCKETBASE_URL = "http://localhost:8090";
    try {
      const booted = await boot({
        configDir: tempDir,
        port,
        bootstrapWindowMs: 0,
      });
      stopFn = booted.stop;
      expect(booted.port).toBe(port);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevSecret !== undefined) process.env.SHARED_SECRET = prevSecret;
      else delete process.env.SHARED_SECRET;
      if (prevPbUrl === undefined) delete process.env.POCKETBASE_URL;
      else process.env.POCKETBASE_URL = prevPbUrl;
    }
  });
});

/**
 * F1: end-to-end wiring test for the /api/probes router. Pre-fix, the
 * orchestrator built `buildProbeInvoker` without a scheduler / runWriter and
 * never mounted the probes router on the live server — so the Status tab in
 * the dashboard had no backend to poll. This boots a real orchestrator with a
 * minimal probe YAML, hits `GET /api/probes`, and asserts:
 *   1. The probe shows up in the list (router is mounted).
 *   2. The `config` section is populated (getProbeConfig wiring).
 *   3. The probe `kind` is non-"unknown" (config lookup resolves).
 */
describe("orchestrator /api/probes wiring (F1)", () => {
  let tempDir: string;
  let probeDir: string;
  let stopFn: (() => Promise<void>) | null = null;
  let port = 0;
  // T-A2 (CR-A2 bonus): capture `prevToken` per-test in beforeEach instead
  // of at module load. Pre-fix, the binding was taken once at file-import
  // time — if any earlier test mutated OPS_TRIGGER_TOKEN and didn't restore
  // it before this describe ran, this block's afterEach would reset to the
  // wrong value. Per-test capture isolates this describe from cross-test
  // pollution.
  let prevToken: string | undefined;

  beforeEach(async () => {
    // Mirror the boot path's expected layout: configDir is the alerts dir,
    // probes live in a sibling `../probes` dir.
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "harness-orch-probes-"),
    );
    tempDir = path.join(root, "alerts");
    probeDir = path.join(root, "probes");
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(probeDir, { recursive: true });
    port = await pickPort();
    prevToken = process.env.OPS_TRIGGER_TOKEN;
    // The probes router's bearer-auth middleware fails loud on construction
    // if no OPS_TRIGGER_TOKEN is configured. Set one for the duration of the
    // test so boot can mount the routes.
    process.env.OPS_TRIGGER_TOKEN = "test-trigger-token";
  });

  afterEach(async () => {
    if (stopFn) {
      await stopFn();
      stopFn = null;
    }
    await fs.rm(path.dirname(tempDir), { recursive: true, force: true });
    if (prevToken === undefined) delete process.env.OPS_TRIGGER_TOKEN;
    else process.env.OPS_TRIGGER_TOKEN = prevToken;
  });

  it("GET /api/probes returns the registered probe with non-null config", async () => {
    // Minimal valid smoke-probe YAML: static targets list, valid cron.
    const probeYaml = [
      "kind: smoke",
      "id: f1-wiring-probe",
      'schedule: "0 9 * * 1"',
      "timeout_ms: 15000",
      "max_concurrency: 2",
      "targets:",
      "  - key: example",
      '    url: "https://example.com"',
      "",
    ].join("\n");
    await fs.writeFile(
      path.join(probeDir, "f1-wiring-probe.yml"),
      probeYaml,
      "utf8",
    );

    const booted = await boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    stopFn = booted.stop;

    const res = await fetch(`http://127.0.0.1:${port}/api/probes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      probes: Array<{
        id: string;
        kind: string;
        schedule: string;
        config: {
          timeout_ms: number | null;
          max_concurrency: number | null;
          discovery: unknown;
        };
      }>;
    };
    const probe = body.probes.find((p) => p.id === "probe:f1-wiring-probe");
    expect(probe).toBeDefined();
    // Pre-fix: kind would be "unknown" because getProbeConfig returned undefined.
    expect(probe!.kind).toBe("smoke");
    // Pre-fix: timeout_ms / max_concurrency would be null because the router
    // had no probe-config lookup wired through.
    expect(probe!.config.timeout_ms).toBe(15000);
    expect(probe!.config.max_concurrency).toBe(2);
  });
});

/**
 * CR-A2.1: boot must NOT orphan the HTTP server when scheduler.start() throws.
 *
 * Pre-fix sequence in orchestrator.boot():
 *   1. const server = serve({ ... port })   // HTTP socket bound
 *   2. scheduler.start()                    // throws synchronously
 *   3. (boot's try wrapping is upstream — start() throw propagates out)
 *
 * Result pre-fix: boot rejects but `server` keeps the port bound. The next
 * boot attempt on the same port hits EADDRINUSE; CI runs that pick a fresh
 * port mask the bug, but in production a Railway restart loop leaks
 * one socket per crash until OOM. Fix: reorder so scheduler.start() runs
 * BEFORE serve() (option B), or close the server before rethrowing.
 *
 * Test: doMock createScheduler so scheduler.start() throws. Boot must reject
 * AND the chosen port must NOT be left in LISTEN state.
 */
describe("orchestrator boot start() failure cleanup (CR-A2.1)", () => {
  let tempDir: string;
  let port = 0;

  beforeEach(async () => {
    tempDir = await mkTempConfigDir();
    port = await pickPort();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("rejects boot AND does not leave the HTTP port bound when scheduler.start() throws", async () => {
    vi.resetModules();

    // Wrap createScheduler so the returned scheduler.start throws on first
    // invocation. All other methods delegate to the real scheduler so
    // boot() can register entries / call list() etc. before start().
    vi.doMock("./scheduler/scheduler.js", async () => {
      const actual = await vi.importActual<
        typeof import("./scheduler/scheduler.js")
      >("./scheduler/scheduler.js");
      return {
        ...actual,
        createScheduler: (
          deps: Parameters<typeof actual.createScheduler>[0],
        ) => {
          const real = actual.createScheduler(deps);
          return {
            ...real,
            start: () => {
              throw new Error("simulated scheduler.start() failure");
            },
          };
        },
      };
    });

    const orchMod = await import("./orchestrator.js");

    await expect(
      orchMod.boot({ configDir: tempDir, port, bootstrapWindowMs: 0 }),
    ).rejects.toThrow(/simulated scheduler\.start\(\) failure/);

    // Wait long enough for any deferred listen() callback to fire — pre-fix,
    // serve() schedules the actual socket bind on next tick, so a synchronous
    // port-probe could miss the orphan window.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Critical assertion: a fetch to the port must NOT succeed. Pre-fix
    // the orphaned http.Server stays listening on `port` even after boot
    // rejects, so /health (or even /) responds. Post-fix the server was
    // either never bound (option B: scheduler.start before serve) or
    // closed before rethrow (option A). NOTE: net.createServer().listen()
    // can succeed for a still-bound orphan because Node sets SO_REUSEADDR
    // by default on macOS — the probe-bind cannot detect the orphan.
    // Only an actual fetch can prove the port is silent.
    let fetchSucceeded = false;
    let fetchErr = "";
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      fetchSucceeded = res.status >= 200 && res.status < 600;
    } catch (err) {
      fetchErr = err instanceof Error ? err.message : String(err);
    }
    expect(
      fetchSucceeded,
      `port should NOT serve after rejected boot; fetchErr=${fetchErr}`,
    ).toBe(false);
  });
});

/**
 * CR-A2.2: orchestrator's diffProbeSchedules must NOT orphan probeConfigs
 * when scheduler.unregister rejects.
 *
 * Pre-fix sequence:
 *   scheduler.unregister(id).catch(log)   // fire-and-forget
 *   probeConfigs.delete(id)               // runs synchronously
 *
 * If unregister rejects, the scheduler still has the entry but probeConfigs
 * no longer has the config. The /api/probes router would render the
 * stale entry as `kind: "unknown"` with `config: { timeout_ms: null, ... }` —
 * the worst possible debugging experience.
 *
 * Fix: await unregister, and if it rejects, skip the probeConfigs.delete so
 * the orphan stays visible with proper config rather than fully orphaned.
 *
 * Test: boot with a probe YAML, confirm /api/probes shows the probe with
 * proper config. Mock scheduler.unregister to reject. Delete the YAML,
 * fire SIGHUP-style reload (re-call probeLoader path via deletion + watcher
 * settle). Assert /api/probes STILL shows the probe with proper config —
 * NOT "unknown".
 */
describe("orchestrator probe unregister failure preserves config (CR-A2.2)", () => {
  let tempDir: string;
  let probeDir: string;
  let stopFn: (() => Promise<void>) | null = null;
  let port = 0;
  let prevToken: string | undefined;

  beforeEach(async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "harness-orch-unreg-"),
    );
    tempDir = path.join(root, "alerts");
    probeDir = path.join(root, "probes");
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(probeDir, { recursive: true });
    port = await pickPort();
    prevToken = process.env.OPS_TRIGGER_TOKEN;
    process.env.OPS_TRIGGER_TOKEN = "test-trigger-token";
  });

  afterEach(async () => {
    if (stopFn) {
      await stopFn();
      stopFn = null;
    }
    await fs.rm(path.dirname(tempDir), { recursive: true, force: true });
    if (prevToken === undefined) delete process.env.OPS_TRIGGER_TOKEN;
    else process.env.OPS_TRIGGER_TOKEN = prevToken;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("keeps probeConfigs entry when scheduler.unregister rejects (orphan stays visible with proper config)", async () => {
    vi.resetModules();

    // Wrap createScheduler: unregister is replaced with a rejecting mock,
    // but only after the registration phase has succeeded (we install the
    // rejection during the first list() that returns a non-empty set, so
    // initial diffProbeSchedules works as normal). All other methods
    // delegate to the real scheduler.
    let unregisterShouldReject = false;
    vi.doMock("./scheduler/scheduler.js", async () => {
      const actual = await vi.importActual<
        typeof import("./scheduler/scheduler.js")
      >("./scheduler/scheduler.js");
      return {
        ...actual,
        createScheduler: (
          deps: Parameters<typeof actual.createScheduler>[0],
        ) => {
          const real = actual.createScheduler(deps);
          return {
            ...real,
            // Pass through register/list/start/stop/etc.; intercept ONLY
            // unregister to simulate a rejecting cleanup.
            unregister: async (id: string) => {
              if (unregisterShouldReject) {
                throw new Error(`simulated unregister rejection for ${id}`);
              }
              return real.unregister(id);
            },
          };
        },
      };
    });

    const probeYaml = [
      "kind: smoke",
      "id: cr-a2-2-probe",
      'schedule: "0 9 * * 1"',
      "timeout_ms: 12345",
      "max_concurrency: 3",
      "targets:",
      "  - key: example",
      '    url: "https://example.com"',
      "",
    ].join("\n");
    const probePath = path.join(probeDir, "cr-a2-2-probe.yml");
    await fs.writeFile(probePath, probeYaml, "utf8");

    const orchMod = await import("./orchestrator.js");
    const booted = await orchMod.boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    stopFn = booted.stop;

    // Sanity: probe shows with proper kind + config initially.
    const beforeRes = await fetch(`http://127.0.0.1:${port}/api/probes`);
    expect(beforeRes.status).toBe(200);
    const beforeBody = (await beforeRes.json()) as {
      probes: Array<{
        id: string;
        kind: string;
        config: { timeout_ms: number | null; max_concurrency: number | null };
      }>;
    };
    const beforeProbe = beforeBody.probes.find(
      (p) => p.id === "probe:cr-a2-2-probe",
    );
    expect(beforeProbe).toBeDefined();
    expect(beforeProbe!.kind).toBe("smoke");
    expect(beforeProbe!.config.timeout_ms).toBe(12345);

    // Now arm the unregister rejection and remove the YAML file. The
    // probe-loader file watcher will pick up the deletion and call
    // diffProbeSchedules with an empty desired set → unregister fires → rejects.
    unregisterShouldReject = true;
    await fs.rm(probePath, { force: true });

    // Wait long enough for chokidar's debounce + the post-fix awaited
    // unregister to settle. The probe-loader uses a 100ms debounce; pad
    // generously.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Post-fix expectation: probe is STILL in /api/probes (scheduler
    // still has the entry because unregister rejected) AND the config
    // is preserved (kind: "smoke", timeout_ms: 12345). Pre-fix, the
    // sync probeConfigs.delete would have nuked the config so kind
    // would render as "unknown" with timeout_ms: null.
    const afterRes = await fetch(`http://127.0.0.1:${port}/api/probes`);
    expect(afterRes.status).toBe(200);
    const afterBody = (await afterRes.json()) as {
      probes: Array<{
        id: string;
        kind: string;
        config: { timeout_ms: number | null; max_concurrency: number | null };
      }>;
    };
    const afterProbe = afterBody.probes.find(
      (p) => p.id === "probe:cr-a2-2-probe",
    );
    expect(afterProbe).toBeDefined();
    expect(afterProbe!.kind).toBe("smoke");
    expect(afterProbe!.kind).not.toBe("unknown");
    expect(afterProbe!.config.timeout_ms).toBe(12345);
  });
});

/**
 * R2-B.3: OPS_TRIGGER_TOKEN="" (empty-but-set) must be a fail-loud
 * misconfiguration. Pre-fix, the boot path treated `triggerToken` as
 * truthy-only — an operator who mistyped the env var (e.g. `OPS_TRIGGER_TOKEN=`)
 * shipped an empty value AND got a silent-skip "probes-router-disabled" log
 * instead of a clear error.
 *
 * Distinguish:
 *   - unset (intentional disable) → boot succeeds, info log emitted.
 *   - set-but-empty (misconfig)   → boot throws with explicit message.
 *   - set-with-value              → boot succeeds, router mounted.
 */
describe("orchestrator OPS_TRIGGER_TOKEN empty-string handling (R2-B.3)", () => {
  let tempDir: string;
  let port = 0;
  let stopFn: (() => Promise<void>) | null = null;
  let prevToken: string | undefined;

  beforeEach(async () => {
    tempDir = await mkTempConfigDir();
    port = await pickPort();
    prevToken = process.env.OPS_TRIGGER_TOKEN;
  });

  afterEach(async () => {
    if (stopFn) {
      await stopFn();
      stopFn = null;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    if (prevToken === undefined) delete process.env.OPS_TRIGGER_TOKEN;
    else process.env.OPS_TRIGGER_TOKEN = prevToken;
  });

  it('throws fail-loud when OPS_TRIGGER_TOKEN="" (empty string)', async () => {
    process.env.OPS_TRIGGER_TOKEN = "";
    await expect(
      boot({ configDir: tempDir, port, bootstrapWindowMs: 0 }),
    ).rejects.toThrow(/OPS_TRIGGER_TOKEN.*empty/i);
  });

  it("throws fail-loud when OPS_TRIGGER_TOKEN is whitespace-only", async () => {
    process.env.OPS_TRIGGER_TOKEN = "   ";
    await expect(
      boot({ configDir: tempDir, port, bootstrapWindowMs: 0 }),
    ).rejects.toThrow(/OPS_TRIGGER_TOKEN.*empty/i);
  });

  it("succeeds with router disabled when OPS_TRIGGER_TOKEN is unset", async () => {
    delete process.env.OPS_TRIGGER_TOKEN;
    const booted = await boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    stopFn = booted.stop;
    // Router NOT mounted → /api/probes 404s.
    const res = await fetch(`http://127.0.0.1:${port}/api/probes`);
    expect(res.status).toBe(404);
  });

  it("succeeds with router mounted when OPS_TRIGGER_TOKEN is non-empty", async () => {
    process.env.OPS_TRIGGER_TOKEN = "real-token";
    const booted = await boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    stopFn = booted.stop;
    // Router mounted → /api/probes 200s (no probes registered → empty list).
    const res = await fetch(`http://127.0.0.1:${port}/api/probes`);
    expect(res.status).toBe(200);
  });

  // R3-A.5: a token padded with surrounding whitespace must boot and
  // accept Bearer requests using the trimmed value. Pre-fix, R2-B.3
  // only rejected zero-trim-length tokens — a "  abc  " token boot'd
  // but auth-layer trimming on the presented side made the effective
  // expected literal contain the spaces, silently rejecting all real
  // requests. Trim at boot AND trim the expected token in auth.ts so
  // the comparison is symmetric.
  it("R3-A.5: boots with whitespace-padded OPS_TRIGGER_TOKEN and accepts trimmed Bearer", async () => {
    process.env.OPS_TRIGGER_TOKEN = "  abc  ";
    const booted = await boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    stopFn = booted.stop;
    // GET /api/probes is unauthenticated (the bearer-auth middleware only
    // mounts on the trigger sub-routes), so 200 there only proves the
    // router was mounted. Hit a trigger endpoint with the trimmed value
    // and assert a non-401 response — the body may be 404 (no such probe)
    // but it MUST NOT be 401, which is the symptom the fix prevents.
    const res = await fetch(
      `http://127.0.0.1:${port}/api/probes/probe:does-not-exist/trigger`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer abc",
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    expect(res.status).not.toBe(401);
  });
});

/**
 * R3-F1: `OPS_TRIGGER_TOKEN` fail-loud check is hoisted to the TOP of both
 * boot paths (worker `boot()` and `runControlPlane`) via the exported
 * helper `loadOpsTriggerToken`, matching `loadWebhookSecrets` /
 * `loadPocketbaseUrl`. Pre-fix the empty-string check lived AFTER pb /
 * bus / scheduler / writer allocations, so a typo'd `OPS_TRIGGER_TOKEN=`
 * allocated expensive resources before throwing.
 *
 * Unit-tests the helper directly so the predicate is locked in
 * independently of either boot path's other config plumbing.
 */
describe("orchestrator R3-F1: loadOpsTriggerToken fail-loud helper", () => {
  let prevToken: string | undefined;

  beforeEach(() => {
    prevToken = process.env.OPS_TRIGGER_TOKEN;
  });

  afterEach(() => {
    if (prevToken === undefined) delete process.env.OPS_TRIGGER_TOKEN;
    else process.env.OPS_TRIGGER_TOKEN = prevToken;
  });

  it("returns undefined when OPS_TRIGGER_TOKEN is unset (intentional disable)", async () => {
    delete process.env.OPS_TRIGGER_TOKEN;
    const orchMod = await import("./orchestrator.js");
    expect(orchMod.loadOpsTriggerToken()).toBeUndefined();
  });

  it('throws fail-loud when OPS_TRIGGER_TOKEN="" (empty string)', async () => {
    process.env.OPS_TRIGGER_TOKEN = "";
    const orchMod = await import("./orchestrator.js");
    expect(() => orchMod.loadOpsTriggerToken()).toThrow(
      /OPS_TRIGGER_TOKEN.*empty/i,
    );
  });

  it("throws fail-loud when OPS_TRIGGER_TOKEN is whitespace-only", async () => {
    process.env.OPS_TRIGGER_TOKEN = "   ";
    const orchMod = await import("./orchestrator.js");
    expect(() => orchMod.loadOpsTriggerToken()).toThrow(
      /OPS_TRIGGER_TOKEN.*empty/i,
    );
  });

  it("returns the trimmed token when set with surrounding whitespace (R3-A.5 contract)", async () => {
    process.env.OPS_TRIGGER_TOKEN = "  abc  ";
    const orchMod = await import("./orchestrator.js");
    expect(orchMod.loadOpsTriggerToken()).toBe("abc");
  });

  it("returns the verbatim token when set with no whitespace", async () => {
    process.env.OPS_TRIGGER_TOKEN = "real-token";
    const orchMod = await import("./orchestrator.js");
    expect(orchMod.loadOpsTriggerToken()).toBe("real-token");
  });
});

/**
 * R2-B.1: cron-rule unregister failure must NOT be fire-and-forget. Pre-fix,
 * `diffCronSchedules` called `scheduler.unregister(id)` without awaiting the
 * returned promise — a rejection became an unhandled rejection AND the
 * orphan rule entry's bookkeeping got no structured log. This mirrors the
 * CR-A2.2 fix on the probe-rule path: await the unregister, and on
 * rejection emit a structured `orchestrator.cron-unregister-failed` log so
 * operators have an explicit signal that a stale cron entry could not be
 * cleaned up. The orphan stays visible in `scheduler.list()` (best
 * debugging surface — same design choice as CR-A2.2).
 */
describe("orchestrator.diffCronSchedules unregister rejection (R2-B.1)", () => {
  it("awaits scheduler.unregister and logs structured error on rejection (no unhandled rejection, orphan preserved)", async () => {
    // Track which ids the stub ever saw register/unregister for.
    const registeredIds = new Set<string>();
    const unregisterCalls: string[] = [];
    const stubEntries: Array<{ id: string; cron: string }> = [
      { id: "stale-rule:cron:0", cron: "0 9 * * 1" },
    ];

    const stubScheduler = {
      register: vi.fn((entry: { id: string; cron: string }) => {
        registeredIds.add(entry.id);
      }),
      // R2-B.1: the rejection MUST be observed (awaited) by diffCronSchedules.
      // If the function fire-and-forgets, this rejection becomes an unhandled
      // rejection in node and the test runner flags it.
      unregister: vi.fn(async (id: string) => {
        unregisterCalls.push(id);
        throw new Error(`simulated unregister rejection for ${id}`);
      }),
      hasEntry: (id: string) => registeredIds.has(id),
      list: vi.fn(() =>
        stubEntries.map((e) => ({
          id: e.id,
          cron: e.cron,
          handler: async () => undefined,
        })),
      ),
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
      isStarted: () => false,
      isStopped: () => false,
      getJobCount: () => registeredIds.size,
    } as unknown as ReturnType<typeof createScheduler>;

    const bus = createEventBus();
    const resolver: Parameters<typeof diffCronSchedules>[3] = () => null;

    // Spy on logger.error so we can assert the structured failure log.
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    let allCalls: unknown[][] = [];
    try {
      // diffCronSchedules is async post-fix; await it. Pre-fix it returns
      // void synchronously (the void is awaitable as a no-op) and never
      // emits the structured log, so the assertion below catches the bug.
      await diffCronSchedules(stubScheduler, [], bus, resolver);
      // Pump microtasks so any deferred error path settles.
      await new Promise((resolve) => setTimeout(resolve, 50));
      allCalls = errorSpy.mock.calls.map((c) => [...c]);
    } finally {
      errorSpy.mockRestore();
    }

    // 1. unregister was called exactly once for the stale rule.
    expect(unregisterCalls).toEqual(["stale-rule:cron:0"]);
    // 2. The structured log fired with the rule id surfaced. Pre-fix
    //    (fire-and-forget), the rejection became an unhandled promise and
    //    no `orchestrator.cron-unregister-failed` log was ever emitted.
    const matchingCall = allCalls.find(
      ([msg]) => msg === "orchestrator.cron-unregister-failed",
    );
    expect(matchingCall).toBeDefined();
    expect(matchingCall![1]).toMatchObject({
      id: "stale-rule:cron:0",
    });
  });
});

/**
 * R2-B.2: boot must clean up the scheduler if `serve()` throws. CR-A2.1
 * reordered scheduler.start() before serve(), but if serve() itself throws
 * (e.g., EADDRINUSE), scheduler is left running with no stop handle —
 * cron tasks fire indefinitely with no owner. Wrap serve() in try/catch;
 * on throw, await scheduler.stop() and reset schedulerRunning before
 * rethrowing.
 */
describe("orchestrator boot serve() failure cleanup (R2-B.2)", () => {
  let tempDir: string;
  let port = 0;

  beforeEach(async () => {
    tempDir = await mkTempConfigDir();
    port = await pickPort();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("rejects boot AND calls scheduler.stop() when serve() throws", async () => {
    vi.resetModules();

    // Spy on createScheduler so we can observe `stop()` after the serve()
    // throw. All other methods delegate to the real scheduler.
    const stopSpy = vi.fn(async () => undefined);
    vi.doMock("./scheduler/scheduler.js", async () => {
      const actual = await vi.importActual<
        typeof import("./scheduler/scheduler.js")
      >("./scheduler/scheduler.js");
      return {
        ...actual,
        createScheduler: (
          deps: Parameters<typeof actual.createScheduler>[0],
        ) => {
          const real = actual.createScheduler(deps);
          return {
            ...real,
            stop: async (...args: unknown[]) => {
              stopSpy();
              return (real.stop as (...a: unknown[]) => Promise<void>)(...args);
            },
          };
        },
      };
    });

    // Force `serve()` to throw synchronously when boot tries to bind.
    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return {
        ...actual,
        serve: () => {
          throw new Error("simulated EADDRINUSE from serve()");
        },
      };
    });

    const orchMod = await import("./orchestrator.js");

    await expect(
      orchMod.boot({ configDir: tempDir, port, bootstrapWindowMs: 0 }),
    ).rejects.toThrow(/simulated EADDRINUSE from serve\(\)/);

    // Critical assertion: scheduler.stop() must have been called as part
    // of cleanup. Pre-fix, the scheduler kept ticking with no stop handle.
    expect(stopSpy).toHaveBeenCalled();
  });
});

/**
 * R4-A.3: serve() async bind error escapes try/catch.
 *
 * `serve()` from @hono/node-server returns the http.Server SYNCHRONOUSLY but
 * the bind happens via server.listen() which emits 'error' ASYNCHRONOUSLY for
 * conditions like EADDRINUSE. The R2-B.2 try/catch only catches synchronous
 * throws — a real bind failure resolves boot() successfully with an orphaned
 * scheduler still ticking.
 *
 * Fix: attach a listener to the returned server's 'error' event and race it
 * against 'listening'. On 'error', stop the scheduler and reject boot().
 */
describe("orchestrator boot serve() async bind error cleanup (R4-A.3)", () => {
  let tempDir: string;
  let port = 0;

  beforeEach(async () => {
    tempDir = await mkTempConfigDir();
    port = await pickPort();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("rejects boot AND calls scheduler.stop() when serve() returns a server that emits 'error' asynchronously", async () => {
    vi.resetModules();

    // Spy on createScheduler so we can observe `stop()` after the async
    // bind error. All other methods delegate to the real scheduler.
    const stopSpy = vi.fn(async () => undefined);
    vi.doMock("./scheduler/scheduler.js", async () => {
      const actual = await vi.importActual<
        typeof import("./scheduler/scheduler.js")
      >("./scheduler/scheduler.js");
      return {
        ...actual,
        createScheduler: (
          deps: Parameters<typeof actual.createScheduler>[0],
        ) => {
          const real = actual.createScheduler(deps);
          return {
            ...real,
            stop: async (...args: unknown[]) => {
              stopSpy();
              return (real.stop as (...a: unknown[]) => Promise<void>)(...args);
            },
          };
        },
      };
    });

    // Mock `serve()` to return a server stub that emits 'error'
    // asynchronously (mimicking real EADDRINUSE behaviour where the
    // returned server's listen() schedules the bind on next tick).
    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      // Build a minimal EventEmitter-like stub that satisfies the
      // surface boot() touches (once/removeListener for the race,
      // close for stop()).
      return {
        ...actual,
        serve: () => {
          const listeners: Record<string, Array<(...a: unknown[]) => void>> = {
            error: [],
            listening: [],
          };
          const stub = {
            listening: false,
            once(event: string, cb: (...a: unknown[]) => void) {
              listeners[event] ??= [];
              listeners[event].push(cb);
              return stub;
            },
            on(event: string, cb: (...a: unknown[]) => void) {
              listeners[event] ??= [];
              listeners[event].push(cb);
              return stub;
            },
            removeListener(event: string, cb: (...a: unknown[]) => void) {
              const arr = listeners[event];
              if (arr) {
                const i = arr.indexOf(cb);
                if (i >= 0) arr.splice(i, 1);
              }
              return stub;
            },
            close(cb?: (err?: Error) => void) {
              if (cb) cb();
              return stub;
            },
          };
          // Schedule the async error AFTER the current tick so boot()
          // has time to attach its listeners.
          setTimeout(() => {
            const errs = listeners.error.slice();
            for (const cb of errs)
              cb(new Error("simulated EADDRINUSE from async listen()"));
          }, 0);
          return stub as unknown as ReturnType<typeof actual.serve>;
        },
      };
    });

    const orchMod = await import("./orchestrator.js");

    await expect(
      orchMod.boot({ configDir: tempDir, port, bootstrapWindowMs: 0 }),
    ).rejects.toThrow(/simulated EADDRINUSE from async listen\(\)/);

    // Critical assertion: scheduler.stop() must have been called as part
    // of cleanup. Pre-fix, the async bind error was unobserved by the
    // R2-B.2 try/catch and boot() resolved with the scheduler running.
    expect(stopSpy).toHaveBeenCalled();
  });
});

/**
 * Post-#4292 hotfix regression guard.
 *
 * Production symptom: probe-loader emitted `probe-loader.file-failed`
 *   `no driver registered for kind 'e2e_deep'`
 *   `no driver registered for kind 'e2e_d6'`
 * on every showcase-harness boot after #4292 merged. The D5 (`e2e_deep`)
 * and D6 (`e2e_d6`) drivers shipped as exports but the
 * orchestrator never registered them — so the probe-loader rejected
 * their YAML at boot, the drivers never ran, and no D5/D6 PB rows
 * were ever written. This test locks every required probe-kind into
 * the orchestrator's canonical registration set so a future driver
 * landing without a registration call fails CI instead of prod.
 */
describe("orchestrator.registerAllProbeDrivers (post-#4292 hotfix guard)", () => {
  it("registers every probe-kind referenced by config/probes/*.yml", () => {
    const registry = createProbeRegistry();
    registerAllProbeDrivers(registry);
    const kinds = registry.list();
    // Every kind below is referenced by a YAML in showcase/harness/config/probes
    // — drift between this set and the YAMLs is exactly the
    // probe-loader.file-failed bug we're guarding against.
    expect(kinds).toEqual(
      [
        "aimock_wiring",
        "e2e_demos",
        "e2e_d6",
        "e2e_smoke",
        "image_drift",
        "pin_drift",
        "qa",
        "redirect_decommission",
        "smoke",
        "starter_smoke",
        "version_drift",
      ].sort(),
    );
  });

  it("includes e2e_d6 (the #4292 regressor; D5 now runs under e2e_d6)", () => {
    // Tighter assertion narrowed to the kind that triggered the production
    // probe-loader.file-failed alert. `e2e_deep` is intentionally GONE: D5 is
    // now "D6 take-one" — `config/probes/e2e-deep.yml` declares `kind: e2e_d6`
    // and the separate D5 driver was deleted, so there is no `e2e_deep` kind to
    // register. If a future refactor accidentally drops the e2e_d6
    // registration, the broader equality check above still catches it.
    const registry = createProbeRegistry();
    registerAllProbeDrivers(registry);
    const kinds = registry.list();
    expect(kinds).not.toContain("e2e_deep");
    expect(kinds).toContain("e2e_d6");
  });
});

/**
 * Pins the producer↔worker driver-kind contract for the fleet worker registry.
 *
 * Two failure modes guarded:
 *  1. LOCK-STEP: each driver factory's self-reported `kind` MUST equal the
 *     `E2E_*_DRIVER_KIND` constant the worker registry / payload producer keys
 *     on. If a factory's kind and its constant drift, the producer would stamp a
 *     `driverKind` no registry entry matches → every job of that kind terminates
 *     as a worker-protocol-violation.
 *  2. REGISTRY WIRING: the shared `buildPooledBrowserDrivers` (the SINGLE pooled
 *     construction the worker registry at runWorker ~2528 builds from) must map
 *     each slot to the factory whose kind matches — catches a key→factory
 *     copy-paste swap (e.g. wiring the deep driver under the d6 slot).
 */
describe("fleet worker driver-kind lock-step + registry wiring", () => {
  it("each driver factory's self-reported kind equals its constant (lock-step)", () => {
    // D5 runs the d6 driver ("D5 take-one") — there is no separate deep driver.
    expect(createE2eFullDriver().kind).toBe(E2E_D6_DRIVER_KIND);
    expect(createE2eDemosDriver().kind).toBe(E2E_DEMOS_DRIVER_KIND);
    expect(createE2eSmokeDriver().kind).toBe(E2E_SMOKE_DRIVER_KIND);
  });

  it("buildPooledBrowserDrivers maps each slot to the correctly-kinded factory", () => {
    // The pooled launchers don't touch the pool at construction, so an
    // un-init'd pool is sufficient to build the drivers.
    const pool = new BrowserPool({ logger });
    const pooled = buildPooledBrowserDrivers(pool, logger);
    expect(pooled.d6.kind).toBe(E2E_D6_DRIVER_KIND);
    expect(pooled.demos.kind).toBe(E2E_DEMOS_DRIVER_KIND);
    expect(pooled.smoke.kind).toBe(E2E_SMOKE_DRIVER_KIND);
  });
});

/**
 * hydrateProbeLastRuns: reads the most recent completed probe_run from PB
 * for each `probe:*` scheduler entry and seeds the scheduler's lastRun
 * bookkeeping so the dashboard shows historical data immediately after
 * restart (instead of "never run" until the first cron tick).
 */
describe("hydrateProbeLastRuns", () => {
  function makeStubScheduler() {
    const entries = new Map<
      string,
      {
        id: string;
        cron: string;
        seeded: {
          startedAt: number;
          finishedAt: number;
          durationMs: number;
          summary: unknown;
        } | null;
      }
    >();
    return {
      register(entry: { id: string; cron: string }) {
        entries.set(entry.id, { ...entry, seeded: null });
      },
      unregister: vi.fn(async () => true),
      hasEntry: (id: string) => entries.has(id),
      list: () =>
        Array.from(entries.values()).map((e) => ({
          id: e.id,
          cron: e.cron,
          handler: async () => undefined,
        })),
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
      isStarted: () => false,
      isStopped: () => false,
      getJobCount: () => entries.size,
      getEntry: (id: string) => {
        const e = entries.get(id);
        if (!e) return undefined;
        return {
          id: e.id,
          cron: e.cron,
          inflight: 0,
          lastRunStartedAt: e.seeded?.startedAt ?? null,
          lastRunFinishedAt: e.seeded?.finishedAt ?? null,
          lastRunDurationMs: e.seeded?.durationMs ?? null,
          lastRunSummary: e.seeded?.summary ?? null,
          triggeredRun: false,
          tracker: null,
        };
      },
      setEntryTracker: vi.fn(),
      seedEntryLastRun: vi.fn(
        (
          id: string,
          opts: {
            startedAt: number;
            finishedAt: number;
            durationMs: number;
            summary: unknown;
          },
        ) => {
          const e = entries.get(id);
          if (e) e.seeded = opts;
        },
      ),
      trigger: vi.fn(),
      nextRunAt: vi.fn(() => null),
    };
  }

  function makeStubRunWriter() {
    return {
      start: vi.fn(),
      finish: vi.fn(),
      recent: vi.fn().mockResolvedValue([]),
    };
  }

  function makeStubLogger() {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  }

  it("seeds scheduler entries from completed probe_runs", async () => {
    const scheduler = makeStubScheduler();
    scheduler.register({ id: "probe:smoke-all", cron: "0 * * * *" });
    scheduler.register({ id: "probe:pin-drift", cron: "0 9 * * 1" });
    const runWriter = makeStubRunWriter();
    runWriter.recent.mockImplementation(async (probeId: string) => {
      if (probeId === "smoke-all") {
        return [
          {
            id: "run1",
            probeId: "smoke-all",
            startedAt: "2025-01-01T00:00:00.000Z",
            finishedAt: "2025-01-01T00:01:00.000Z",
            durationMs: 60000,
            triggered: false,
            state: "completed",
            summary: { total: 5, passed: 5, failed: 0 },
          },
        ];
      }
      return [];
    });
    const log = makeStubLogger();

    await hydrateProbeLastRuns({
      scheduler: scheduler as any,
      runWriter: runWriter as any,
      logger: log as any,
    });

    // smoke-all was seeded
    expect(scheduler.seedEntryLastRun).toHaveBeenCalledWith("probe:smoke-all", {
      startedAt: Date.parse("2025-01-01T00:00:00.000Z"),
      finishedAt: Date.parse("2025-01-01T00:01:00.000Z"),
      durationMs: 60000,
      summary: { total: 5, passed: 5, failed: 0 },
    });
    // pin-drift had no runs — should NOT have been seeded
    expect(scheduler.seedEntryLastRun).toHaveBeenCalledTimes(1);
    // Info log emitted
    expect(log.info).toHaveBeenCalledWith("orchestrator.hydrate-lastrun", {
      seeded: 1,
      total: 2,
    });
  });

  it("skips non-probe entries (only fetches runs for probe:* ids)", async () => {
    const scheduler = makeStubScheduler();
    scheduler.register({ id: "internal:s3-backup", cron: "0 3 * * *" });
    scheduler.register({ id: "probe:smoke", cron: "0 * * * *" });
    scheduler.register({ id: "ruleA:cron:0", cron: "0 9 * * 1" });
    const runWriter = makeStubRunWriter();
    const log = makeStubLogger();

    await hydrateProbeLastRuns({
      scheduler: scheduler as any,
      runWriter: runWriter as any,
      logger: log as any,
    });

    // recent() called only for the probe entry's bare id
    expect(runWriter.recent).toHaveBeenCalledTimes(1);
    expect(runWriter.recent).toHaveBeenCalledWith("smoke", 1);
  });

  it("tolerates runWriter.recent() failures gracefully (never throws)", async () => {
    const scheduler = makeStubScheduler();
    scheduler.register({ id: "probe:broken", cron: "0 * * * *" });
    const runWriter = makeStubRunWriter();
    runWriter.recent.mockRejectedValue(new Error("PB is down"));
    const log = makeStubLogger();

    // Must NOT throw
    await expect(
      hydrateProbeLastRuns({
        scheduler: scheduler as any,
        runWriter: runWriter as any,
        logger: log as any,
      }),
    ).resolves.toBeUndefined();

    // Warn log emitted for the failure
    expect(log.warn).toHaveBeenCalledWith(
      "orchestrator.hydrate-lastrun-failed",
      expect.objectContaining({ err: expect.stringContaining("PB is down") }),
    );
    // seedEntryLastRun NOT called
    expect(scheduler.seedEntryLastRun).not.toHaveBeenCalled();
  });

  it("skips runs with malformed date strings (NaN guard)", async () => {
    const scheduler = makeStubScheduler();
    scheduler.register({ id: "probe:bad-dates", cron: "0 * * * *" });
    const runWriter = makeStubRunWriter();
    runWriter.recent.mockResolvedValue([
      {
        id: "run-bad",
        probeId: "bad-dates",
        startedAt: "not-a-date",
        finishedAt: "also-bad",
        durationMs: 1000,
        triggered: false,
        state: "completed",
        summary: null,
      },
    ]);
    const log = makeStubLogger();

    await hydrateProbeLastRuns({
      scheduler: scheduler as any,
      runWriter: runWriter as any,
      logger: log as any,
    });

    expect(scheduler.seedEntryLastRun).not.toHaveBeenCalled();
  });

  it("includes probeId in warn log when runWriter.recent() rejects", async () => {
    const scheduler = makeStubScheduler();
    scheduler.register({ id: "probe:broken", cron: "0 * * * *" });
    const runWriter = makeStubRunWriter();
    runWriter.recent.mockRejectedValue(new Error("PB is down"));
    const log = makeStubLogger();

    await hydrateProbeLastRuns({
      scheduler: scheduler as any,
      runWriter: runWriter as any,
      logger: log as any,
    });

    expect(log.warn).toHaveBeenCalledWith(
      "orchestrator.hydrate-lastrun-failed",
      expect.objectContaining({
        probeId: "probe:broken",
        err: expect.stringContaining("PB is down"),
      }),
    );
  });

  it("skips runs with finishedAt=null (incomplete)", async () => {
    const scheduler = makeStubScheduler();
    scheduler.register({ id: "probe:in-progress", cron: "0 * * * *" });
    const runWriter = makeStubRunWriter();
    runWriter.recent.mockResolvedValue([
      {
        id: "run-incomplete",
        probeId: "in-progress",
        startedAt: "2025-01-01T00:00:00.000Z",
        finishedAt: null,
        durationMs: null,
        triggered: false,
        state: "running",
        summary: null,
      },
    ]);
    const log = makeStubLogger();

    await hydrateProbeLastRuns({
      scheduler: scheduler as any,
      runWriter: runWriter as any,
      logger: log as any,
    });

    // Entry stays un-seeded because the run is incomplete
    expect(scheduler.seedEntryLastRun).not.toHaveBeenCalled();
  });
});

/**
 * CR-FIX #4: verifyWorkerRegistered must reflect the ACTUAL upsert outcome.
 *
 * registerWorker is best-effort and swallows the boot-upsert failure, so the
 * worker pre-fix set `registered = true` unconditionally — a failed
 * registration still reported the worker healthy on the roster. The verifier
 * reads the row back: present → true; absent OR read-error → false.
 */
describe("orchestrator.verifyWorkerRegistered (CR-FIX #4)", () => {
  function makeLogger() {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  }

  // pb fake satisfying verifyWorkerRegistered's WorkerRegistryReadPb. Plain
  // generic method (not vi.fn) so getFirst<T> type-checks; the tests assert on
  // the return value + logger, not on the read call.
  function makeRegistryPb(row: { id?: string } | null): WorkerRegistryReadPb {
    return {
      getFirst<T>(): Promise<T | null> {
        return Promise.resolve(row as T | null);
      },
    };
  }

  it("returns true when the registration row persisted", async () => {
    const pb = makeRegistryPb({ id: "rec123" });
    const logger = makeLogger();
    const result = await verifyWorkerRegistered({
      pb,
      workerId: "worker-1",
      logger,
    });
    expect(result).toBe(true);
  });

  it("returns false when the upsert did NOT persist a row (best-effort swallow)", async () => {
    // registerWorker swallowed a PB 400 — no row exists.
    const pb = makeRegistryPb(null);
    const logger = makeLogger();
    const result = await verifyWorkerRegistered({
      pb,
      workerId: "worker-2",
      logger,
    });
    // THE FIX: pre-fix this was hardcoded true; now it reflects reality.
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "showcase-harness.fleet.worker.registration-not-persisted",
      expect.objectContaining({ workerId: "worker-2" }),
    );
  });

  it("returns false (and warns) when the verify read itself errors", async () => {
    const pb: WorkerRegistryReadPb = {
      getFirst<T>(): Promise<T | null> {
        return Promise.reject(new Error("pb unreachable"));
      },
    };
    const logger = makeLogger();
    const result = await verifyWorkerRegistered({
      pb,
      workerId: "worker-3",
      logger,
    });
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "showcase-harness.fleet.worker.registration-verify-failed",
      expect.objectContaining({ workerId: "worker-3" }),
    );
  });

  // WIRING: a failed verify must flow into the /health `registered` probe.
  // runWorker does `registered = await verifyWorkerRegistered(...)` then passes
  // `registered: () => registered` into runFleetWorker's health server. This
  // composes those two seams to prove a failed self-register → /health
  // registered=false (NOT the pre-fix `() => true` default that reported a
  // never-registered worker as healthy).
  it("a failed verify wires through to /health registered=false (NOT defaulted true)", async () => {
    const pb = makeRegistryPb(null); // upsert swallowed → no row
    const logger = makeLogger();
    const registered = await verifyWorkerRegistered({
      pb,
      workerId: "worker-w",
      logger,
    });
    expect(registered).toBe(false);

    // This is the exact wiring runWorker uses: the verified value, not () => true.
    const healthApp = buildWorkerHealthServer({
      pb: async () => true,
      loopAlive: () => true,
      registered: () => registered,
      logger,
    });
    const res = await healthApp.request("/health");
    const body = (await res.json()) as { registered: boolean };
    expect(res.status).toBe(503);
    expect(body.registered).toBe(false);
  });
});

/**
 * Deregister-FIRST drain ordering (platform-kill hardening).
 *
 * Live Railway redeploys proved the platform's stop grace (~10s after
 * SIGTERM) is SHORT — shorter than the 25s drain grace the worker shipped
 * with (WORKER_DRAIN_GRACE_MS, since lowered to a 6s default so the SERIAL
 * deregister-cap + grace budget fits UNDER the platform window): workers stuck in slow browser-context teardown were HARD-KILLED
 * before the old `await worker.stop()` → deregister sequence ever reached the
 * roster delete, stranding stale rows that fleet-health reclaimed red at its
 * 180s stale mark (the residual deploy red-splash). `drainFleetWorker` is the
 * reordered critical path: signal the drain synchronously, deregister
 * IMMEDIATELY (<1s), and only THEN spend the grace budget on best-effort
 * teardown. These tests compose the REAL fleet `runWorker` handle with the
 * REAL `registerWorker` handle (fake PB/queue/driver) so the ordering under
 * test is the production wiring, not a re-implementation.
 */
describe("drainFleetWorker — deregister-FIRST drain ordering", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const silentFleetLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  const fleetConfig: FleetRoleConfig = { role: "worker", poolCount: 1 };

  const budgetSource = {
    budget: () => ({
      inUse: 0,
      available: 5,
      max: 24,
      pidsCurrent: 10,
      pidsMax: 1000,
    }),
  };

  function makeDrainLease(): JobLease {
    return {
      job: {
        id: "job-drain-1",
        probe_key: "d6:langgraph-python",
        status: "claimed",
        claimed_by: "worker-drain",
        lease_expires_at: "2026-06-04T00:05:00.000Z",
        version: 1,
      },
      payload: {
        probeKey: "d6:langgraph-python",
        serviceSlug: "langgraph-python",
        driverKind: "e2e_d6",
        meta: {
          runId: "run-drain",
          triggered: false,
          enqueuedAt: "2026-06-04T00:00:00.000Z",
        },
      },
      leaseExpiresAt: "2026-06-04T00:05:00.000Z",
    };
  }

  /** A queue fake that hands out ONE claim then reports nothing claimable. */
  function makeDrainQueue(): FleetQueueClient {
    let claimed = false;
    return {
      async enqueue() {
        throw new Error("enqueue not used by worker");
      },
      async claimNext(): Promise<ClaimedJob> {
        if (claimed) return { claimed: false };
        claimed = true;
        return { claimed: true, lease: makeDrainLease() };
      },
      async renewLease() {
        return makeDrainLease();
      },
      async report() {},
      async sweepExpired() {
        return { reclaimed: 0, commErrors: [] };
      },
      async countPendingForFamily(): Promise<number> {
        throw new Error("countPendingForFamily not used by worker");
      },
      async pruneAged() {
        return { terminal: 0, zombie: 0 };
      },
    };
  }

  /**
   * Registration fake PB mirroring registration.test.ts's: records upserts and
   * deletes, plus an ordered `settled` log proving no upsert lands after the
   * delete. `onDelete` lets a test thread the delete into a shared event log.
   */
  function makeRegPb(onDelete?: () => void): {
    pb: RegistrationPbClient;
    deletes: Array<{ collection: string; filter: string }>;
    settled: Array<"upsert" | "delete">;
  } {
    const deletes: Array<{ collection: string; filter: string }> = [];
    const settled: Array<"upsert" | "delete"> = [];
    const pb: RegistrationPbClient = {
      async upsertByField<T>(): Promise<T> {
        settled.push("upsert");
        return {} as T;
      },
      async deleteByFilter(
        collection: string,
        filter: string,
      ): Promise<number> {
        deletes.push({ collection, filter });
        settled.push("delete");
        onDelete?.();
        return 1;
      },
    };
    return { pb, deletes, settled };
  }

  /**
   * A driver whose run HANGS until `release()` and IGNORES the drain abort —
   * the stand-in for the slow browser-context teardown that outlives the
   * platform kill grace. Resolves GREEN on release (worst case for the
   * never-report guarantee).
   */
  function makeWedgedDriver(onSettle?: () => void): {
    driver: ServiceJobDriver;
    started: Promise<void>;
    release: () => void;
    runSettled: () => boolean;
  } {
    let markStarted!: () => void;
    const started = new Promise<void>((res) => {
      markStarted = res;
    });
    let releaseFn!: () => void;
    const released = new Promise<void>((res) => {
      releaseFn = res;
    });
    let settled = false;
    const driver: ServiceJobDriver = {
      async run(ctx: ServiceDriverContext): Promise<ProbeResult> {
        markStarted();
        await released; // deliberately ignores ctx.abortSignal
        settled = true;
        onSettle?.();
        return {
          key: "e2e_d6:langgraph-python",
          state: "green",
          signal: { shape: "package", slug: "langgraph-python" },
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    return {
      driver,
      started,
      release: () => releaseFn(),
      runSettled: () => settled,
    };
  }

  it("reaches the roster delete while a wedged teardown NEVER resolves within the drain (deregister does not gate on teardown)", async () => {
    // Shrink the loop's drain grace so the best-effort teardown phase detaches
    // fast under test (read from env at startWorkerLoop construction).
    vi.stubEnv("WORKER_DRAIN_GRACE_MS", "200");
    const events: string[] = [];
    const { pb, deletes } = makeRegPb(() => events.push("roster-delete"));
    const queue = makeDrainQueue();
    const reportSpy = vi.spyOn(queue, "report");
    const { driver, started, release, runSettled } = makeWedgedDriver(() =>
      events.push("teardown-complete"),
    );

    const worker = await runFleetWorker(fleetConfig, {
      queue,
      workerId: "worker-drain-a",
      skipHealthServer: true,
      budgetSource,
      driver,
      payloadToInput: () => ({ key: "d6:langgraph-python" }),
      logger: silentFleetLogger,
      env: {},
      pollIntervalMs: 1,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });
    const registration = await registerWorker({
      pb,
      pool: budgetSource,
      logger: silentFleetLogger,
      workerId: "worker-drain-a",
      endpoint: "http://worker-drain-a:8080",
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    });

    await started;
    const drainPromise = drainFleetWorker({
      worker,
      registration,
      shutdownPool: async () => {
        events.push("pool-shutdown");
      },
    });

    // THE FIX: the roster delete lands while the wedged run is STILL hung —
    // under the old ordering (await worker.stop() first) this waitFor would
    // time out because deregister sat behind the teardown grace (200ms here;
    // 25s in prod at the time of the live Railway hard-kills).
    await vi.waitFor(() => expect(deletes).toHaveLength(1));
    expect(runSettled()).toBe(false);
    expect(deletes[0]!.filter).toContain("worker-drain-a");

    // The full drain still completes (grace detach), teardown never finished,
    // pool shutdown stays last, and the abandoned job was never reported.
    await drainPromise;
    expect(runSettled()).toBe(false);
    expect(events).toEqual(["roster-delete", "pool-shutdown"]);
    expect(reportSpy).not.toHaveBeenCalled();

    // Cleanup: un-wedge the driver so the loop (and its heartbeat timer) wind
    // down; the second stop() awaits the settled loop.
    release();
    await worker.stop();
  });

  it("deregisters BEFORE teardown completes, never reports the abandoned job, and latches out the post-deregister job-settle heartbeat", async () => {
    // Shrink the drain grace (like test A) so the assertion is insensitive to
    // the default's value and the grace detach stays fast under test.
    vi.stubEnv("WORKER_DRAIN_GRACE_MS", "200");
    const events: string[] = [];
    const { pb, settled } = makeRegPb(() => events.push("roster-delete"));
    const queue = makeDrainQueue();
    const reportSpy = vi.spyOn(queue, "report");
    const { driver, started, release } = makeWedgedDriver(() =>
      events.push("teardown-complete"),
    );

    const registration = await registerWorker({
      pb,
      pool: budgetSource,
      logger: silentFleetLogger,
      workerId: "worker-drain-b",
      endpoint: "http://worker-drain-b:8080",
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    });
    const worker = await runFleetWorker(fleetConfig, {
      queue,
      workerId: "worker-drain-b",
      skipHealthServer: true,
      budgetSource,
      driver,
      payloadToInput: () => ({ key: "d6:langgraph-python" }),
      logger: silentFleetLogger,
      env: {},
      pollIntervalMs: 1,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
      // PRODUCTION WIRING: the job-settle beat is fire-and-forget into the
      // registration handle — after deregister it MUST be latched out or it
      // would re-create the just-deleted roster row.
      onCurrentJobChange: (currentJobId) => {
        void registration.heartbeat(currentJobId);
      },
    });

    await started;
    const drainPromise = drainFleetWorker({
      worker,
      registration,
      shutdownPool: async () => {
        events.push("pool-shutdown");
      },
    });

    // Deregister lands FIRST, while teardown is still hung…
    await vi.waitFor(() => expect(events).toContain("roster-delete"));
    expect(events).not.toContain("teardown-complete");

    // …then the wedged teardown "completes" the run GREEN. The drain signal
    // (not stop() completion) keys the report-skip, so it is still abandoned.
    //
    // GRACE-RACE NOTE: with the 200ms grace stubbed above, stop() either (a)
    // observes the released run settle first, or (b) detaches at grace expiry
    // while the release's microtasks land moments later. BOTH outcomes are
    // safe for the assertions below: the roster delete already happened (so
    // the roster-delete < teardown-complete ordering holds either way), the
    // report-skip keys on the drain SIGNAL (so the green settle is never
    // reported in either branch), and `teardown-complete` is pushed by the
    // driver's own settle, not by stop() resolving.
    release();
    await drainPromise;

    // FINAL QUIESCENCE (vacuous-pass guard): in the grace-DETACH branch of
    // the race note above, drainPromise can resolve while the released run's
    // microtasks — including the fire-and-forget job-settle heartbeat — are
    // still landing. Asserting the `settled` latch immediately could then
    // pass VACUOUSLY, with a late resurrection upsert arriving only after
    // the assertion ran. The second stop() awaits the (released, settling)
    // loop to completion, so every job-settle beat has fired through the
    // latched registration handle before the assertions below.
    await worker.stop();

    expect(events.indexOf("roster-delete")).toBeLessThan(
      events.indexOf("teardown-complete"),
    );
    expect(reportSpy).not.toHaveBeenCalled();
    // The run-settle heartbeat fired AFTER deregister was latched out: the
    // delete is the LAST roster write — no resurrection upsert follows it.
    expect(settled[settled.length - 1]).toBe("delete");
  });

  it("always runs shutdownPool even when worker.stop() rejects (the rejection still surfaces)", async () => {
    // A1: `stop()` is the BEST-EFFORT teardown phase — a rejecting stop must
    // not strand the pool's chromium processes (PID-ceiling compounding). The
    // pool shutdown ALWAYS runs; the stop rejection is surfaced to the caller
    // (the signal handler logs it via signal-drain-failed), never swallowed.
    const shutdownPool = vi.fn(async () => {});
    const registration = {
      stop: vi.fn(),
      deregister: vi.fn(async () => {}),
    };
    const worker = {
      drain: vi.fn(),
      stop: vi.fn(async () => {
        throw new Error("teardown exploded");
      }),
    };

    await expect(
      drainFleetWorker({ worker, registration, shutdownPool }),
    ).rejects.toThrow("teardown exploded");
    // Deregister (unconditional) ran before the failed teardown…
    expect(registration.deregister).toHaveBeenCalledTimes(1);
    // …and the pool shutdown still ran despite the stop rejection.
    expect(shutdownPool).toHaveBeenCalledTimes(1);
  });

  it("surfaces the stop() error — not the pool error — when BOTH stop and shutdownPool reject", async () => {
    // A bare `finally { await shutdownPool() }` MASKS the stop rejection with
    // the pool one when both reject (the later throw wins), contra the
    // surfacing contract above. The stop error is the primary failure: the
    // pool failure is logged best-effort and the stop error is the one thrown.
    const shutdownPool = vi.fn(async () => {
      throw new Error("pool exploded");
    });
    const registration = {
      stop: vi.fn(),
      deregister: vi.fn(async () => {}),
    };
    const worker = {
      drain: vi.fn(),
      stop: vi.fn(async () => {
        throw new Error("teardown exploded");
      }),
    };

    await expect(
      drainFleetWorker({ worker, registration, shutdownPool }),
    ).rejects.toThrow("teardown exploded");
    expect(shutdownPool).toHaveBeenCalledTimes(1);
  });

  it("bounds a HUNG deregister: teardown and pool shutdown are still reached at DRAIN_DEREGISTER_TIMEOUT_MS", async () => {
    // A HUNG — not failing — PocketBase must not consume Railway's ~10s kill
    // window: the deregister await is raced against a bound; on timeout the
    // drain logs `fleet.worker.deregister-timeout` and PROCEEDS to teardown
    // (the roster row strands, degrading to the documented crash-path
    // reclaim). Pre-fix this drain hung forever on the unresolved deregister.
    vi.useFakeTimers();
    try {
      const shutdownPool = vi.fn(async () => {});
      const stop = vi.fn(async () => {});
      const registration = {
        stop: vi.fn(),
        // Never settles — the wedged-PB stand-in.
        deregister: vi.fn(() => new Promise<void>(() => {})),
      };

      const drainPromise = drainFleetWorker({
        worker: { drain: vi.fn(), stop },
        registration,
        shutdownPool,
      });
      await vi.advanceTimersByTimeAsync(DRAIN_DEREGISTER_TIMEOUT_MS);
      await expect(drainPromise).resolves.toBeUndefined();
      expect(stop).toHaveBeenCalledTimes(1);
      expect(shutdownPool).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a deregister that rejects AFTER the timeout wins never surfaces as an unhandled rejection (race losers stay subscribed)", async () => {
    // EMPIRICAL PIN of the ECMAScript Promise.race semantics this drain (and
    // the loop's stop() grace race) relies on — repeatedly re-flagged in
    // review, so this test is the standing refutation: `Promise.race`
    // SUBSCRIBES to every input when it is constructed, so a LOSER that
    // rejects after the winner settled is a HANDLED rejection (consumed by
    // the race's own subscription), never an unhandled one. vitest surfaces
    // unhandled rejections as failures, so the pin is non-vacuous: the test
    // deliberately attaches NO handler of its own to the losing deregister —
    // if the race did not keep it subscribed, the late rejection below would
    // fail this run.
    vi.useFakeTimers();
    let rejectDeregister!: (err: Error) => void;
    try {
      const shutdownPool = vi.fn(async () => {});
      const registration = {
        stop: vi.fn(),
        // Hangs past the cap, then REJECTS only after the timeout arm won.
        deregister: vi.fn(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectDeregister = reject;
            }),
        ),
      };

      const drainPromise = drainFleetWorker({
        worker: { drain: vi.fn(), stop: vi.fn(async () => {}) },
        registration,
        shutdownPool,
      });
      // The deregister cap elapses → the timeout arm wins and the drain runs
      // through teardown to completion.
      await vi.advanceTimersByTimeAsync(DRAIN_DEREGISTER_TIMEOUT_MS);
      await expect(drainPromise).resolves.toBeUndefined();
      expect(shutdownPool).toHaveBeenCalledTimes(1);
      // NOW the losing deregister rejects, 50ms after the race settled.
      await vi.advanceTimersByTimeAsync(50);
      rejectDeregister(new Error("post-timeout deregister rejection"));
    } finally {
      vi.useRealTimers();
    }
    // Give the would-be unhandledRejection a real macrotask turn to surface —
    // an unsubscribed loser would fail the run here, not pass silently.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("a THROWING structural drain()/registration.stop() never skips the roster delete (log-and-proceed)", async () => {
    // `worker.drain()` and `registration.stop()` are structural handles — the
    // REAL ones never throw, but drainFleetWorker sits on the SIGTERM
    // critical path, so a throwing caller-supplied handle gets the same
    // log-and-proceed discipline as deregister: the roster delete is the ONLY
    // step that must beat the platform kill, and a throw upstream of it must
    // not abort the drain sequence. Pre-fix both calls were unguarded — a
    // throw here escaped drainFleetWorker before deregister ever ran.
    const shutdownPool = vi.fn(async () => {});
    const stop = vi.fn(async () => {});
    const registration = {
      stop: vi.fn(() => {
        throw new Error("registration.stop exploded");
      }),
      deregister: vi.fn(async () => {}),
    };
    const worker = {
      drain: vi.fn(() => {
        throw new Error("drain exploded");
      }),
      stop,
    };

    await expect(
      drainFleetWorker({ worker, registration, shutdownPool }),
    ).resolves.toBeUndefined();
    // The roster delete still landed despite BOTH structural steps throwing…
    expect(registration.deregister).toHaveBeenCalledTimes(1);
    // …and the best-effort teardown phases still ran, in order.
    expect(stop).toHaveBeenCalledTimes(1);
    expect(shutdownPool).toHaveBeenCalledTimes(1);
  });

  it("a THROWING logger.warn inside the drain's catch blocks never skips the roster delete or teardown", async () => {
    // The failing component may BE the logger: the structural-throw catches
    // above LOG before proceeding, so an unguarded logger.warn inside either
    // pre-deregister catch would escape drainFleetWorker before the roster
    // delete ever ran — the exact failure class requestDrain() already
    // guards with its abort-before-log discipline. The post-deregister warns
    // are guarded the same way so the teardown phases stay reachable too.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {
      throw new Error("logger exploded");
    });
    try {
      const shutdownPool = vi.fn(async () => {});
      const stop = vi.fn(async () => {});
      const registration = {
        stop: vi.fn(() => {
          throw new Error("registration.stop exploded");
        }),
        deregister: vi.fn(async () => {}),
      };
      const worker = {
        drain: vi.fn(() => {
          throw new Error("drain exploded");
        }),
        stop,
      };

      await expect(
        drainFleetWorker({ worker, registration, shutdownPool }),
      ).resolves.toBeUndefined();
      // The roster delete still landed despite BOTH structural steps throwing
      // AND the logger throwing inside both catch blocks…
      expect(registration.deregister).toHaveBeenCalledTimes(1);
      // …and the best-effort teardown phases still ran, in order.
      expect(stop).toHaveBeenCalledTimes(1);
      expect(shutdownPool).toHaveBeenCalledTimes(1);
      // The warns were ATTEMPTED (forensics stay best-effort, not skipped).
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("a REJECTING deregister (structural-contract caller) degrades like the timeout: teardown still runs", async () => {
    // registration.ts's deregister() contract is never-reject (failed deletes
    // are swallowed + warned there) — but drainFleetWorker takes a structural
    // `{ deregister(): Promise<void> }`, so a caller-supplied handle that DOES
    // reject must degrade the same way the hang does: proceed to teardown.
    const shutdownPool = vi.fn(async () => {});
    const stop = vi.fn(async () => {});
    const registration = {
      stop: vi.fn(),
      deregister: vi.fn(async () => {
        throw new Error("pb exploded");
      }),
    };

    await expect(
      drainFleetWorker({
        worker: { drain: vi.fn(), stop },
        registration,
        shutdownPool,
      }),
    ).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(shutdownPool).toHaveBeenCalledTimes(1);
  });

  it("idle drain (no in-flight job): deregister still precedes teardown, abandons nothing, completes promptly", async () => {
    vi.stubEnv("WORKER_DRAIN_GRACE_MS", "200");
    const events: string[] = [];
    const { pb, deletes } = makeRegPb(() => events.push("roster-delete"));
    // A queue that never has work — the worker stays idle the whole time.
    const queue: FleetQueueClient = {
      ...makeDrainQueue(),
      claimNext: async () => ({ claimed: false }),
    };
    const run = vi.fn(async (): Promise<ProbeResult> => {
      throw new Error("driver must never run on an idle drain");
    });
    const info = vi.fn();
    const recordingLogger = { ...silentFleetLogger, info };

    const worker = await runFleetWorker(fleetConfig, {
      queue,
      workerId: "worker-drain-idle",
      skipHealthServer: true,
      budgetSource,
      driver: { run },
      payloadToInput: () => ({ key: "d6:langgraph-python" }),
      logger: recordingLogger,
      env: {},
      pollIntervalMs: 1,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });
    const registration = await registerWorker({
      pb,
      pool: budgetSource,
      logger: silentFleetLogger,
      workerId: "worker-drain-idle",
      endpoint: "http://worker-drain-idle:8080",
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    });

    // An idle drain has nothing to wait on: it must complete promptly (well
    // under the grace), with the same deregister-before-teardown ordering.
    await expect(
      Promise.race([
        drainFleetWorker({
          worker,
          registration,
          shutdownPool: async () => {
            events.push("pool-shutdown");
          },
        }),
        new Promise<never>((_res, rej) =>
          setTimeout(
            () => rej(new Error("idle drain did not complete promptly")),
            1000,
          ),
        ),
      ]),
    ).resolves.toBeUndefined();

    expect(run).not.toHaveBeenCalled();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.filter).toContain("worker-drain-idle");
    expect(events).toEqual(["roster-delete", "pool-shutdown"]);
    // The abandon decision records NO job — the worker was idle.
    expect(info).toHaveBeenCalledWith("fleet.worker.drain-requested", {
      workerId: "worker-drain-idle",
      abandoningJobId: null,
    });
  });
});

/**
 * CR-FIX #1: runControlPlane must handle an ASYNC bind failure.
 *
 * serve()/server.listen() emits bind errors (EADDRINUSE) ASYNCHRONOUSLY. Pre-fix
 * runControlPlane only had a synchronous try/catch around serve(), so an async
 * bind failure resolved runControlPlane() "successfully" while leaving the
 * scheduler, control-plane consumer loop, and fleet-health interval orphaned.
 * The fix mirrors boot()'s R4-A.3 listening-vs-error race and tears those down
 * on the error path. This test mocks serve() to emit 'error' asynchronously
 * (mirroring the boot() R4-A.3 test) and asserts runControlPlane rejects AND
 * the scheduler is stopped.
 */
describe("orchestrator runControlPlane async bind error cleanup (CR-FIX #1)", () => {
  let port = 0;

  beforeEach(async () => {
    port = await pickPort();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("rejects runControlPlane AND stops the scheduler when serve() emits 'error' asynchronously", async () => {
    vi.resetModules();

    const stopSpy = vi.fn(async () => undefined);
    vi.doMock("./scheduler/scheduler.js", async () => {
      const actual = await vi.importActual<
        typeof import("./scheduler/scheduler.js")
      >("./scheduler/scheduler.js");
      return {
        ...actual,
        createScheduler: (
          deps: Parameters<typeof actual.createScheduler>[0],
        ) => {
          const real = actual.createScheduler(deps);
          return {
            ...real,
            stop: async (...args: unknown[]) => {
              stopSpy();
              return (real.stop as (...a: unknown[]) => Promise<void>)(...args);
            },
          };
        },
      };
    });

    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return {
        ...actual,
        serve: () => {
          const listeners: Record<string, Array<(...a: unknown[]) => void>> = {
            error: [],
            listening: [],
          };
          const stub = {
            listening: false,
            once(event: string, cb: (...a: unknown[]) => void) {
              listeners[event] ??= [];
              listeners[event].push(cb);
              return stub;
            },
            on(event: string, cb: (...a: unknown[]) => void) {
              listeners[event] ??= [];
              listeners[event].push(cb);
              return stub;
            },
            removeListener(event: string, cb: (...a: unknown[]) => void) {
              const arr = listeners[event];
              if (arr) {
                const i = arr.indexOf(cb);
                if (i >= 0) arr.splice(i, 1);
              }
              return stub;
            },
            close(cb?: (err?: Error) => void) {
              if (cb) cb();
              return stub;
            },
          };
          setTimeout(() => {
            const errs = listeners.error.slice();
            for (const cb of errs)
              cb(new Error("simulated EADDRINUSE from async listen()"));
          }, 0);
          return stub as unknown as ReturnType<typeof actual.serve>;
        },
      };
    });

    const orchMod = await import("./orchestrator.js");

    await expect(
      orchMod.runControlPlane(
        { role: "control-plane", poolCount: 1 },
        { port },
      ),
    ).rejects.toThrow(/simulated EADDRINUSE from async listen\(\)/);

    // Critical: the scheduler must have been stopped as part of teardown.
    // Pre-fix the async bind error was unobserved and runControlPlane resolved
    // with the scheduler (and fleet-health interval) still running.
    //
    // `teardownAfterBindFailure` is fire-and-forget on the error path (operators
    // see the original bind error, not a stop-failure shadow), and it awaits
    // `controlPlane.stop()` — which now unregisters FOUR producer schedules —
    // BEFORE `scheduler.stop()`. So the rejection above can resolve a few
    // microtasks ahead of `scheduler.stop()`; poll until teardown settles
    // rather than asserting synchronously (avoids a timing-dependent flake).
    await vi.waitFor(() => expect(stopSpy).toHaveBeenCalled());
  });
});

/**
 * REQ-B wiring (control-plane integration): a swept/lease-expired job's
 * `worker-crashed-mid-job` overlay must reach the `d6:<slug>` dashboard status
 * row through `runControlPlane`'s wiring.
 *
 * The control-plane MODULE seams exist (the producer forwards swept comm errors
 * to an injected `onSweepCommErrors` sink; `createControlPlane` exposes
 * `surfaceSweepCommErrors` which resolves each error's `d6:<slug>` key via an
 * injected `resolveSweepAggregateKey` and writes the overlay through the
 * aggregator), but pre-wiring `runControlPlane` did NOT connect them — the
 * producer was built with no sink and `createControlPlane` received no
 * aggregator/resolver, so the crash-path overlay was INERT.
 *
 * This drives a real swept job through `runControlPlane`'s assembly: the queue's
 * `sweepExpired` yields one comm error (jobId `job-swept-1`), pb resolves that
 * job row to `probe_key = d6:swept-svc`, and the producer tick (the registered
 * scheduler handler) runs the sweep. The assertion is that the comm-error
 * overlay landed on the `d6:swept-svc` status row via the status-writer. Against
 * the unwired state this never fires (no sink, no resolver); once wired it does.
 */
describe("orchestrator runControlPlane REQ-B sweep wiring (control-plane integration)", () => {
  let port = 0;

  beforeEach(async () => {
    port = await pickPort();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    // resetModules clears the module CACHE, not the doMock REGISTRY — drop
    // every specifier this describe doMocks so later describes don't import
    // these stubs by registration-order luck.
    vi.doUnmock("@hono/node-server");
    vi.doUnmock("./fleet/queue-client.js");
    vi.doUnmock("./storage/pb-client.js");
    vi.doUnmock("./writers/status-writer.js");
    vi.doUnmock("./probes/run-history.js");
    vi.doUnmock("./scheduler/scheduler.js");
  });

  it("surfaces a swept job's worker-crashed overlay onto its d6:<slug> status row", async () => {
    vi.resetModules();

    // Immunize against a sibling test's leaked `@hono/node-server` doMock (the
    // async-bind tests register a serve() stub that rejects via setTimeout): we
    // need the REAL serve() so this role binds cleanly and the producer tick can
    // run. vi.doMock registrations persist across the file, so pin it explicitly.
    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });

    const sweptCommError: PoolCommError = {
      kind: "worker-crashed-mid-job",
      message: "lease expired; worker presumed crashed",
      workerId: "worker-dead",
      jobId: "job-swept-1",
      observedAt: "2026-06-04T00:00:00.000Z",
    };

    // Queue fake: sweepExpired yields the swept comm error exactly once (the
    // producer's first tick sweeps because lastSweepAt is null). enqueue is a
    // no-op (the enumerator is empty), claimNext/renew/report are unused here.
    vi.doMock("./fleet/queue-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./fleet/queue-client.js")
      >("./fleet/queue-client.js");
      let swept = false;
      return {
        ...actual,
        createFleetQueueClient: () => ({
          enqueue: async () => ({}) as never,
          claimNext: async () => ({ claimed: false }) as never,
          renewLease: async () => null,
          report: async () => undefined,
          sweepExpired: async () => {
            if (swept) return { reclaimed: 0, commErrors: [] };
            swept = true;
            return { reclaimed: 1, commErrors: [sweptCommError] };
          },
          countPendingForFamily: async () => 0,
        }),
      };
    });

    // pb fake: getOne(probe_jobs, "job-swept-1") resolves the swept job's
    // probe_key (the resolveSweepAggregateKey lookup); getFirst(status, ...)
    // is the "never observed" path. health() true so the role boots clean.
    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async (_collection: string, id: string) =>
            id === "job-swept-1" ? { probe_key: "d6:swept-svc" } : null,
          getFirst: async () => null,
        }),
      };
    });

    // Capture every status-writer write so we can assert the overlay landed on
    // the d6:<slug> row. This leg is never-observed (pb getFirst → null), so
    // writeOverlay is not taken; the stub still satisfies the interface.
    const writes: ProbeResult<unknown>[] = [];
    vi.doMock("./writers/status-writer.js", async () => {
      const actual = await vi.importActual<
        typeof import("./writers/status-writer.js")
      >("./writers/status-writer.js");
      return {
        ...actual,
        // The `(): StatusWriter` annotation makes tsc enforce the real
        // WriteOutcome contract on the stub (the round-8 fix completed the
        // writeOverlay shapes but left `write` returning undefined).
        createStatusWriter: (): StatusWriter => ({
          write: async (r: ProbeResult<unknown>) => {
            writes.push(r);
            // Contract-honest shape, mirroring the real writer's
            // first-observation outcome: `newState` carries the written state
            // end-to-end and `persisted` is required + truthful.
            return {
              previousState: null,
              newState: r.state,
              transition: "first",
              firstFailureAt: null,
              failCount: 0,
              persisted: true,
            };
          },
          writeOverlay: async (): Promise<OverlayWriteOutcome> => ({
            applied: false,
            state: null,
            // The real writer ALWAYS stamps historyPersisted (optional at the
            // type level only for best-effort wrappers); applied:false from
            // the real writer is always historyPersisted:false.
            historyPersisted: false,
          }),
        }),
      };
    });

    // run-history writer is irrelevant to the sweep leg; stub it so the
    // aggregator constructs without a real PB run-history collection.
    vi.doMock("./probes/run-history.js", async () => {
      const actual = await vi.importActual<
        typeof import("./probes/run-history.js")
      >("./probes/run-history.js");
      return {
        ...actual,
        createProbeRunWriter: () => ({
          findByJobId: async () => null,
          start: async () => ({}) as never,
          finishTerminal: async () => undefined,
        }),
      };
    });

    // Capture the producer's scheduler handler so we can drive a tick (which
    // runs the sweep) deterministically without waiting on cron.
    let producerHandler: (() => Promise<unknown>) | undefined;
    vi.doMock("./scheduler/scheduler.js", async () => {
      const actual = await vi.importActual<
        typeof import("./scheduler/scheduler.js")
      >("./scheduler/scheduler.js");
      return {
        ...actual,
        createScheduler: (
          deps: Parameters<typeof actual.createScheduler>[0],
        ) => {
          const real = actual.createScheduler(deps);
          return {
            ...real,
            register: (entry: {
              id: string;
              cron: string;
              handler: () => Promise<unknown>;
            }) => {
              // Capture the d6 producer's (`fleet-job-producer`) handler
              // specifically — all four producers share the REQ-B
              // `onSweepCommErrors` sink (the non-d6 leg is covered by the
              // sink fan-out sibling below); the other three browser-family
              // producer schedules + `probe:*` HTTP entries also register here.
              if (entry.id === FLEET_PRODUCER_SCHEDULE_ID) {
                producerHandler = entry.handler;
              }
              return (real.register as (...a: unknown[]) => unknown)(entry);
            },
          };
        },
      };
    });

    const orchMod = await import("./orchestrator.js");

    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      // Empty enumerator → no enqueue churn; the sweep still runs on tick.
      { port, fleetEnumerate: async () => [] },
    );

    try {
      expect(producerHandler).toBeDefined();
      // Drive one producer tick → maybeSweep → onSweepCommErrors →
      // surfaceSweepCommErrors → resolveSweepAggregateKey → aggregateCommError.
      await producerHandler!();

      const overlayWrite = writes.find((w) => w.key === "d6:swept-svc");
      expect(overlayWrite).toBeDefined();
      const signal = overlayWrite!.signal as Record<string, unknown>;
      const overlay = signal[FLEET_COMM_ERROR_SIGNAL_KEY] as
        | PoolCommError
        | undefined;
      expect(overlay).toBeDefined();
      expect(overlay!.kind).toBe("worker-crashed-mid-job");
      expect(overlay!.jobId).toBe("job-swept-1");
    } finally {
      await handle.stop();
    }
  });
});

/**
 * REQ-B sweep-sink fan-out: a sweep performed by a NON-d6 producer must ALSO
 * forward its comm errors to the aggregator.
 *
 * All four family producers run the same GLOBAL `queue.sweepExpired` on their
 * own crons, and the sweep's S0 CAS means whichever producer sweeps FIRST wins
 * each expired job's reclaim — and with it the synthesized
 * `worker-reclaimed-pending` comm error. The job-producer's `maybeSweep`
 * forwards those errors only when its `onSweepCommErrors` sink is wired, so a
 * producer built WITHOUT the sink silently DROPS them. With only d6 wired
 * (hourly @ :40) and smoke/demos/deep sweeping far more often (every-15min,
 * :10 hourly, and :05/:20/:35/:50), the reclaim overlay was dropped ~11 of 12
 * sweeps.
 *
 * This drives the SMOKE producer's tick (scheduler entry
 * `FLEET_PRODUCER_SMOKE_SCHEDULE_ID`) through `runControlPlane`'s real
 * assembly and asserts the swept overlay lands on the job's `d6:<slug>` status
 * row. RED against d6-only wiring (the smoke producer has no sink); GREEN once
 * all four producers share the control-plane sink.
 */
describe("orchestrator runControlPlane REQ-B sweep wiring — non-d6 producer (sink fan-out)", () => {
  let port = 0;

  beforeEach(async () => {
    port = await pickPort();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("surfaces a swept job's overlay when the SMOKE producer performs the sweep", async () => {
    vi.resetModules();

    // SELF-CONTAINED MOCK SET: `vi.doMock` factories registered by sibling
    // tests persist for the rest of the file (resetModules clears the module
    // CACHE, not the mock REGISTRY), so explicitly unmock every module this
    // test touches before re-mocking — the test must pass in isolation AND in
    // file order regardless of which siblings leaked factories.
    vi.doUnmock("@hono/node-server");
    vi.doUnmock("./fleet/queue-client.js");
    vi.doUnmock("./storage/pb-client.js");
    vi.doUnmock("./storage/s3-backup.js");
    vi.doUnmock("./writers/status-writer.js");
    vi.doUnmock("./probes/run-history.js");
    vi.doUnmock("./scheduler/scheduler.js");
    vi.doUnmock("./fleet/control-plane/result-consumer.js");
    vi.doUnmock("./events/event-bus.js");
    vi.doUnmock("./probes/loader/probe-loader.js");

    // The smoke/demos/deep producers always use their REAL catalog enumerators
    // (`opts.fleetEnumerate` is a d6-ONLY test seam), so inject an empty
    // roster via the LOCAL_SERVICES_JSON local-injection seam — the smoke tick
    // enumerates [] without Railway creds, and `maybeSweep` runs regardless of
    // what enumeration yields.
    vi.stubEnv("LOCAL_SERVICES_JSON", "[]");

    // We need the REAL serve() so this role binds cleanly and the producer
    // tick can run — pin it (the async-bind siblings leak a rejecting stub).
    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });

    const sweptCommError: PoolCommError = {
      kind: "worker-crashed-mid-job",
      message: "lease expired; worker presumed crashed",
      workerId: "worker-dead",
      jobId: "job-swept-smoke",
      observedAt: "2026-06-10T00:00:00.000Z",
    };

    // Queue fake: sweepExpired yields the swept comm error exactly once — to
    // WHICHEVER producer sweeps first; this test only drives the SMOKE
    // producer's tick, so the smoke producer wins the sweep.
    vi.doMock("./fleet/queue-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./fleet/queue-client.js")
      >("./fleet/queue-client.js");
      let swept = false;
      return {
        ...actual,
        createFleetQueueClient: () => ({
          enqueue: async () => ({}) as never,
          claimNext: async () => ({ claimed: false }) as never,
          renewLease: async () => null,
          report: async () => undefined,
          sweepExpired: async () => {
            if (swept) return { reclaimed: 0, commErrors: [] };
            swept = true;
            return { reclaimed: 1, commErrors: [sweptCommError] };
          },
          countPendingForFamily: async () => 0,
        }),
      };
    });

    // pb fake: getOne(probe_jobs, "job-swept-smoke") resolves the swept job's
    // probe_key (the resolveSweepAggregateKey lookup); getFirst(status, ...)
    // is the "never observed" path. health() true so the role boots clean.
    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async (_collection: string, id: string) =>
            id === "job-swept-smoke"
              ? { probe_key: "d6:swept-svc-smoke" }
              : null,
          getFirst: async () => null,
        }),
      };
    });

    // Capture every status-writer overlay so we can assert the overlay landed
    // on the d6:<slug> row. Aggregator routes comm errors through writeOverlay
    // (H1 path); `write` is unused by this leg but provided for the interface.
    const writes: Array<{
      key: string;
      signal: Record<string, unknown>;
      observedAt: string;
    }> = [];
    vi.doMock("./writers/status-writer.js", async () => {
      const actual = await vi.importActual<
        typeof import("./writers/status-writer.js")
      >("./writers/status-writer.js");
      return {
        ...actual,
        createStatusWriter: () => ({
          write: async (_r: ProbeResult<unknown>) => undefined,
          writeOverlay: async (o: {
            key: string;
            signal: Record<string, unknown>;
            observedAt: string;
          }): Promise<OverlayWriteOutcome> => {
            writes.push(o);
            return { applied: true, state: null, historyPersisted: true };
          },
        }),
      };
    });

    // run-history writer is irrelevant to the sweep leg; stub it so the
    // aggregator constructs without a real PB run-history collection.
    vi.doMock("./probes/run-history.js", async () => {
      const actual = await vi.importActual<
        typeof import("./probes/run-history.js")
      >("./probes/run-history.js");
      return {
        ...actual,
        createProbeRunWriter: () => ({
          findByJobId: async () => null,
          start: async () => ({}) as never,
          finishTerminal: async () => undefined,
        }),
      };
    });

    // Capture the SMOKE producer's scheduler handler so we can drive ITS tick
    // (which runs the sweep) deterministically without waiting on cron.
    let smokeHandler: (() => Promise<unknown>) | undefined;
    vi.doMock("./scheduler/scheduler.js", async () => {
      const actual = await vi.importActual<
        typeof import("./scheduler/scheduler.js")
      >("./scheduler/scheduler.js");
      return {
        ...actual,
        createScheduler: (
          deps: Parameters<typeof actual.createScheduler>[0],
        ) => {
          const real = actual.createScheduler(deps);
          return {
            ...real,
            register: (entry: {
              id: string;
              cron: string;
              handler: () => Promise<unknown>;
            }) => {
              // Capture the NON-d6 smoke producer's handler specifically —
              // the d6 `fleet-job-producer`, the other two browser-family
              // schedules, and the `probe:*` HTTP entries also register here.
              if (entry.id === FLEET_PRODUCER_SMOKE_SCHEDULE_ID) {
                smokeHandler = entry.handler;
              }
              return (real.register as (...a: unknown[]) => unknown)(entry);
            },
          };
        },
      };
    });

    const orchMod = await import("./orchestrator.js");

    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      // Empty d6 enumerator → no d6 enqueue churn (the smoke enumerator is
      // emptied via LOCAL_SERVICES_JSON above).
      { port, fleetEnumerate: async () => [] },
    );

    try {
      expect(smokeHandler).toBeDefined();
      // Drive one SMOKE producer tick → maybeSweep → onSweepCommErrors →
      // surfaceSweepCommErrors → resolveSweepAggregateKey → aggregateCommError.
      await smokeHandler!();

      const overlayWrite = writes.find((w) => w.key === "d6:swept-svc-smoke");
      expect(overlayWrite).toBeDefined();
      const signal = overlayWrite!.signal as Record<string, unknown>;
      const overlay = signal[FLEET_COMM_ERROR_SIGNAL_KEY] as
        | PoolCommError
        | undefined;
      expect(overlay).toBeDefined();
      expect(overlay!.kind).toBe("worker-crashed-mid-job");
      expect(overlay!.jobId).toBe("job-swept-smoke");
    } finally {
      await handle.stop();
    }
  });
});

/**
 * REQ-B worker-self-report wiring: `runControlPlane` must pass its
 * `resolvePriorState` resolver into `createResultAggregator`, not only into
 * `createControlPlane`.
 *
 * The aggregator's `aggregate()` leg preserves the prior observed colour on a
 * worker-self-report comm error (aggregateState:"error" + commError) — BUT only
 * if it was constructed WITH `resolvePriorState`. Pre-wiring, `runControlPlane`
 * built the aggregator with `{ statusWriter, runWriter, logger, now }` and NO
 * resolver, so the self-report leg fell back to the "degraded" no-data colour
 * and STOMPED a previously-RED service to degraded. The sibling sweep-wiring
 * test above only exercises `aggregateCommError` (the crash leg, fed through
 * `createControlPlane`); nothing proved the `aggregate()` leg got the resolver.
 *
 * This drives a real worker-self-report result through `runControlPlane`'s
 * assembled aggregator (captured at the `createResultConsumer` seam, where the
 * orchestrator injects the very aggregator it built). pb's `getFirst(status,…)`
 * resolves the service's prior row to state:"red". The assertion is that the
 * primary status write lands state:"red" + the comm-error overlay — NOT
 * degraded, NOT green. Against the unwired aggregator the resolver is absent and
 * the row writes "degraded"; once wired it preserves "red".
 */
describe("orchestrator runControlPlane REQ-B worker-self-report wiring (aggregate leg prior-colour)", () => {
  let port = 0;

  beforeEach(async () => {
    port = await pickPort();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    // resetModules clears the module CACHE, not the doMock REGISTRY — drop
    // every specifier this describe doMocks so later describes don't import
    // these stubs by registration-order luck.
    vi.doUnmock("@hono/node-server");
    vi.doUnmock("./fleet/queue-client.js");
    vi.doUnmock("./storage/pb-client.js");
    vi.doUnmock("./writers/status-writer.js");
    vi.doUnmock("./probes/run-history.js");
    vi.doUnmock("./fleet/control-plane/result-consumer.js");
  });

  it("preserves a previously-RED service's colour on a worker-self-report comm error (not degraded)", async () => {
    vi.resetModules();

    // Pin the REAL serve() (immunize against a sibling test's leaked
    // @hono/node-server doMock) so this role binds cleanly.
    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });

    const selfReportCommError: PoolCommError = {
      kind: "worker-protocol-violation",
      message: "worker could not reach the pool mid-run",
      workerId: "worker-1",
      jobId: "job-selfreport-1",
      observedAt: "2026-06-04T00:00:05.000Z",
    };

    // Queue fake: no sweep churn — this leg is the consumer, not the producer.
    vi.doMock("./fleet/queue-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./fleet/queue-client.js")
      >("./fleet/queue-client.js");
      return {
        ...actual,
        createFleetQueueClient: () => ({
          enqueue: async () => ({}) as never,
          claimNext: async () => ({ claimed: false }) as never,
          renewLease: async () => null,
          report: async () => undefined,
          sweepExpired: async () => ({ reclaimed: 0, commErrors: [] }),
          countPendingForFamily: async () => 0,
        }),
      };
    });

    // pb fake: getFirst(status, key=d6:selfreport-svc) returns a prior RED row
    // so the wired resolvePriorState reads "red"; getOne unused on this leg;
    // health() true so the role boots clean.
    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async () => null,
          getFirst: async (collection: string, filter: string) => {
            if (
              collection === "status" &&
              filter.includes("d6:selfreport-svc")
            ) {
              return { state: "red" as State };
            }
            return null;
          },
        }),
      };
    });

    // Capture both status-writer seams: with the resolver wired, the
    // observed-prior-colour self-report leg routes through the H1 overlay
    // path (writeOverlay), preserving the row's durable state/attribution.
    const writes: ProbeResult<unknown>[] = [];
    const overlays: {
      key: string;
      signal: Record<string, unknown>;
      observedAt: string;
    }[] = [];
    vi.doMock("./writers/status-writer.js", async () => {
      const actual = await vi.importActual<
        typeof import("./writers/status-writer.js")
      >("./writers/status-writer.js");
      return {
        ...actual,
        // The `(): StatusWriter` annotation makes tsc enforce the real
        // WriteOutcome contract on the stub (the round-8 fix completed the
        // writeOverlay shapes but left `write` returning undefined).
        createStatusWriter: (): StatusWriter => ({
          write: async (r: ProbeResult<unknown>) => {
            writes.push(r);
            // Contract-honest shape, mirroring the real writer's
            // first-observation outcome: `newState` carries the written state
            // end-to-end and `persisted` is required + truthful.
            return {
              previousState: null,
              newState: r.state,
              transition: "first",
              firstFailureAt: null,
              failCount: 0,
              persisted: true,
            };
          },
          writeOverlay: async (o: {
            key: string;
            signal: Record<string, unknown>;
            observedAt: string;
          }): Promise<OverlayWriteOutcome> => {
            overlays.push(o);
            // Full-success shape: the real writer stamps historyPersisted on
            // EVERY outcome (true here — overlay + audit row both landed).
            return { applied: true, state: "red", historyPersisted: true };
          },
        }),
      };
    });

    // run-history writer is irrelevant to the carried-colour assertion; stub it
    // so the aggregator constructs and aggregate() runs end-to-end.
    vi.doMock("./probes/run-history.js", async () => {
      const actual = await vi.importActual<
        typeof import("./probes/run-history.js")
      >("./probes/run-history.js");
      return {
        ...actual,
        createProbeRunWriter: () => ({
          findByJobId: async () => null,
          start: async () => ({ id: "run-selfreport-1" }) as never,
          finish: async () => undefined,
          finishTerminal: async () => undefined,
        }),
      };
    });

    // Capture the aggregator the orchestrator injects into the consumer — this
    // is the very aggregator built by createResultAggregator, so invoking its
    // aggregate() exercises runControlPlane's real wiring (incl. resolvePriorState).
    let injectedAggregator:
      | import("./fleet/control-plane/result-aggregator.js").ResultAggregator
      | undefined;
    vi.doMock("./fleet/control-plane/result-consumer.js", async () => {
      const actual = await vi.importActual<
        typeof import("./fleet/control-plane/result-consumer.js")
      >("./fleet/control-plane/result-consumer.js");
      return {
        ...actual,
        createResultConsumer: (
          deps: Parameters<typeof actual.createResultConsumer>[0],
        ) => {
          injectedAggregator = deps.aggregator;
          return { consumeOnce: async () => ({}) as never };
        },
      };
    });

    const orchMod = await import("./orchestrator.js");

    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      { port, fleetEnumerate: async () => [] },
    );

    try {
      expect(injectedAggregator).toBeDefined();

      // A worker-self-report comm error on a service whose worker could not
      // reach the pool: aggregateState:"error" + a commError. With the resolver
      // wired, aggregate() reads the prior RED row and carries "red".
      await injectedAggregator!.aggregate({
        jobId: "job-selfreport-1",
        serviceSlug: "selfreport-svc",
        driverKind: "e2e_d6",
        aggregateKey: "d6:selfreport-svc",
        aggregateState: "error",
        aggregateSignal: { failedCount: 0 },
        cells: [],
        rollup: { total: 0, passed: 0, failed: 0 },
        commError: selfReportCommError,
      } as never);

      // With the resolver wired, the prior-RED service routes through the H1
      // overlay path — NOT a degraded no-data write() (which is what an
      // unwired aggregator would produce), and NOT a same-state red re-write.
      expect(writes.find((w) => w.key === "d6:selfreport-svc")).toBeUndefined();
      const primary = overlays.find((o) => o.key === "d6:selfreport-svc");
      expect(primary).toBeDefined();
      // The comm-error overlay still rides on the row the dashboard reads.
      const overlay = primary!.signal[FLEET_COMM_ERROR_SIGNAL_KEY] as
        | PoolCommError
        | undefined;
      expect(overlay).toBeDefined();
      expect(overlay!.kind).toBe("worker-protocol-violation");
      expect(overlay!.jobId).toBe("job-selfreport-1");
    } finally {
      await handle.stop();
    }
  });
});

/**
 * In-process HTTP-only probe families on the fleet control-plane.
 *
 * The control-plane runs the 8 HTTP-only probe families (smoke, starter_smoke,
 * image_drift, qa, aimock_wiring, version_drift, pin_drift,
 * redirect_decommission) IN-PROCESS, alongside the d6 producer. These tests
 * pin that behavior:
 *
 *   1. `runControlPlane` loads `config/probes/*.yml`, partitions by
 *      `BROWSER_KINDS`, and registers ONLY the HTTP-kind families on its own
 *      scheduler under `probe:<id>` entries, with crons taken FROM the YAML
 *      `schedule`. Browser kinds (e2e_*) are NOT scheduled in-process — they
 *      route through the worker producer path.
 *   2. /health's `rules` count reflects the REAL in-process HTTP probe count
 *      so a zero-probe load is OBSERVABLE in the /health JSON body. The role
 *      still DROPS the `rules>0` gate, so `status` stays ok regardless (the
 *      count is for dashboards/alerting visibility, not container liveness);
 *      `schedulerJobs` includes the probe entries.
 *
 * The probe config dir is the sibling `../probes` of `opts.configDir` (same
 * resolution boot() uses), so the test writes a temp alerts dir + sibling
 * probes dir containing HTTP families (smoke, image_drift, qa — the last a
 * discovery-backed family) plus one BROWSER family (e2e_smoke) to prove the
 * partition.
 */
describe("orchestrator runControlPlane in-process HTTP probes", () => {
  let port = 0;
  let probesDir = "";
  let alertsDir = "";

  beforeEach(async () => {
    port = await pickPort();
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "harness-cp-http-probes-"),
    );
    alertsDir = path.join(root, "alerts");
    probesDir = path.join(root, "probes");
    await fs.mkdir(alertsDir, { recursive: true });
    await fs.mkdir(probesDir, { recursive: true });
    // Two HTTP families (single-target shapes keep the YAML minimal) + one
    // browser family. The browser family must be SKIPPED in-process.
    await fs.writeFile(
      path.join(probesDir, "smoke.yml"),
      [
        "kind: smoke",
        "id: smoke",
        'schedule: "*/5 * * * *"',
        "target:",
        "  key: smoke:test",
        '  url: "https://example.com"',
        "",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(probesDir, "image-drift.yml"),
      [
        "kind: image_drift",
        "id: image_drift",
        'schedule: "*/15 * * * *"',
        "target:",
        "  key: image_drift:test",
        "",
      ].join("\n"),
      "utf-8",
    );
    // A discovery-backed family (qa → railway-services discovery) so the test
    // exercises the discovery-registry wiring, not just the single-target
    // smoke path. The discovery source resolves against the mocked PB/railway
    // env; we only assert it SCHEDULES, not that it ticks.
    await fs.writeFile(
      path.join(probesDir, "qa.yml"),
      [
        "kind: qa",
        "id: qa",
        'schedule: "0 * * * *"',
        "discovery:",
        "  source: railway-services",
        '  key_template: "qa:${name}"',
        "",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(probesDir, "e2e-smoke.yml"),
      [
        "kind: e2e_smoke",
        "id: e2e_smoke",
        'schedule: "*/5 * * * *"',
        "target:",
        "  key: e2e_smoke:test",
        '  url: "https://example.com"',
        "",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    // doMock factories persist across the file (resetModules clears the module
    // CACHE, not the mock REGISTRY). Explicitly unmock every module these tests
    // doMock so a stale factory (e.g. a probe-loader that always throws, or an
    // event-bus that pre-hooks a subscriber) never bleeds into a sibling test
    // that doesn't re-mock it.
    vi.doUnmock("@hono/node-server");
    vi.doUnmock("./storage/pb-client.js");
    vi.doUnmock("./scheduler/scheduler.js");
    vi.doUnmock("./probes/run-history.js");
    vi.doUnmock("./probes/loader/probe-loader.js");
    vi.doUnmock("./events/event-bus.js");
  });

  it("schedules the HTTP families (smoke, image_drift, qa) in-process with their YAML crons but NOT the browser kind", async () => {
    vi.resetModules();

    // Pin the REAL serve() so this role binds cleanly (immunize against a
    // sibling test's leaked @hono/node-server doMock).
    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });

    // pb fake: health() true so the role boots clean; lookups return null.
    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async () => null,
          getFirst: async () => null,
          getList: async () => ({ items: [] }),
        }),
      };
    });

    // Capture every scheduler.register id AND cron so we can assert which
    // probe families landed as in-process scheduler entries AND that their
    // crons come FROM the YAML `schedule` (a hardcoded-cron regression must
    // fail this).
    const registered: { id: string; cron?: string }[] = [];
    vi.doMock("./scheduler/scheduler.js", async () => {
      const actual = await vi.importActual<
        typeof import("./scheduler/scheduler.js")
      >("./scheduler/scheduler.js");
      return {
        ...actual,
        createScheduler: (
          deps: Parameters<typeof actual.createScheduler>[0],
        ) => {
          const real = actual.createScheduler(deps);
          return {
            ...real,
            register: (entry: { id: string; cron?: string }) => {
              registered.push({ id: entry.id, cron: entry.cron });
              return (real.register as (...a: unknown[]) => unknown)(entry);
            },
          };
        },
      };
    });

    const orchMod = await import("./orchestrator.js");

    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      { port, configDir: alertsDir, fleetEnumerate: async () => [] },
    );

    try {
      const ids = registered.map((r) => r.id);
      // HTTP families register as in-process probe entries.
      expect(ids).toContain("probe:smoke");
      expect(ids).toContain("probe:image_drift");
      // Discovery-backed family (qa → railway-services) also schedules,
      // exercising the discovery-registry wiring, not just single-target.
      expect(ids).toContain("probe:qa");
      // Browser kind is NOT scheduled in-process — it routes to the producer.
      expect(ids).not.toContain("probe:e2e_smoke");

      // Crons are driven FROM the YAML `schedule`, never hardcoded.
      const cronFor = (id: string) => registered.find((r) => r.id === id)?.cron;
      expect(cronFor("probe:smoke")).toBe("*/5 * * * *");
      expect(cronFor("probe:image_drift")).toBe("*/15 * * * *");
      expect(cronFor("probe:qa")).toBe("0 * * * *");
    } finally {
      await handle.stop();
    }
  });

  it("/health reflects the in-process HTTP rule count (not a hardcoded 0)", async () => {
    vi.resetModules();

    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });

    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async () => null,
          getFirst: async () => null,
          getList: async () => ({ items: [] }),
        }),
      };
    });

    const orchMod = await import("./orchestrator.js");

    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      { port, configDir: alertsDir, fleetEnumerate: async () => [] },
    );

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = (await res.json()) as {
        status: string;
        rules: number;
        schedulerJobs: number;
      };
      // Three HTTP families loaded (smoke, image_drift, qa) → `rules` reports
      // the REAL in-process probe count. EXACT (not >=) so a browser kind
      // leaking into the in-process scheduler is caught. `ruleCount` reporting
      // the real count means a zero-probe load is OBSERVABLE in /health rather
      // than hidden behind the hardcoded-0 — but note the role still DROPS the
      // `rules>0` gate, so `status` does NOT flip to degraded on a zero load
      // (visibility is for dashboards/alerting, not container liveness).
      expect(body.rules).toBe(3);
      // schedulerJobs = the 4 browser-family producer entries (d6 + smoke +
      // demos + deep, registered via the multi-schedule manifest) + the 3
      // in-process HTTP probe entries.
      expect(body.schedulerJobs).toBe(7);
      // The role-drop keeps status ok regardless of the rule count.
      expect(body.status).toBe("ok");
    } finally {
      await handle.stop();
    }
  });

  it("BROWSER_KINDS is the e2e partition (the in-process exclusion set)", async () => {
    // `e2e_deep` is gone: D5 runs the `e2e_d6` driver ("D5 take-one"), so its
    // YAML (`config/probes/e2e-deep.yml`) now declares `kind: e2e_d6` and is
    // excluded in-process via the existing `e2e_d6` browser-kind entry.
    const orchMod = await import("./orchestrator.js");
    expect([...orchMod.BROWSER_KINDS].sort()).toEqual(
      ["e2e_d6", "e2e_demos", "e2e_smoke"].sort(),
    );
  });

  // A1: the control-plane must sweep orphaned `running` probe_runs rows at
  // boot, mirroring boot()'s `sweepStaleRuns(pb)` — boot() never runs in fleet
  // mode, so without this the control-plane (which now writes probe_runs via
  // the in-process HTTP probes) leaks orphaned `running` rows forever after a
  // crash.
  it("sweeps stale probe_runs at control-plane boot (and a sweep failure does not abort boot)", async () => {
    vi.resetModules();

    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });

    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async () => null,
          getFirst: async () => null,
          getList: async () => ({ items: [] }),
        }),
      };
    });

    // sweepStaleRuns: first throws (a sweep failure must NOT abort boot),
    // and we record that it was invoked at all.
    const sweepCalls: number[] = [];
    vi.doMock("./probes/run-history.js", async () => {
      const actual = await vi.importActual<
        typeof import("./probes/run-history.js")
      >("./probes/run-history.js");
      return {
        ...actual,
        sweepStaleRuns: async () => {
          sweepCalls.push(Date.now());
          throw new Error("simulated sweep failure");
        },
      };
    });

    const orchMod = await import("./orchestrator.js");

    // A sweep that throws must not reject runControlPlane — boot continues.
    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      { port, configDir: alertsDir, fleetEnumerate: async () => [] },
    );

    try {
      expect(sweepCalls.length).toBe(1);
      // Boot still completed despite the sweep failure: /health is reachable.
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(600);
    } finally {
      await handle.stop();
    }
  });

  // A2: a probe-loader failure at INITIAL load must NOT take down the
  // control-plane. The producer stays alive (status ok), `rules` reads 0
  // (observable), and `probes.reload.failed` is emitted.
  it("control-plane still boots (status ok, rules 0) and emits probes.reload.failed when the probe loader throws at initial load", async () => {
    vi.resetModules();

    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });

    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async () => null,
          getFirst: async () => null,
          getList: async () => ({ items: [] }),
        }),
      };
    });

    // Force the probe loader's initial load() to throw (e.g. probes dir
    // missing / unreadable on disk).
    vi.doMock("./probes/loader/probe-loader.js", async () => {
      const actual = await vi.importActual<
        typeof import("./probes/loader/probe-loader.js")
      >("./probes/loader/probe-loader.js");
      return {
        ...actual,
        createProbeLoader: () => ({
          load: async () => {
            throw new Error("simulated probes dir missing");
          },
          watch: () => () => {},
        }),
      };
    });

    const orchMod = await import("./orchestrator.js");

    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      { port, configDir: alertsDir, fleetEnumerate: async () => [] },
    );

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = (await res.json()) as { status: string; rules: number };
      // Producer alive: status stays ok (the role drops the rules>0 gate).
      expect(body.status).toBe("ok");
      // Zero probes loaded → rules reads 0, visible on /health (observable,
      // not a hard gate). The dedicated bus-subscription test below proves
      // `probes.reload.failed` is emitted.
      expect(body.rules).toBe(0);
    } finally {
      await handle.stop();
    }
  });

  // A2: prove `probes.reload.failed` is emitted by subscribing to the bus the
  // control-plane uses BEFORE the failing load runs. We swap createEventBus so
  // the test owns the bus instance the orchestrator constructs internally.
  it("emits probes.reload.failed on the control-plane bus when initial probe load throws", async () => {
    vi.resetModules();

    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });

    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async () => null,
          getFirst: async () => null,
          getList: async () => ({ items: [] }),
        }),
      };
    });

    vi.doMock("./probes/loader/probe-loader.js", async () => {
      const actual = await vi.importActual<
        typeof import("./probes/loader/probe-loader.js")
      >("./probes/loader/probe-loader.js");
      return {
        ...actual,
        createProbeLoader: () => ({
          load: async () => {
            throw new Error("simulated probes dir missing");
          },
          watch: () => () => {},
        }),
      };
    });

    // Own the bus the orchestrator constructs so we can subscribe BEFORE the
    // synchronous emit during runControlPlane.
    const reloadFailures: unknown[] = [];
    vi.doMock("./events/event-bus.js", async () => {
      const actual = await vi.importActual<
        typeof import("./events/event-bus.js")
      >("./events/event-bus.js");
      return {
        ...actual,
        createEventBus: () => {
          const realBus = actual.createEventBus();
          realBus.on("probes.reload.failed", (payload: unknown) => {
            reloadFailures.push(payload);
          });
          return realBus;
        },
      };
    });

    const orchMod = await import("./orchestrator.js");

    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      { port, configDir: alertsDir, fleetEnumerate: async () => [] },
    );

    try {
      expect(reloadFailures.length).toBeGreaterThanOrEqual(1);
    } finally {
      await handle.stop();
    }
  });

  // A2: hot-reload + watcher teardown. A YAML added on reload registers a new
  // probe:<id>; a YAML deleted unregisters it AND drops it from
  // httpProbeConfigs (so /health no longer counts it); after stop() the
  // watcher is torn down and no further reload fires.
  it("hot-reloads added/removed YAMLs and tears down the watcher on stop()", async () => {
    vi.resetModules();

    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });

    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async () => null,
          getFirst: async () => null,
          getList: async () => ({ items: [] }),
        }),
      };
    });

    // Capture register/unregister calls on the scheduler.
    const registeredIds: string[] = [];
    const unregisteredIds: string[] = [];
    vi.doMock("./scheduler/scheduler.js", async () => {
      const actual = await vi.importActual<
        typeof import("./scheduler/scheduler.js")
      >("./scheduler/scheduler.js");
      return {
        ...actual,
        createScheduler: (
          deps: Parameters<typeof actual.createScheduler>[0],
        ) => {
          const real = actual.createScheduler(deps);
          return {
            ...real,
            register: (entry: { id: string }) => {
              registeredIds.push(entry.id);
              return (real.register as (...a: unknown[]) => unknown)(entry);
            },
            unregister: (id: string) => {
              unregisteredIds.push(id);
              return (real.unregister as (...a: unknown[]) => unknown)(id);
            },
          };
        },
      };
    });

    // Drive the probe loader's watch callback manually so the reload path is
    // deterministic (no chokidar timing). `unwatch` records teardown.
    let watchCb:
      | ((next: import("./probes/loader/schema.js").ProbeConfig[]) => void)
      | undefined;
    let unwatched = false;
    const smokeCfg = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/5 * * * *",
      target: { key: "smoke:test", url: "https://example.com" },
    } as unknown as import("./probes/loader/schema.js").ProbeConfig;
    const extraCfg = {
      kind: "pin_drift",
      id: "pin_drift",
      schedule: "0 9 * * 1",
      target: { key: "pin_drift:test" },
    } as unknown as import("./probes/loader/schema.js").ProbeConfig;
    vi.doMock("./probes/loader/probe-loader.js", async () => {
      const actual = await vi.importActual<
        typeof import("./probes/loader/probe-loader.js")
      >("./probes/loader/probe-loader.js");
      return {
        ...actual,
        createProbeLoader: () => ({
          // Initial load: just smoke.
          load: async () => [smokeCfg],
          watch: (cb: typeof watchCb) => {
            watchCb = cb;
            return () => {
              unwatched = true;
            };
          },
        }),
      };
    });

    const orchMod = await import("./orchestrator.js");

    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      { port, configDir: alertsDir, fleetEnumerate: async () => [] },
    );

    try {
      expect(registeredIds).toContain("probe:smoke");
      expect(watchCb).toBeDefined();

      // Reload with an ADDED YAML (pin_drift) → new probe:<id> registered.
      watchCb!([smokeCfg, extraCfg]);
      await new Promise((r) => setTimeout(r, 0));
      expect(registeredIds).toContain("probe:pin_drift");

      // Reload with smoke DELETED → unregister probe:smoke fires.
      watchCb!([extraCfg]);
      await new Promise((r) => setTimeout(r, 0));
      expect(unregisteredIds).toContain("probe:smoke");
    } finally {
      await handle.stop();
    }

    // After stop() the watcher's unsubscribe ran → no reload fires anymore.
    expect(unwatched).toBe(true);
  });

  // ── /api/probes trigger endpoint on the control-plane ──────────────────
  //
  // The control-plane runs the 8 in-process HTTP probe families on its own
  // scheduler under `probe:<id>` entries. The on-demand trigger endpoint
  // (`POST /api/probes/:id/trigger`, bearer-auth gated) lets operators fire a
  // family immediately instead of waiting on the slow cron. It is mounted via
  // the SAME `registerProbesRoutes` boot() uses, wired from the control-plane's
  // own `httpProbeRegistry`/`httpProbeConfigs`/`scheduler`/`httpRunWriter` and
  // `OPS_TRIGGER_TOKEN`. The router id namespace is the prefixed scheduler id
  // (`probe:<cfg.id>`), matching boot() and the in-process registration.
  describe("on-demand trigger endpoint (/api/probes)", () => {
    const TOKEN = "cp-trigger-token";
    let prevToken: string | undefined;

    beforeEach(() => {
      prevToken = process.env.OPS_TRIGGER_TOKEN;
      process.env.OPS_TRIGGER_TOKEN = TOKEN;
    });

    afterEach(() => {
      if (prevToken === undefined) delete process.env.OPS_TRIGGER_TOKEN;
      else process.env.OPS_TRIGGER_TOKEN = prevToken;
    });

    function pbMock() {
      vi.doMock("@hono/node-server", async () => {
        const actual =
          await vi.importActual<typeof import("@hono/node-server")>(
            "@hono/node-server",
          );
        return { ...actual };
      });
      vi.doMock("./storage/pb-client.js", async () => {
        const actual = await vi.importActual<
          typeof import("./storage/pb-client.js")
        >("./storage/pb-client.js");
        return {
          ...actual,
          createPbClient: () => ({
            health: async () => true,
            getOne: async () => null,
            getFirst: async () => null,
            getList: async () => ({ items: [] }),
          }),
        };
      });
    }

    it("GET /api/probes lists the in-process HTTP families (and not the browser kind)", async () => {
      vi.resetModules();
      pbMock();
      const orchMod = await import("./orchestrator.js");
      const handle = await orchMod.runControlPlane(
        { role: "control-plane", poolCount: 1 },
        { port, configDir: alertsDir, fleetEnumerate: async () => [] },
      );
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/probes`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { probes: Array<{ id: string }> };
        const ids = body.probes.map((p) => p.id).sort();
        // The 3 HTTP families written to the temp probes dir, under their
        // prefixed scheduler ids.
        expect(ids).toEqual(
          ["probe:image_drift", "probe:qa", "probe:smoke"].sort(),
        );
        // Browser kind is worker-routed, never in-process → not listed.
        expect(ids).not.toContain("probe:e2e_smoke");
      } finally {
        await handle.stop();
      }
    });

    it("POST /api/probes/probe:smoke/trigger with the bearer token runs the in-process probe", async () => {
      vi.resetModules();
      pbMock();

      // Capture trigger() calls on the real scheduler so we can assert the
      // route routed the request to the control-plane's scheduler entry.
      const triggered: string[] = [];
      vi.doMock("./scheduler/scheduler.js", async () => {
        const actual = await vi.importActual<
          typeof import("./scheduler/scheduler.js")
        >("./scheduler/scheduler.js");
        return {
          ...actual,
          createScheduler: (
            deps: Parameters<typeof actual.createScheduler>[0],
          ) => {
            const real = actual.createScheduler(deps);
            return {
              ...real,
              trigger: async (id: string, opts?: unknown) => {
                triggered.push(id);
                return { runId: "run_cp", status: "queued", probe: id };
              },
            };
          },
        };
      });

      const orchMod = await import("./orchestrator.js");
      const handle = await orchMod.runControlPlane(
        { role: "control-plane", poolCount: 1 },
        { port, configDir: alertsDir, fleetEnumerate: async () => [] },
      );
      try {
        const res = await fetch(
          `http://127.0.0.1:${port}/api/probes/probe:smoke/trigger`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${TOKEN}` },
          },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { runId: string; probe: string };
        expect(body.runId).toBe("run_cp");
        expect(body.probe).toBe("probe:smoke");
        // The route invoked the control-plane scheduler's entry for the probe.
        expect(triggered).toContain("probe:smoke");
      } finally {
        await handle.stop();
      }
    });

    it("POST /api/probes/probe:smoke/trigger WITHOUT the bearer token 401s", async () => {
      vi.resetModules();
      pbMock();
      const orchMod = await import("./orchestrator.js");
      const handle = await orchMod.runControlPlane(
        { role: "control-plane", poolCount: 1 },
        { port, configDir: alertsDir, fleetEnumerate: async () => [] },
      );
      try {
        const res = await fetch(
          `http://127.0.0.1:${port}/api/probes/probe:smoke/trigger`,
          { method: "POST" },
        );
        expect(res.status).toBe(401);
      } finally {
        await handle.stop();
      }
    });

    it("POST /api/probes/probe:e2e_smoke/trigger 404s — browser families are not in-process", async () => {
      vi.resetModules();
      pbMock();
      const orchMod = await import("./orchestrator.js");
      const handle = await orchMod.runControlPlane(
        { role: "control-plane", poolCount: 1 },
        { port, configDir: alertsDir, fleetEnumerate: async () => [] },
      );
      try {
        const res = await fetch(
          `http://127.0.0.1:${port}/api/probes/probe:e2e_smoke/trigger`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${TOKEN}` },
          },
        );
        // browser-only id is not a registered in-process probe → 404
        expect(res.status).toBe(404);
      } finally {
        await handle.stop();
      }
    });

    it("POST /api/probes/probe:nope/trigger 404s for an unknown id", async () => {
      vi.resetModules();
      pbMock();
      const orchMod = await import("./orchestrator.js");
      const handle = await orchMod.runControlPlane(
        { role: "control-plane", poolCount: 1 },
        { port, configDir: alertsDir, fleetEnumerate: async () => [] },
      );
      try {
        const res = await fetch(
          `http://127.0.0.1:${port}/api/probes/probe:nope/trigger`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${TOKEN}` },
          },
        );
        expect(res.status).toBe(404);
      } finally {
        await handle.stop();
      }
    });

    it("does NOT mount the trigger endpoint when OPS_TRIGGER_TOKEN is unset (fail-safe)", async () => {
      delete process.env.OPS_TRIGGER_TOKEN;
      vi.resetModules();
      pbMock();
      const orchMod = await import("./orchestrator.js");
      const handle = await orchMod.runControlPlane(
        { role: "control-plane", poolCount: 1 },
        { port, configDir: alertsDir, fleetEnumerate: async () => [] },
      );
      try {
        // Router not mounted → /api/probes returns Hono's default 404.
        const res = await fetch(`http://127.0.0.1:${port}/api/probes`);
        expect(res.status).toBe(404);
      } finally {
        await handle.stop();
      }
    });

    it("throws fail-loud when OPS_TRIGGER_TOKEN is set-but-empty", async () => {
      process.env.OPS_TRIGGER_TOKEN = "   ";
      vi.resetModules();
      pbMock();
      const orchMod = await import("./orchestrator.js");
      await expect(
        orchMod.runControlPlane(
          { role: "control-plane", poolCount: 1 },
          { port, configDir: alertsDir, fleetEnumerate: async () => [] },
        ),
      ).rejects.toThrow(/OPS_TRIGGER_TOKEN.*empty/i);
    });
  });
});

// A4 drift-lock: the HTTP-only driver set registered by
// `registerHttpProbeDrivers` must be DISJOINT from BROWSER_KINDS, and together
// they must cover the full registered driver universe. Mirrors the
// `registerAllProbeDrivers` drift-guard above. A future kind mis-added to
// BROWSER_KINDS — or an HTTP driver whose kind overlaps a browser kind — would
// silently drop a family from the in-process schedule.
describe("orchestrator.registerHttpProbeDrivers / BROWSER_KINDS partition (drift-lock)", () => {
  it("registers exactly the 8 HTTP-only kinds (no browser kinds)", async () => {
    const orchMod = await import("./orchestrator.js");
    const registry = createProbeRegistry();
    orchMod.registerHttpProbeDrivers(registry);
    const kinds = registry.list();
    expect(kinds.sort()).toEqual(
      [
        "aimock_wiring",
        "image_drift",
        "pin_drift",
        "qa",
        "redirect_decommission",
        "smoke",
        "starter_smoke",
        "version_drift",
      ].sort(),
    );
  });

  it("the HTTP driver kinds and BROWSER_KINDS are DISJOINT and jointly cover the full driver universe", async () => {
    const orchMod = await import("./orchestrator.js");
    const httpRegistry = createProbeRegistry();
    orchMod.registerHttpProbeDrivers(httpRegistry);
    const httpKinds = new Set(httpRegistry.list());
    const browserKinds = new Set<string>(orchMod.BROWSER_KINDS);

    // Disjoint: no kind is in both sets.
    for (const k of httpKinds) {
      expect(browserKinds.has(k)).toBe(false);
    }

    // Jointly cover the FULL registered universe (registerAllProbeDrivers).
    const allRegistry = createProbeRegistry();
    registerAllProbeDrivers(allRegistry);
    const allKinds = new Set(allRegistry.list());
    const union = new Set<string>([...httpKinds, ...browserKinds]);
    expect([...union].sort()).toEqual([...allKinds].sort());
  });

  it("assertHttpBrowserKindPartition throws if a browser kind is in the HTTP set", async () => {
    const orchMod = await import("./orchestrator.js");
    // Clean partition passes.
    const registry = createProbeRegistry();
    orchMod.registerHttpProbeDrivers(registry);
    expect(() =>
      orchMod.assertHttpBrowserKindPartition(registry.list()),
    ).not.toThrow();
    // A browser kind sneaking into the HTTP set fails loud.
    expect(() =>
      orchMod.assertHttpBrowserKindPartition([...registry.list(), "e2e_smoke"]),
    ).toThrow(/DISJOINT/);
  });
});

// Shared helper used by both the R25 and R28 describe blocks.
function makeCronRule(id: string, cron: string): CompiledRule {
  return {
    id,
    name: id,
    owner: "@test",
    severity: "warn",
    signal: { dimension: "aimock_wiring" },
    stringTriggers: [],
    cronTriggers: [{ schedule: cron }],
    conditions: { guards: [], escalations: [] },
    targets: [{ kind: "slack_webhook", webhook: "oss_alerts" }],
    template: { text: "x" },
    actions: [],
  };
}

/**
 * Phase 2 — fleet producer multi-schedule wiring.
 *
 * `runControlPlane` now builds FOUR browser-family producers (d6 + smoke +
 * demos + deep) and passes a `schedules` array to `createControlPlane`, each on
 * its own cron. `buildProducerSchedules` is the pure manifest assembler; these
 * tests pin the EXACT schedule ids + crons (the deliberate offsets that stagger
 * the families' Playwright fan-outs on the shared BrowserPool) and the d6
 * env-override behavior, then prove the schedules actually register on the live
 * scheduler when `runControlPlane` boots.
 */
describe("buildProducerSchedules (fleet multi-schedule manifest)", () => {
  function fakeProducer(): JobProducer {
    return {
      start: () => {},
      stop: async () => {},
      tick: async () => ({ enqueued: 0, runId: "r" }) as never,
      maybeSweep: async () => undefined,
    } as unknown as JobProducer;
  }

  it("emits 4 schedules with the exact ids + crons read from the YAMLs", () => {
    const d6 = fakeProducer();
    const smoke = fakeProducer();
    const demos = fakeProducer();
    const deep = fakeProducer();

    const schedules = buildProducerSchedules({ d6, smoke, demos, deep });

    expect(schedules).toHaveLength(4);

    const byId = new Map(schedules.map((s) => [s.scheduleId, s]));

    // d6: historic scheduleId + cron (degenerate-path equivalence).
    expect(byId.get(FLEET_PRODUCER_SCHEDULE_ID)?.cron).toBe("40 * * * *");
    expect(byId.get(FLEET_PRODUCER_SCHEDULE_ID)?.cron).toBe(
      DEFAULT_PRODUCER_CRON,
    );
    expect(byId.get(FLEET_PRODUCER_SCHEDULE_ID)?.producer).toBe(d6);

    // smoke: every 15 min (e2e-smoke.yml).
    expect(FLEET_PRODUCER_SMOKE_SCHEDULE_ID).toBe("fleet-producer-e2e-smoke");
    expect(byId.get(FLEET_PRODUCER_SMOKE_SCHEDULE_ID)?.cron).toBe(
      "*/15 * * * *",
    );
    expect(byId.get(FLEET_PRODUCER_SMOKE_SCHEDULE_ID)?.cron).toBe(
      FLEET_PRODUCER_SMOKE_CRON,
    );
    expect(byId.get(FLEET_PRODUCER_SMOKE_SCHEDULE_ID)?.producer).toBe(smoke);

    // demos: hourly at :10 (e2e-demos.yml).
    expect(FLEET_PRODUCER_DEMOS_SCHEDULE_ID).toBe("fleet-producer-e2e-demos");
    expect(byId.get(FLEET_PRODUCER_DEMOS_SCHEDULE_ID)?.cron).toBe("10 * * * *");
    expect(byId.get(FLEET_PRODUCER_DEMOS_SCHEDULE_ID)?.cron).toBe(
      FLEET_PRODUCER_DEMOS_CRON,
    );
    expect(byId.get(FLEET_PRODUCER_DEMOS_SCHEDULE_ID)?.producer).toBe(demos);

    // deep: :05/:20/:35/:50 (e2e-deep.yml).
    expect(FLEET_PRODUCER_DEEP_SCHEDULE_ID).toBe("fleet-producer-e2e-deep");
    expect(byId.get(FLEET_PRODUCER_DEEP_SCHEDULE_ID)?.cron).toBe(
      "5,20,35,50 * * * *",
    );
    expect(byId.get(FLEET_PRODUCER_DEEP_SCHEDULE_ID)?.cron).toBe(
      FLEET_PRODUCER_DEEP_CRON,
    );
    expect(byId.get(FLEET_PRODUCER_DEEP_SCHEDULE_ID)?.producer).toBe(deep);

    // All four schedule ids are distinct (createControlPlane throws on dups).
    expect(new Set(schedules.map((s) => s.scheduleId)).size).toBe(4);
  });

  it("threads the FLEET_PRODUCER_CRON override onto the d6 schedule only", () => {
    const d6 = fakeProducer();
    const smoke = fakeProducer();
    const demos = fakeProducer();
    const deep = fakeProducer();

    const schedules = buildProducerSchedules({
      d6,
      smoke,
      demos,
      deep,
      d6Cron: "* * * * *",
    });
    const byId = new Map(schedules.map((s) => [s.scheduleId, s]));

    // d6 honors the override; the 3 browser families keep their YAML crons.
    expect(byId.get(FLEET_PRODUCER_SCHEDULE_ID)?.cron).toBe("* * * * *");
    expect(byId.get(FLEET_PRODUCER_SMOKE_SCHEDULE_ID)?.cron).toBe(
      "*/15 * * * *",
    );
    expect(byId.get(FLEET_PRODUCER_DEMOS_SCHEDULE_ID)?.cron).toBe("10 * * * *");
    expect(byId.get(FLEET_PRODUCER_DEEP_SCHEDULE_ID)?.cron).toBe(
      "5,20,35,50 * * * *",
    );
  });
});

/**
 * REQ-B late-bind at-least-once guard: `buildSweepCommErrorSink` must THROW
 * while the control-plane ref is still unbound. The job-producer's
 * `deliverSweepCommErrors` clears its undelivered buffer whenever the sink
 * RESOLVES, so an unbound sink that resolved would mark a never-delivered
 * batch as delivered — silently dropping the worker-crashed overlay
 * (`sweepExpired` cannot re-derive a missed batch). A rejection makes the
 * producer re-buffer and redeliver on a later sweep, after the bind.
 */
describe("buildSweepCommErrorSink (REQ-B late-bind at-least-once guard)", () => {
  const commError: PoolCommError = {
    kind: "worker-crashed-mid-job",
    message: "lease expired; worker presumed crashed",
    workerId: "worker-dead",
    jobId: "job-unbound-1",
    observedAt: "2026-06-10T00:00:00.000Z",
  };

  it("rejects while the control-plane is unbound (producer must re-buffer, not clear)", async () => {
    const sink = buildSweepCommErrorSink(() => undefined);
    await expect(sink([commError])).rejects.toThrow(
      /control-plane.*not.*bound|before the control-plane/i,
    );
  });

  it("forwards the batch to surfaceSweepCommErrors once bound, and resolves", async () => {
    const seen: PoolCommError[][] = [];
    let ref:
      | { surfaceSweepCommErrors(errs: PoolCommError[]): Promise<void> }
      | undefined;
    // Built UNBOUND (mirroring runControlPlane's assembly order), bound after.
    const sink = buildSweepCommErrorSink(() => ref);
    ref = {
      surfaceSweepCommErrors: async (errs) => {
        seen.push(errs);
      },
    };
    await expect(sink([commError])).resolves.toBeUndefined();
    expect(seen).toEqual([[commError]]);
  });

  it("propagates a bound sink's rejection (the producer's re-buffer trigger)", async () => {
    const sink = buildSweepCommErrorSink(() => ({
      surfaceSweepCommErrors: async () => {
        throw new Error("aggregator write failed");
      },
    }));
    await expect(sink([commError])).rejects.toThrow("aggregator write failed");
  });
});

/**
 * Drift-lock: FLEET_FAMILY_PERIODS_MS keys must EXACTLY match the probe-key
 * families the four real enumerators enqueue under. The map feeds the queue
 * client's stale-pending expiry; `stalePendingFilters` silently falls back to
 * the 1h default for any family missing from the map, so a typo'd family key
 * (e.g. "d5" vs "d5-single-pill-e2e") would never throw — it would just
 * quietly mis-size that family's drain window. The families are derived by
 * RUNNING each enumerator factory against a fake discovery source, so this
 * test breaks if either side (map key or enumerator prefix) drifts.
 *
 * NOTE: this locks the NOMINAL period map only. The d6 cron-override drift
 * (FLEET_PRODUCER_CRON changing d6's real cadence without updating the map)
 * is a documented limitation on FLEET_FAMILY_PERIODS_MS, not testable here.
 */
describe("FLEET_FAMILY_PERIODS_MS ↔ enumerator family drift-lock", () => {
  it("map keys exactly match the families the four enumerators enqueue under", async () => {
    const service: RailwayServiceInfo = {
      name: "showcase-langgraph-python",
      imageRef: "ghcr.io/org/showcase-langgraph-python:latest",
      publicUrl: "http://langgraph-python:10000",
      env: {},
      shape: "package",
      deployedDigest: "",
      demos: ["agentic_chat"],
      notSupportedFeatures: [],
      deployedAt: "",
    };
    const source = {
      name: "railway-services",
      async enumerate(): Promise<RailwayServiceInfo[]> {
        return [service];
      },
    } as unknown as DiscoverySource<RailwayServiceInfo>;
    const silent = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    const deps = {
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: silent,
    };

    const enumerators = [
      createD6ServiceEnumerator(deps),
      createE2eSmokeServiceEnumerator(deps),
      createE2eDeepServiceEnumerator(deps),
      createE2eDemosServiceEnumerator(deps),
    ];
    const families = new Set<string>();
    for (const enumerate of enumerators) {
      const specs = await enumerate({ triggered: false, runId: "drift-lock" });
      expect(specs.length).toBeGreaterThan(0);
      for (const spec of specs) families.add(probeKeyFamily(spec.probeKey));
    }

    expect([...families].sort()).toEqual(
      Object.keys(FLEET_FAMILY_PERIODS_MS).sort(),
    );
  });
});

/**
 * §4.2 drift-lock extension: the family ids `runControlPlane` stamps onto its
 * four producers (via `PRODUCER_FAMILY_WIRING`, the single const all four
 * `buildJobProducer` call sites read) must be set-equal to the §5.1
 * `FLEET_FAMILIES` registry — a producer wired with a family the registry
 * doesn't know would enqueue jobs INVISIBLE to the /api/runs projection, and
 * a registry family no producer stamps would project as eternally silent.
 */
describe("PRODUCER_FAMILY_WIRING (§4.2 family drift-lock)", () => {
  it("wired producer family ids are set-equal to FLEET_FAMILIES[*].family", () => {
    const wired = Object.values(PRODUCER_FAMILY_WIRING).sort();
    const registry = FLEET_FAMILIES.map((f) => f.family).sort();
    expect(wired).toEqual(registry);
  });
});

describe("runControlPlane registers 4 producer schedules on the scheduler", () => {
  let port = 0;

  beforeEach(async () => {
    port = await pickPort();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("registers d6 + smoke + demos + deep producer schedules with exact crons, alongside the in-process HTTP probes", async () => {
    vi.resetModules();

    // Real serve() (immunize against a sibling test's leaked doMock).
    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });

    // Minimal queue fake — no enqueue/sweep churn; the producers never tick here.
    vi.doMock("./fleet/queue-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./fleet/queue-client.js")
      >("./fleet/queue-client.js");
      return {
        ...actual,
        createFleetQueueClient: () => ({
          enqueue: async () => ({}) as never,
          claimNext: async () => ({ claimed: false }) as never,
          renewLease: async () => null,
          report: async () => undefined,
          sweepExpired: async () => ({ reclaimed: 0, commErrors: [] }),
          countPendingForFamily: async () => 0,
        }),
      };
    });

    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async () => null,
          getFirst: async () => null,
        }),
      };
    });

    vi.doMock("./writers/status-writer.js", async () => {
      const actual = await vi.importActual<
        typeof import("./writers/status-writer.js")
      >("./writers/status-writer.js");
      return {
        ...actual,
        // Stub the full StatusWriter surface (write + writeOverlay) with
        // contract-honest outcome shapes — the `(): StatusWriter` annotation
        // makes tsc enforce the real WriteOutcome contract on the stub
        // (pre-fix `write: async () => undefined` violated it).
        createStatusWriter: (): StatusWriter => ({
          write: async () => ({
            previousState: null,
            newState: "green",
            transition: "first",
            firstFailureAt: null,
            failCount: 0,
            persisted: true,
          }),
          writeOverlay: async () => ({
            applied: false,
            state: null,
            historyPersisted: false,
          }),
        }),
      };
    });

    vi.doMock("./probes/run-history.js", async () => {
      const actual = await vi.importActual<
        typeof import("./probes/run-history.js")
      >("./probes/run-history.js");
      return {
        ...actual,
        createProbeRunWriter: () => ({
          findByJobId: async () => null,
          start: async () => ({}) as never,
          finishTerminal: async () => undefined,
        }),
      };
    });

    // Record EVERY scheduler register call (id + cron) so we can assert the
    // producer schedules landed alongside the in-process `probe:*` HTTP entries.
    const registered: Array<{ id: string; cron: string }> = [];
    vi.doMock("./scheduler/scheduler.js", async () => {
      const actual = await vi.importActual<
        typeof import("./scheduler/scheduler.js")
      >("./scheduler/scheduler.js");
      return {
        ...actual,
        createScheduler: (
          deps: Parameters<typeof actual.createScheduler>[0],
        ) => {
          const real = actual.createScheduler(deps);
          return {
            ...real,
            register: (entry: {
              id: string;
              cron: string;
              handler: () => Promise<unknown>;
            }) => {
              registered.push({ id: entry.id, cron: entry.cron });
              return (real.register as (...a: unknown[]) => unknown)(entry);
            },
          };
        },
      };
    });

    const orchMod = await import("./orchestrator.js");
    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      // Empty d6 enumerator → no enqueue churn; schedule registration still runs.
      { port, fleetEnumerate: async () => [] },
    );

    try {
      const byId = new Map(registered.map((r) => [r.id, r.cron]));

      // All four producer schedules registered with their exact crons.
      expect(byId.get("fleet-job-producer")).toBe("40 * * * *");
      expect(byId.get("fleet-producer-e2e-smoke")).toBe("*/15 * * * *");
      expect(byId.get("fleet-producer-e2e-demos")).toBe("10 * * * *");
      expect(byId.get("fleet-producer-e2e-deep")).toBe("5,20,35,50 * * * *");

      // The in-process HTTP probe families still register alongside (additive).
      const probeEntries = registered.filter((r) => r.id.startsWith("probe:"));
      expect(probeEntries.length).toBeGreaterThan(0);
    } finally {
      await handle.stop();
    }
  });
});

/**
 * B2 fix: `POST /webhooks/deploy` must be registered on BOTH boot paths
 * (worker via boot(), control-plane via runControlPlane), AND the
 * FATAL-CONFIG guard on missing SHARED_SECRET must fire regardless of
 * NODE_ENV (gated only by an explicit test/escape-hatch).
 *
 * Pre-fix: the CP path's buildServer call omitted webhookSecrets/metrics
 * entirely, so the server.ts gate (deps.webhookSecrets?.length > 0)
 * silently skipped route registration — every notify-harness POST from
 * the Showcase: Verify Deploy workflow returned 404 on the public host.
 *
 * Test plan (red-green-refactor):
 *   - Test A: CP boot with SHARED_SECRET set → POST /webhooks/deploy
 *     without HMAC headers returns 401 (route IS mounted; the route's own
 *     HMAC reject path fires). Pre-fix this returned 404.
 *   - Test B: worker boot with SHARED_SECRET set → same 401 probe
 *     (regression guard so the worker path keeps working).
 *   - Test C: SHARED_SECRET unset + NODE_ENV != "test" / no escape hatch
 *     → boot throws FATAL-CONFIG mentioning SHARED_SECRET. Pre-fix this
 *     silently booted unless NODE_ENV === "production".
 *   - Test D: SHARED_SECRET unset + NODE_ENV === "test" → boot succeeds
 *     (test-mode escape hatch preserved).
 */
describe("orchestrator B2: /webhooks/deploy registered on CP + fail-loud on missing SHARED_SECRET", () => {
  let tempDir: string;
  let alertsDir: string;
  let probesDir: string;
  let port = 0;
  let cpStopFn: (() => Promise<void>) | null = null;
  let workerStopFn: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    port = await pickPort();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-cp-b2-"));
    alertsDir = path.join(root, "alerts");
    probesDir = path.join(root, "probes");
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-worker-b2-"));
    await fs.mkdir(alertsDir, { recursive: true });
    await fs.mkdir(probesDir, { recursive: true });
  });

  afterEach(async () => {
    if (cpStopFn) {
      await cpStopFn().catch(() => undefined);
      cpStopFn = null;
    }
    if (workerStopFn) {
      await workerStopFn().catch(() => undefined);
      workerStopFn = null;
    }
    await fs.rm(alertsDir, { recursive: true, force: true });
    await fs.rm(probesDir, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.restoreAllMocks();
    // CB-1 (Slot 2 #22): tests below use vi.stubEnv instead of direct
    // process.env mutation so the test runner can guarantee restoration
    // (restoreAllMocks does NOT undo stubEnv — explicit unstub required).
    vi.unstubAllEnvs();
    vi.doUnmock("@hono/node-server");
    vi.doUnmock("./storage/pb-client.js");
  });

  // Helper: probe POST /webhooks/deploy with no HMAC headers. Expected
  // outcomes: 404 when the route is NOT mounted (pre-fix CP), 401 when
  // it IS mounted (the route's HMAC reject path rejects unsigned bodies).
  async function probeWebhookDeploy(p: number): Promise<number> {
    const res = await fetch(`http://127.0.0.1:${p}/webhooks/deploy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    return res.status;
  }

  it("Test A: CP boot registers POST /webhooks/deploy when SHARED_SECRET is set (401, not 404)", async () => {
    vi.resetModules();
    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });
    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async () => null,
          getFirst: async () => null,
          getList: async () => ({ items: [] }),
        }),
      };
    });

    vi.stubEnv("SHARED_SECRET", "b2-test-secret-cp");
    vi.stubEnv("NODE_ENV", "test");
    const orchMod = await import("./orchestrator.js");
    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      { port, configDir: alertsDir, fleetEnumerate: async () => [] },
    );
    cpStopFn = handle.stop;

    const status = await probeWebhookDeploy(port);
    // Pre-fix: 404 (route omitted because CP buildServer call dropped
    // webhookSecrets). Post-fix: 401 (route mounted, HMAC reject path
    // fires on the unsigned POST).
    expect(status).toBe(401);
  });

  it("Test B: worker boot still registers POST /webhooks/deploy when SHARED_SECRET is set (401, regression guard)", async () => {
    vi.stubEnv("SHARED_SECRET", "b2-test-secret-worker");
    vi.stubEnv("NODE_ENV", "test");
    const booted = await boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    workerStopFn = booted.stop;

    const status = await probeWebhookDeploy(port);
    expect(status).toBe(401);
  });

  it("Test C: boot throws FATAL-CONFIG when SHARED_SECRET unset AND NODE_ENV is non-test (regardless of production)", async () => {
    vi.stubEnv("SHARED_SECRET", undefined as unknown as string);
    vi.stubEnv("SHARED_SECRET_PREV", undefined as unknown as string);
    vi.stubEnv("HARNESS_ALLOW_NO_SECRET", undefined as unknown as string);
    // "development" — pre-fix this booted silently (only NODE_ENV ===
    // "production" tripped the guard). Post-fix it must throw.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("POCKETBASE_URL", "http://localhost:8090");
    await expect(
      boot({ configDir: tempDir, port, bootstrapWindowMs: 0 }),
    ).rejects.toThrow(/SHARED_SECRET/);
  });

  it("Test D: boot succeeds when SHARED_SECRET unset AND NODE_ENV=test (test-mode escape hatch)", async () => {
    vi.stubEnv("SHARED_SECRET", undefined as unknown as string);
    vi.stubEnv("SHARED_SECRET_PREV", undefined as unknown as string);
    vi.stubEnv("NODE_ENV", "test");
    const booted = await boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    workerStopFn = booted.stop;
    expect(booted.port).toBe(port);
  });
});

/**
 * R1-F1 (CR round 1, bucket a): the CP boot path MUST subscribe to
 * `deploy.result` and route each event through its status writer so a valid
 * signed POST against the CP host actually writes the deploy-overall
 * dashboard row.
 *
 * Pre-fix: B2 mounted POST /webhooks/deploy on the CP role and the route
 * emitted on the bus, but only the worker `boot()` path had a
 * `bus.on("deploy.result", ...)` listener. CP signed POSTs returned 202
 * (route accepted), but the bus event had no subscriber and the dashboard
 * row never landed — the original B2 fix mounted the route without
 * delivering the event.
 */
describe("orchestrator R1-F1: deploy.result subscriber on CP path", () => {
  let port = 0;
  let alertsDir: string;
  let cpStopFn: (() => Promise<void>) | null = null;
  let workerStopFn: (() => Promise<void>) | null = null;
  let tempDir: string;
  const writes: ProbeResult[] = [];

  beforeEach(async () => {
    port = await pickPort();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-r1f1-"));
    alertsDir = path.join(root, "alerts");
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-r1f1-worker-"));
    await fs.mkdir(alertsDir, { recursive: true });
    writes.length = 0;
  });

  afterEach(async () => {
    if (cpStopFn) {
      await cpStopFn().catch(() => undefined);
      cpStopFn = null;
    }
    if (workerStopFn) {
      await workerStopFn().catch(() => undefined);
      workerStopFn = null;
    }
    await fs.rm(alertsDir, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.restoreAllMocks();
    // CB-1: restoreAllMocks does NOT undo vi.stubEnv — explicit unstub.
    vi.unstubAllEnvs();
    vi.doUnmock("@hono/node-server");
    vi.doUnmock("./storage/pb-client.js");
    vi.doUnmock("./writers/status-writer.js");
  });

  async function mountCommonMocks(): Promise<void> {
    vi.resetModules();
    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });
    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async () => null,
          getFirst: async () => null,
          getList: async () => ({ items: [] }),
        }),
      };
    });
    // Replace `createStatusWriter` with a stub that records every write so
    // the test can assert the CP's deploy.result subscriber actually
    // routed the event through `writer.write(...)`.
    vi.doMock("./writers/status-writer.js", async () => {
      const actual = await vi.importActual<
        typeof import("./writers/status-writer.js")
      >("./writers/status-writer.js");
      return {
        ...actual,
        createStatusWriter: (): StatusWriter => ({
          write: async (result: ProbeResult) => {
            writes.push(result);
            return {
              previousState: null,
              newState: "green",
              transition: "first",
              firstFailureAt: null,
              failCount: 0,
              persisted: true,
            };
          },
          writeOverlay: async (): Promise<OverlayWriteOutcome> => ({
            applied: false,
            state: null,
            historyPersisted: false,
          }),
        }),
      };
    });
  }

  function emitFakeDeployResult(bus: ReturnType<typeof createEventBus>): void {
    bus.emit("deploy.result", {
      runId: "r1f1-test-runid",
      runUrl: "https://example.invalid/runs/123",
      services: ["showcase-shell-docs"],
      failed: [],
      succeeded: ["showcase-shell-docs"],
      cancelled: false,
      gateSkipped: false,
      gateReason: undefined,
      buildRunId: undefined,
      buildRunUrl: undefined,
    });
  }

  it("CP boot subscribes deploy.result → writer.write fires with deploy-overall ProbeResult", async () => {
    vi.stubEnv("SHARED_SECRET", "r1f1-test-secret");
    vi.stubEnv("NODE_ENV", "test");
    await mountCommonMocks();
    const orchMod = await import("./orchestrator.js");
    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      { port, configDir: alertsDir, fleetEnumerate: async () => [] },
    );
    cpStopFn = handle.stop;

    // The subscriber's writer.write is sync from the bus' POV (the
    // handler awaits internally and fire-and-forgets); the in-memory
    // stub records synchronously inside the catch-free path, but yield
    // one microtask to give any chained `.catch()` a chance to settle.
    const before = writes.filter((r) => r.key === "deploy:overall").length;
    emitFakeDeployResult(handle.bus);
    await Promise.resolve();
    await Promise.resolve();
    const after = writes.filter((r) => r.key === "deploy:overall").length;
    // deployEventToProbeResult keys the row "deploy:overall" — the
    // subscriber must transform the event into a ProbeResult before
    // writing (not pass the raw DeployResultEvent through).
    expect(after - before).toBe(1);
  });

  it("worker boot subscribes deploy.result → writer.write fires (regression guard for helper extraction)", async () => {
    vi.stubEnv("SHARED_SECRET", "r1f1-worker-secret");
    vi.stubEnv("NODE_ENV", "test");
    await mountCommonMocks();
    const orchMod = await import("./orchestrator.js");
    const booted = await orchMod.boot({
      configDir: tempDir,
      port,
      bootstrapWindowMs: 0,
    });
    workerStopFn = booted.stop;

    // The worker boot writes other keys at startup (browser-pool
    // healthy/degraded, etc.) — filter to deploy-overall to assert the
    // deploy.result handler specifically routed through writer.write.
    const before = writes.filter((r) => r.key === "deploy:overall").length;
    emitFakeDeployResult(booted.bus);
    await Promise.resolve();
    await Promise.resolve();
    const after = writes.filter((r) => r.key === "deploy:overall").length;
    expect(after - before).toBe(1);
  });
});

/**
 * R2-F1: `runControlPlane` must capture the unsub returned by
 * `subscribeDeployResults` so `stop()` (and bind-failure teardown) release
 * the listener. Pre-fix the CP path discarded the unsub — a repeated
 * boot/stop cycle leaked the deploy.result handler against the stale
 * writer, and post-stop bus.emit("deploy.result", ...) still routed
 * through `writer.write(...)`.
 *
 * Assertion shape: bind the CP, capture writes (count=0), emit one
 * deploy.result (writes=1), call handle.stop(), emit another
 * deploy.result, assert writes stayed at 1 (the listener detached).
 */
describe("orchestrator R2-F1: CP deploy.result unsub release on stop", () => {
  let port = 0;
  let alertsDir: string;
  let cpStopFn: (() => Promise<void>) | null = null;
  const writes: ProbeResult[] = [];

  beforeEach(async () => {
    port = await pickPort();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-r2f1-"));
    alertsDir = path.join(root, "alerts");
    await fs.mkdir(alertsDir, { recursive: true });
    writes.length = 0;
  });

  afterEach(async () => {
    if (cpStopFn) {
      await cpStopFn().catch(() => undefined);
      cpStopFn = null;
    }
    await fs.rm(alertsDir, { recursive: true, force: true });
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.doUnmock("@hono/node-server");
    vi.doUnmock("./storage/pb-client.js");
    vi.doUnmock("./writers/status-writer.js");
  });

  async function mountMocks(): Promise<void> {
    vi.resetModules();
    vi.doMock("@hono/node-server", async () => {
      const actual =
        await vi.importActual<typeof import("@hono/node-server")>(
          "@hono/node-server",
        );
      return { ...actual };
    });
    vi.doMock("./storage/pb-client.js", async () => {
      const actual = await vi.importActual<
        typeof import("./storage/pb-client.js")
      >("./storage/pb-client.js");
      return {
        ...actual,
        createPbClient: () => ({
          health: async () => true,
          getOne: async () => null,
          getFirst: async () => null,
          getList: async () => ({ items: [] }),
        }),
      };
    });
    vi.doMock("./writers/status-writer.js", async () => {
      const actual = await vi.importActual<
        typeof import("./writers/status-writer.js")
      >("./writers/status-writer.js");
      return {
        ...actual,
        createStatusWriter: (): StatusWriter => ({
          write: async (result: ProbeResult) => {
            writes.push(result);
            return {
              previousState: null,
              newState: "green",
              transition: "first",
              firstFailureAt: null,
              failCount: 0,
              persisted: true,
            };
          },
          writeOverlay: async (): Promise<OverlayWriteOutcome> => ({
            applied: false,
            state: null,
            historyPersisted: false,
          }),
        }),
      };
    });
  }

  function emitDeployResult(bus: ReturnType<typeof createEventBus>): void {
    bus.emit("deploy.result", {
      runId: "r2f1-test-runid",
      runUrl: "https://example.invalid/runs/r2f1",
      services: ["showcase-shell-docs"],
      failed: [],
      succeeded: ["showcase-shell-docs"],
      cancelled: false,
      gateSkipped: false,
      gateReason: undefined,
      buildRunId: undefined,
      buildRunUrl: undefined,
    });
  }

  it("CP stop() releases the deploy.result subscription (post-stop emit does NOT route to writer.write)", async () => {
    vi.stubEnv("SHARED_SECRET", "r2f1-test-secret");
    vi.stubEnv("NODE_ENV", "test");
    await mountMocks();
    const orchMod = await import("./orchestrator.js");
    const handle = await orchMod.runControlPlane(
      { role: "control-plane", poolCount: 1 },
      { port, configDir: alertsDir, fleetEnumerate: async () => [] },
    );

    // Pre-stop: a deploy.result emit must reach writer.write (proves the
    // subscription is live).
    const baseline = writes.filter((r) => r.key === "deploy:overall").length;
    emitDeployResult(handle.bus);
    await Promise.resolve();
    await Promise.resolve();
    const afterEmit = writes.filter((r) => r.key === "deploy:overall").length;
    expect(afterEmit - baseline).toBe(1);

    // Stop the CP — R2-F1: the deploy.result unsub must run.
    await handle.stop();
    cpStopFn = null; // already stopped

    // Post-stop: another deploy.result emit must NOT reach writer.write
    // (pre-fix this would route through the leaked listener against the
    // stale writer).
    emitDeployResult(handle.bus);
    await Promise.resolve();
    await Promise.resolve();
    const afterStopEmit = writes.filter(
      (r) => r.key === "deploy:overall",
    ).length;
    expect(afterStopEmit).toBe(afterEmit);
  });
});

/**
 * R2-F2: `subscribeDeployResults` must emit `deploy.writer.failed` (in
 * addition to logging) when `writer.write(...)` rejects, so alert rules /
 * metrics subscribers can observe deploy-writer failures as a first-class
 * bus event rather than only via the error log.
 *
 * Drives the helper directly with a real bus + a writer stub whose
 * `write` rejects, then asserts the new event fired with the err message
 * payload.
 */
describe("orchestrator R2-F2: deploy.writer.failed bus event on write failure", () => {
  it("emits `deploy.writer.failed` when writer.write rejects", async () => {
    const orchMod = await import("./orchestrator.js");
    const bus = createEventBus();
    const writer: Pick<StatusWriter, "write"> = {
      write: async () => {
        throw new Error("pb-blew-up");
      },
    };
    const emits: Array<{ event: string; payload: unknown }> = [];
    bus.on("deploy.writer.failed", (payload) => {
      emits.push({ event: "deploy.writer.failed", payload });
    });

    const unsub = orchMod.subscribeDeployResults(bus, writer);

    bus.emit("deploy.result", {
      runId: "r2f2-runid",
      runUrl: "https://example.invalid/runs/r2f2",
      services: ["showcase-shell-docs"],
      failed: ["showcase-shell-docs"],
      succeeded: [],
      cancelled: false,
      gateSkipped: false,
      gateReason: undefined,
      buildRunId: undefined,
      buildRunUrl: undefined,
    });

    // The handler's `.catch` runs on the next microtask after writer.write
    // rejects — yield a couple of microtasks for the chain to settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(emits.length).toBe(1);
    expect(emits[0].event).toBe("deploy.writer.failed");
    const payload = emits[0].payload as { err: string };
    expect(payload.err).toContain("pb-blew-up");

    unsub();
  });
});

/**
 * R3-F2: `subscribeDeployResults` must ALSO emit `deploy.writer.failed`
 * (and log) when the synchronous mapping helper `deployEventToProbeResult`
 * THROWS — not just when the async `writer.write(...)` rejects. Pre-fix
 * the `.catch` only covered the write promise, so a sync throw inside
 * the mapping (malformed event, unexpected type drift) bypassed both the
 * log and the bus emit, and the failure was effectively swallowed by
 * the bus handler boundary.
 */
describe("orchestrator R3-F2: deploy.writer.failed on subscribeDeployResults sync throw", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("./probes/deploy-result.js");
  });

  it("emits `deploy.writer.failed` when deployEventToProbeResult throws synchronously", async () => {
    vi.resetModules();
    vi.doMock("./probes/deploy-result.js", async () => {
      const actual = await vi.importActual<
        typeof import("./probes/deploy-result.js")
      >("./probes/deploy-result.js");
      return {
        ...actual,
        deployEventToProbeResult: () => {
          throw new Error("mapping-blew-up-sync");
        },
      };
    });

    const orchMod = await import("./orchestrator.js");
    const busMod = await import("./events/event-bus.js");
    const bus = busMod.createEventBus();
    // Writer must NOT be called on a sync mapping throw — assert it stays
    // untouched so the test pins down "throw fires before write".
    let writeCalls = 0;
    const writer: Pick<StatusWriter, "write"> = {
      write: async () => {
        writeCalls += 1;
        return {
          previousState: null,
          newState: "green",
          transition: "first",
          firstFailureAt: null,
          failCount: 0,
          persisted: true,
        };
      },
    };
    const emits: Array<{ event: string; payload: unknown }> = [];
    bus.on("deploy.writer.failed", (payload) => {
      emits.push({ event: "deploy.writer.failed", payload });
    });

    const unsub = orchMod.subscribeDeployResults(bus, writer);

    // Emit must NOT throw out of the bus handler boundary — the helper
    // catches synchronously and converts to a bus emit.
    expect(() => {
      bus.emit("deploy.result", {
        runId: "r3f2-runid",
        runUrl: "https://example.invalid/runs/r3f2",
        services: ["showcase-shell-docs"],
        failed: [],
        succeeded: ["showcase-shell-docs"],
        cancelled: false,
        gateSkipped: false,
        gateReason: undefined,
        buildRunId: undefined,
        buildRunUrl: undefined,
      });
    }).not.toThrow();

    // Sync throw — no microtask wait needed, but yield one for symmetry
    // with the R2-F2 assertion shape.
    await Promise.resolve();

    expect(writeCalls).toBe(0);
    expect(emits.length).toBe(1);
    expect(emits[0].event).toBe("deploy.writer.failed");
    const payload = emits[0].payload as { err: string };
    expect(payload.err).toContain("mapping-blew-up-sync");

    unsub();
  });
});
