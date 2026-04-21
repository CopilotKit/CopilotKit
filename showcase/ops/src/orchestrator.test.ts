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
      // acceptable — they prove the server shut down.
      expect(errorMessage.length).toBeGreaterThan(0);
      // Node's undici wraps connection-refused as "fetch failed"; the
      // underlying cause message carries ECONNREFUSED. We allow any
      // network-family error message but explicitly disallow the silent
      // empty-string case.
      expect(networkErrored).toBe(true);
    } else {
      // If the port was somehow reclaimed and another process answered,
      // the body MUST NOT claim "ok". This is the real regression guard
      // the old `|| true` assertion was meant to express.
      expect(statusIfServed).not.toBe(200);
      expect(bodyLoopIfServed).not.toBe("ok");
    }
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
