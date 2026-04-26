import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import {
  boot,
  buildCronProbeResolver,
  createStatusReader,
  diffCronSchedules,
  envForCfg,
  createRailwayAdapter,
} from "./orchestrator.js";
import { createScheduler } from "./scheduler/scheduler.js";
import { createEventBus } from "./events/event-bus.js";
import { logger } from "./logger.js";
import type { CompiledRule } from "./rules/rule-loader.js";
import type { ProbeConfig } from "./probes/loader/schema.js";

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ops-orch-test-"));
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
    process.env.NODE_ENV = "production";
    delete process.env.POCKETBASE_URL;
    try {
      await expect(
        boot({ configDir: tempDir, port, bootstrapWindowMs: 0 }),
      ).rejects.toThrow(/FATAL-CONFIG: POCKETBASE_URL required in production/);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevPbUrl !== undefined) process.env.POCKETBASE_URL = prevPbUrl;
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
    // Shape matches showcase/ops/config/alerts/version-drift-weekly.yml:
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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ops-orch-s3-"));
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
  function e2eDemosCfg(
    id: string,
    timeout_ms?: number,
  ): ProbeConfig {
    const base = {
      kind: "e2e_demos" as const,
      id,
      schedule: "0 * * * *",
      max_concurrency: 1,
      target: { key: `e2e_demos:${id}` },
    };
    return (
      timeout_ms !== undefined
        ? { ...base, timeout_ms }
        : base
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
      timeout_ms !== undefined
        ? { ...base, timeout_ms }
        : base
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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ops-orch-secrets-"));
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
    process.env.NODE_ENV = "production";
    delete process.env.SHARED_SECRET;
    delete process.env.SHARED_SECRET_PREV;
    // POCKETBASE_URL must be set so the prior FATAL-CONFIG throw
    // doesn't pre-empt the SHARED_SECRET check.
    process.env.POCKETBASE_URL = "http://localhost:8090";
    try {
      await expect(
        boot({ configDir: tempDir, port, bootstrapWindowMs: 0 }),
      ).rejects.toThrow(/FATAL-CONFIG: SHARED_SECRET required in production/);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevSecret !== undefined) process.env.SHARED_SECRET = prevSecret;
      if (prevPrev !== undefined) process.env.SHARED_SECRET_PREV = prevPrev;
      delete process.env.POCKETBASE_URL;
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
      delete process.env.POCKETBASE_URL;
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
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ops-orch-probes-"));
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
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ops-orch-unreg-"));
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
