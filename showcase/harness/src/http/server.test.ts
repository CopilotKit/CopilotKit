import { describe, it, expect } from "vitest";
import { buildServer } from "./server.js";
import { logger } from "../logger.js";
import { createMetricsRegistry } from "./metrics.js";
import type { PbClient } from "../storage/pb-client.js";

function fakePb(healthy: boolean): PbClient {
  return {
    getOne: async () => null,
    getFirst: async () => null,
    list: async () => ({
      page: 1,
      perPage: 0,
      totalPages: 0,
      totalItems: 0,
      items: [],
    }),
    create: async () => ({}) as never,
    update: async () => ({}) as never,
    upsertByField: async () => ({}) as never,
    delete: async () => {},
    deleteByFilter: async () => 0,
    health: async () => healthy,
    createBackup: async () => {},
    downloadBackup: async () => new Uint8Array(),
    deleteBackup: async () => {},
  };
}

describe("http/server", () => {
  it("GET /health returns 200 when pb up, loop alive, rules>0", async () => {
    const app = buildServer({
      pb: fakePb(true),
      logger,
      ruleCount: () => 1,
      loopAlive: () => true,
      schedulerJobCount: () => 1,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      pb: string;
      rules: number;
    };
    expect(body.status).toBe("ok");
    expect(body.pb).toBe("ok");
    expect(body.rules).toBe(1);
  });

  it("GET /health returns 503 with loop:no-jobs when scheduler has zero entries", async () => {
    // Regression: if rule-loader crashes or loads zero rules, the HTTP
    // server still reports healthy because loopAlive/schedulerStarted
    // don't care about job count. Require schedulerJobCount > 0 so
    // this pathological state surfaces in /health.
    const app = buildServer({
      pb: fakePb(true),
      logger,
      ruleCount: () => 1,
      loopAlive: () => true,
      schedulerStarted: () => true,
      schedulerJobCount: () => 0,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      loop: string;
      status: string;
      schedulerJobs: number;
    };
    expect(body.loop).toBe("no-jobs");
    expect(body.schedulerJobs).toBe(0);
    expect(body.status).toBe("degraded");
  });

  it("GET /health returns 503 with loop:stopped when schedulerIsStopped is true even if alive was never flipped", async () => {
    const app = buildServer({
      pb: fakePb(true),
      logger,
      ruleCount: () => 1,
      loopAlive: () => true, // legacy flag, still true
      schedulerStarted: () => true,
      schedulerIsStopped: () => true, // but scheduler.stop() completed
      schedulerJobCount: () => 0,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { loop: string };
    expect(body.loop).toBe("stopped");
  });

  it("GET /health returns 200 when all scheduler signals are healthy", async () => {
    const app = buildServer({
      pb: fakePb(true),
      logger,
      ruleCount: () => 3,
      loopAlive: () => true,
      schedulerStarted: () => true,
      schedulerIsStopped: () => false,
      schedulerJobCount: () => 5,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      loop: string;
      schedulerJobs: number;
    };
    expect(body.loop).toBe("ok");
    expect(body.schedulerJobs).toBe(5);
  });

  it("GET /health returns 503 when pb down", async () => {
    const app = buildServer({
      pb: fakePb(false),
      logger,
      ruleCount: () => 1,
      loopAlive: () => true,
      schedulerJobCount: () => 1,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
  });

  it("GET /health returns 503 when no rules loaded", async () => {
    const app = buildServer({
      pb: fakePb(true),
      logger,
      ruleCount: () => 0,
      loopAlive: () => true,
      schedulerJobCount: () => 1,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
  });

  it("GET /health returns 503 when loop not alive", async () => {
    const app = buildServer({
      pb: fakePb(true),
      logger,
      ruleCount: () => 1,
      loopAlive: () => false,
      schedulerJobCount: () => 1,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
  });

  it("GET /health reports loop:starting (503) when scheduler has not started", async () => {
    const app = buildServer({
      pb: fakePb(true),
      logger,
      ruleCount: () => 1,
      loopAlive: () => true,
      schedulerStarted: () => false,
      schedulerJobCount: () => 1,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { loop: string; status: string };
    expect(body.loop).toBe("starting");
    expect(body.status).toBe("degraded");
  });

  it("GET /health reports loop:ok when scheduler has started and is alive", async () => {
    const app = buildServer({
      pb: fakePb(true),
      logger,
      ruleCount: () => 1,
      loopAlive: () => true,
      schedulerStarted: () => true,
      schedulerJobCount: () => 1,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { loop: string };
    expect(body.loop).toBe("ok");
  });

  it("GET /health reports loop:stopped (503) when loop explicitly stopped even if started", async () => {
    const app = buildServer({
      pb: fakePb(true),
      logger,
      ruleCount: () => 1,
      loopAlive: () => false,
      schedulerStarted: () => true,
      schedulerJobCount: () => 1,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { loop: string };
    expect(body.loop).toBe("stopped");
  });

  it("GET /health (control-plane role) returns 200 with rules=0 when pb/loop/scheduler ok", async () => {
    // The control-plane is a scheduler/queue/aggregator — it legitimately
    // owns NO probe rules, only the single fleet-job-producer scheduler
    // entry. The default `rules > 0` gate is wrong for that role; with
    // role:"control-plane" the endpoint reports healthy on its real
    // liveness signals (pb ok, scheduler started + alive, schedulerJobs>0)
    // WITHOUT requiring rules.
    const app = buildServer({
      pb: fakePb(true),
      logger,
      role: "control-plane",
      ruleCount: () => 0,
      loopAlive: () => true,
      schedulerStarted: () => true,
      schedulerIsStopped: () => false,
      schedulerJobCount: () => 1,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      rules: number;
      loop: string;
      schedulerJobs: number;
    };
    expect(body.status).toBe("ok");
    expect(body.rules).toBe(0);
    expect(body.loop).toBe("ok");
    expect(body.schedulerJobs).toBe(1);
  });

  it("GET /health (control-plane role) still returns 503 when pb is down", async () => {
    const app = buildServer({
      pb: fakePb(false),
      logger,
      role: "control-plane",
      ruleCount: () => 0,
      loopAlive: () => true,
      schedulerStarted: () => true,
      schedulerJobCount: () => 1,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; pb: string };
    expect(body.status).toBe("degraded");
    expect(body.pb).toBe("down");
  });

  it("GET /health (control-plane role) still returns 503 when scheduler has no jobs", async () => {
    // Even role-aware, the control-plane MUST surface a dead scheduler: if
    // the fleet-job-producer entry is missing (schedulerJobs==0) nothing
    // ticks, so /health must report degraded regardless of the rules gate.
    const app = buildServer({
      pb: fakePb(true),
      logger,
      role: "control-plane",
      ruleCount: () => 0,
      loopAlive: () => true,
      schedulerStarted: () => true,
      schedulerJobCount: () => 0,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; loop: string };
    expect(body.status).toBe("degraded");
    expect(body.loop).toBe("no-jobs");
  });

  it("GET /health (control-plane role) still returns 503 when loop not alive", async () => {
    const app = buildServer({
      pb: fakePb(true),
      logger,
      role: "control-plane",
      ruleCount: () => 0,
      loopAlive: () => false,
      schedulerStarted: () => true,
      schedulerJobCount: () => 1,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("degraded");
  });

  it("GET /health (worker/default role) still requires rules>0 (regression guard)", async () => {
    // The role-aware change must NOT loosen the worker/legacy path: with no
    // role (or a non-control-plane role) the rules>0 gate stays in force.
    const app = buildServer({
      pb: fakePb(true),
      logger,
      ruleCount: () => 0,
      loopAlive: () => true,
      schedulerStarted: () => true,
      schedulerJobCount: () => 1,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
  });

  it("GET /metrics exposes Prometheus-format counters when metrics is provided", async () => {
    const metrics = createMetricsRegistry();
    metrics.inc("probe_runs", { dimension: "smoke" });
    metrics.inc("hmac_failures");
    const app = buildServer({
      pb: fakePb(true),
      logger,
      ruleCount: () => 1,
      loopAlive: () => true,
      schedulerJobCount: () => 1,
      metrics,
    });
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain('showcase_harness_probe_runs{dimension="smoke"} 1');
    expect(body).toContain("showcase_harness_hmac_failures 1");
  });

  it("GET /metrics returns 404 when metrics registry is absent", async () => {
    const app = buildServer({
      pb: fakePb(true),
      logger,
      ruleCount: () => 1,
      loopAlive: () => true,
      schedulerJobCount: () => 1,
    });
    const res = await app.request("/metrics");
    expect(res.status).toBe(404);
  });

  it("fleet-runs routes mount when fleetRuns deps supplied and are absent otherwise", async () => {
    const summaryBody = { families: [], workers: [] };
    const base = {
      pb: fakePb(true),
      logger,
      ruleCount: () => 1,
      loopAlive: () => true,
      schedulerJobCount: () => 1,
    };
    const withRoutes = buildServer({
      ...base,
      fleetRuns: {
        summary: { get: async () => summaryBody },
        pb: fakePb(true),
        schedules: [],
        scheduler: { nextRunAt: () => null },
        workerStaleAfterMs: 180_000,
        logger,
      },
    });
    const mounted = await withRoutes.request("/api/runs");
    expect(mounted.status).toBe(200);
    expect(await mounted.json()).toEqual(summaryBody);
    const without = buildServer(base);
    const absent = await without.request("/api/runs");
    expect(absent.status).toBe(404);
  });

  it("GET /health carries fleetRuns.lastEvaluatedAt when wired, omits it otherwise", async () => {
    const evaluatedAtMs = Date.parse("2026-06-10T18:00:00.000Z");
    const base = {
      pb: fakePb(true),
      logger,
      ruleCount: () => 1,
      loopAlive: () => true,
      schedulerJobCount: () => 1,
    };
    const wired = buildServer({
      ...base,
      fleetRunsLastEvaluatedAt: () => evaluatedAtMs,
    });
    const res = await wired.request("/health");
    const body = (await res.json()) as {
      fleetRuns?: { lastEvaluatedAt: string | null };
    };
    expect(body.fleetRuns?.lastEvaluatedAt).toBe(
      new Date(evaluatedAtMs).toISOString(),
    );
    // Null stamp (monitor constructed but never evaluated) serializes null.
    const nullWired = buildServer({
      ...base,
      fleetRunsLastEvaluatedAt: () => null,
    });
    const nullBody = (await (await nullWired.request("/health")).json()) as {
      fleetRuns?: { lastEvaluatedAt: string | null };
    };
    expect(nullBody.fleetRuns).toEqual({ lastEvaluatedAt: null });
    // Absent callback → no fleetRuns field at all.
    const plain = buildServer(base);
    const plainBody = (await (await plain.request("/health")).json()) as {
      fleetRuns?: unknown;
    };
    expect(plainBody.fleetRuns).toBeUndefined();
  });

  it("buildServer throws synchronously when schedulerJobCount is not supplied", () => {
    // Fail-loud discipline: the previous behaviour treated a missing
    // `schedulerJobCount` as "OK by default" (jobCountOk = true), so an
    // orchestrator that forgot to wire the callback would silently report
    // /health: 200 with zero cron jobs. Production must always supply it;
    // surface the misconfiguration as a hard boot-time failure rather than
    // a quiet `loop: ok` lie.
    expect(() =>
      // @ts-expect-error — schedulerJobCount is now required; this call
      // must fail to compile AND fail at runtime so misconfigured boot
      // paths cannot reach a misleading /health response.
      buildServer({
        pb: fakePb(true),
        logger,
        ruleCount: () => 1,
        loopAlive: () => true,
      }),
    ).toThrow(/schedulerJobCount/);
  });
});
