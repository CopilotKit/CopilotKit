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
    expect(body).toContain('showcase_ops_probe_runs{dimension="smoke"} 1');
    expect(body).toContain("showcase_ops_hmac_failures 1");
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
