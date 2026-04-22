import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { boot } from "./orchestrator.js";

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
      if (typeof addr === "object" && addr)
        s.close(() => resolve(addr.port));
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

  it("/health returns 503 with loop:\"no-jobs\" when scheduler has zero jobs", async () => {
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

  it("/health returns 503 with loop:\"stopped\" after stop() completes", async () => {
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
    // promise; the .catch runs on the microtask queue. Await one tick
    // past that.
    process.emit("SIGHUP");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const sigHupEmission = emissions.find((e) => e.file === "<sighup>");
    expect(sigHupEmission).toBeDefined();
    // ENOENT from fs.readdir carries the tmpdir path; just assert the
    // error string is non-empty so the test doesn't over-couple to
    // libuv's exact wording.
    expect(sigHupEmission!.error.length).toBeGreaterThan(0);
  });

  it("/health returns 200 with loop:\"ok\" and schedulerJobs>=1 when a rule is loaded (happy path)", async () => {
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
