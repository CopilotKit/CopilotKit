import { Hono } from "hono";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  registerProbesRoutes,
  TRIGGER_RATE_LIMIT_MS,
  type ProbesRouteDeps,
} from "./probes.js";
import {
  type Scheduler,
  type EntryStatus,
  type ScheduleEntry,
  type TriggerOptions,
  type TriggerResult,
  InflightConflictError,
} from "../scheduler/scheduler.js";
import { ProbeRunTracker } from "../probes/run-tracker.js";
import type { ProbeRunRecord, ProbeRunWriter } from "../probes/run-history.js";
import type { ProbeConfig } from "../probes/loader/schema.js";

const TOKEN = "test-trigger-token";

/**
 * Simulated entries map for the fake scheduler — each id has an EntryStatus
 * snapshot AND a ScheduleEntry. Tests mutate this map directly to model
 * "inflight" / "lastRun" / etc. without driving the real cron clock.
 */
interface FakeEntryRow {
  entry: ScheduleEntry;
  status: EntryStatus;
  nextRunAt: Date | null;
}

interface FakeScheduler extends Scheduler {
  /** Test-only: install an entry into the fake. */
  setEntry(row: FakeEntryRow): void;
  /** Test-only: install the trigger() return / throw behavior. */
  setTriggerBehavior(behavior: { throw?: Error; result?: TriggerResult }): void;
  /** Test-only: capture last trigger() invocation. */
  lastTriggerOpts: TriggerOptions | undefined;
}

function makeFakeScheduler(): FakeScheduler {
  const entries = new Map<string, FakeEntryRow>();
  let triggerThrow: Error | undefined;
  let triggerResult: TriggerResult | undefined;
  const fake: FakeScheduler = {
    register: () => {},
    unregister: async () => false,
    hasEntry: (id) => entries.has(id),
    list: () => [...entries.values()].map((r) => r.entry),
    start: () => {},
    stop: async () => {},
    isStarted: () => true,
    isStopped: () => false,
    getJobCount: () => entries.size,
    getEntry: (id) => entries.get(id)?.status,
    trigger: async (id, opts) => {
      fake.lastTriggerOpts = opts;
      if (!entries.has(id)) {
        throw new Error(`scheduler: unknown entry ${id}`);
      }
      if (triggerThrow) throw triggerThrow;
      return (
        triggerResult ?? { runId: "run_default", status: "queued", probe: id }
      );
    },
    nextRunAt: (id) => entries.get(id)?.nextRunAt ?? null,
    // F1: B7 widened the Scheduler interface with `setEntryTracker` for the
    // probe-invoker hook. Test fakes don't drive a real run, so this is a
    // no-op — kept structural so a future test that wants to assert the
    // invoker called it can override on the fake instance.
    setEntryTracker: () => {},
    setEntry: (row) => entries.set(row.entry.id, row),
    setTriggerBehavior: ({ throw: t, result }) => {
      triggerThrow = t;
      triggerResult = result;
    },
    lastTriggerOpts: undefined,
  };
  return fake;
}

function makeFakeWriter(): ProbeRunWriter & {
  setRecent: (probeId: string, runs: ProbeRunRecord[]) => void;
} {
  const recentMap = new Map<string, ProbeRunRecord[]>();
  return {
    start: async () => ({ id: "row1" }),
    finish: async () => {},
    recent: async (probeId, _limit) => recentMap.get(probeId) ?? [],
    setRecent: (probeId, runs) => recentMap.set(probeId, runs),
  };
}

function baseStatus(overrides: Partial<EntryStatus>): EntryStatus {
  return {
    id: "smoke",
    cron: "*/5 * * * *",
    inflight: 0,
    lastRunStartedAt: null,
    lastRunFinishedAt: null,
    lastRunDurationMs: null,
    lastRunSummary: null,
    triggeredRun: false,
    tracker: null,
    ...overrides,
  };
}

function baseConfig(id: string, kind = "smoke"): ProbeConfig {
  return {
    kind: kind as ProbeConfig["kind"],
    id,
    schedule: "*/5 * * * *",
    timeout_ms: 30_000,
    max_concurrency: 4,
    targets: [{ key: "x", url: "https://example.com" }],
  } as ProbeConfig;
}

interface BuildOpts {
  now?: () => number;
  withAuth?: boolean;
}

function buildApp(
  scheduler: FakeScheduler,
  writer: ProbeRunWriter,
  configs: Map<string, ProbeConfig>,
  opts: BuildOpts = {},
): Hono {
  const app = new Hono();
  const deps: ProbesRouteDeps = {
    scheduler,
    writer,
    getProbeConfig: (id) => configs.get(id),
    triggerToken: opts.withAuth === false ? undefined : TOKEN,
    now: opts.now ?? (() => Date.now()),
  };
  registerProbesRoutes(app, deps);
  return app;
}

describe("GET /api/probes", () => {
  it("returns the schedule envelope with id/kind/schedule/nextRunAt/lastRun/inflight/config", async () => {
    const sched = makeFakeScheduler();
    const writer = makeFakeWriter();
    const configs = new Map<string, ProbeConfig>([
      ["smoke", baseConfig("smoke", "smoke")],
    ]);
    const next = new Date("2026-01-01T00:05:00Z");
    sched.setEntry({
      entry: { id: "smoke", cron: "*/5 * * * *", handler: async () => {} },
      status: baseStatus({
        id: "smoke",
        cron: "*/5 * * * *",
        lastRunStartedAt: Date.parse("2026-01-01T00:00:00Z"),
        lastRunFinishedAt: Date.parse("2026-01-01T00:00:01Z"),
        lastRunDurationMs: 1000,
        lastRunSummary: { total: 3, passed: 2, failed: 1 },
      }),
      nextRunAt: next,
    });

    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const body = (await res.json()) as { probes: unknown[] };
    expect(Array.isArray(body.probes)).toBe(true);
    expect(body.probes).toHaveLength(1);
    const p = body.probes[0] as Record<string, unknown>;
    expect(p.id).toBe("smoke");
    expect(p.kind).toBe("smoke");
    expect(p.schedule).toBe("*/5 * * * *");
    expect(p.nextRunAt).toBe(next.toISOString());
    expect(p.lastRun).toEqual({
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1000,
      state: "completed",
      summary: { total: 3, passed: 2, failed: 1 },
    });
    expect(p.inflight).toBeNull();
    expect(p.config).toEqual({
      timeout_ms: 30_000,
      max_concurrency: 4,
      discovery: null,
    });
  });

  it("renders inflight from slot.tracker.snapshot() when present", async () => {
    const sched = makeFakeScheduler();
    const writer = makeFakeWriter();
    const configs = new Map<string, ProbeConfig>([
      ["smoke", baseConfig("smoke")],
    ]);
    const tracker = new ProbeRunTracker({
      probeId: "smoke",
      now: () => Date.parse("2026-01-01T00:00:10Z"),
    });
    tracker.start("svc-a");
    tracker.complete("svc-a", "green");

    sched.setEntry({
      entry: { id: "smoke", cron: "*/5 * * * *", handler: async () => {} },
      status: baseStatus({
        id: "smoke",
        cron: "*/5 * * * *",
        inflight: 1,
        lastRunStartedAt: Date.parse("2026-01-01T00:00:10Z"),
        // tracker is a structural type — pass our concrete tracker; the
        // route only ever reads tracker.snapshot() so the structural shape
        // matches.
        tracker: tracker as unknown as EntryStatus["tracker"],
      }),
      nextRunAt: null,
    });

    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes");
    const body = (await res.json()) as {
      probes: Array<Record<string, unknown>>;
    };
    const p = body.probes[0];
    const inflight = p.inflight as Record<string, unknown>;
    expect(inflight).not.toBeNull();
    expect(typeof inflight.startedAt).toBe("string");
    expect(typeof inflight.elapsedMs).toBe("number");
    expect(Array.isArray(inflight.services)).toBe(true);
    const services = inflight.services as Array<Record<string, unknown>>;
    expect(services).toHaveLength(1);
    expect(services[0].slug).toBe("svc-a");
    expect(services[0].state).toBe("completed");
    expect(services[0].result).toBe("green");
  });

  it("renders lastRun as null when handler has never finished", async () => {
    const sched = makeFakeScheduler();
    const writer = makeFakeWriter();
    const configs = new Map<string, ProbeConfig>([
      ["smoke", baseConfig("smoke")],
    ]);
    sched.setEntry({
      entry: { id: "smoke", cron: "*/5 * * * *", handler: async () => {} },
      status: baseStatus({ id: "smoke", cron: "*/5 * * * *" }),
      nextRunAt: new Date(),
    });
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes");
    const body = (await res.json()) as {
      probes: Array<Record<string, unknown>>;
    };
    expect(body.probes[0].lastRun).toBeNull();
  });

  it("renders nextRunAt as null when scheduler returns null", async () => {
    const sched = makeFakeScheduler();
    const writer = makeFakeWriter();
    const configs = new Map<string, ProbeConfig>([
      ["smoke", baseConfig("smoke")],
    ]);
    sched.setEntry({
      entry: { id: "smoke", cron: "*/5 * * * *", handler: async () => {} },
      status: baseStatus({ id: "smoke", cron: "*/5 * * * *" }),
      nextRunAt: null,
    });
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes");
    const body = (await res.json()) as {
      probes: Array<Record<string, unknown>>;
    };
    expect(body.probes[0].nextRunAt).toBeNull();
  });

  it("populates config.discovery for discovery probes", async () => {
    const sched = makeFakeScheduler();
    const writer = makeFakeWriter();
    const cfg: ProbeConfig = {
      kind: "smoke" as ProbeConfig["kind"],
      id: "dynamic",
      schedule: "*/10 * * * *",
      timeout_ms: 60_000,
      max_concurrency: 4,
      discovery: {
        source: "railway-services",
        key_template: "{slug}",
      },
    } as ProbeConfig;
    const configs = new Map<string, ProbeConfig>([["dynamic", cfg]]);
    sched.setEntry({
      entry: { id: "dynamic", cron: "*/10 * * * *", handler: async () => {} },
      status: baseStatus({ id: "dynamic", cron: "*/10 * * * *" }),
      nextRunAt: null,
    });
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes");
    const body = (await res.json()) as {
      probes: Array<Record<string, unknown>>;
    };
    const p = body.probes[0];
    const config = p.config as Record<string, unknown>;
    expect(config.discovery).toEqual({
      source: "railway-services",
      key_template: "{slug}",
    });
  });
});

describe("GET /api/probes/:id", () => {
  it("returns probe + recent runs", async () => {
    const sched = makeFakeScheduler();
    const writer = makeFakeWriter();
    const configs = new Map<string, ProbeConfig>([
      ["smoke", baseConfig("smoke")],
    ]);
    sched.setEntry({
      entry: { id: "smoke", cron: "*/5 * * * *", handler: async () => {} },
      status: baseStatus({ id: "smoke", cron: "*/5 * * * *" }),
      nextRunAt: null,
    });
    writer.setRecent("smoke", [
      {
        id: "r1",
        probeId: "smoke",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1000,
        triggered: false,
        state: "completed",
        summary: { total: 1, passed: 1, failed: 0 },
      },
    ]);
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/smoke");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const body = (await res.json()) as {
      probe: Record<string, unknown>;
      runs: Array<Record<string, unknown>>;
    };
    expect(body.probe.id).toBe("smoke");
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].id).toBe("r1");
    expect(body.runs[0].triggered).toBe(false);
    expect(body.runs[0].summary).toEqual({ total: 1, passed: 1, failed: 0 });
  });

  it("returns 404 with {error: 'not_found'} when id is unknown", async () => {
    const sched = makeFakeScheduler();
    const writer = makeFakeWriter();
    const app = buildApp(sched, writer, new Map());
    const res = await app.request("/api/probes/missing");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "not_found" });
  });
});

describe("POST /api/probes/:id/trigger", () => {
  let sched: FakeScheduler;
  let writer: ReturnType<typeof makeFakeWriter>;
  let configs: Map<string, ProbeConfig>;

  beforeEach(() => {
    sched = makeFakeScheduler();
    writer = makeFakeWriter();
    configs = new Map<string, ProbeConfig>([["smoke", baseConfig("smoke")]]);
    sched.setEntry({
      entry: { id: "smoke", cron: "*/5 * * * *", handler: async () => {} },
      status: baseStatus({ id: "smoke", cron: "*/5 * * * *" }),
      nextRunAt: null,
    });
  });

  it("returns 401 without bearer token", async () => {
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong bearer token", async () => {
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 + queued envelope with valid bearer token", async () => {
    sched.setTriggerBehavior({
      result: { runId: "run_xyz", status: "queued", probe: "smoke" },
    });
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const body = await res.json();
    expect(body).toEqual({
      runId: "run_xyz",
      status: "queued",
      probe: "smoke",
      scope: [],
    });
  });

  it("returns 200 with scope echoing filter.slugs", async () => {
    sched.setTriggerBehavior({
      result: { runId: "run_xyz", status: "queued", probe: "smoke" },
    });
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filter: { slugs: ["a", "b"] } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.scope).toEqual(["a", "b"]);
    // The route must pass the filter through to scheduler.trigger so
    // when the invoker (B7) starts honouring it, callers don't have to
    // re-wire.
    expect(sched.lastTriggerOpts).toEqual({ filter: { slugs: ["a", "b"] } });
  });

  it("returns 409 {error: 'inflight'} when scheduler.trigger throws InflightConflictError", async () => {
    sched.setTriggerBehavior({ throw: new InflightConflictError("smoke") });
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "inflight" });
  });

  it("returns 404 when id is unknown", async () => {
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/missing/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "not_found" });
  });

  it("returns 429 when triggered twice within rate-limit window", async () => {
    sched.setTriggerBehavior({
      result: { runId: "run_1", status: "queued", probe: "smoke" },
    });
    let nowMs = 1_000_000_000_000;
    const app = buildApp(sched, writer, configs, { now: () => nowMs });
    const first = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(first.status).toBe(200);
    // Second call inside the rate-limit window
    nowMs += TRIGGER_RATE_LIMIT_MS - 1000;
    const second = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(second.status).toBe(429);
    const body = await res2Body(second);
    expect(body.error).toBe("rate_limited");
  });

  it("allows another trigger once the rate-limit window passes", async () => {
    sched.setTriggerBehavior({
      result: { runId: "run_1", status: "queued", probe: "smoke" },
    });
    let nowMs = 1_000_000_000_000;
    const app = buildApp(sched, writer, configs, { now: () => nowMs });
    const first = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(first.status).toBe(200);
    nowMs += TRIGGER_RATE_LIMIT_MS + 1;
    const second = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(second.status).toBe(200);
  });

  it("rate limit is per-probe (different ids don't share the window)", async () => {
    sched.setEntry({
      entry: { id: "other", cron: "* * * * *", handler: async () => {} },
      status: baseStatus({ id: "other", cron: "* * * * *" }),
      nextRunAt: null,
    });
    configs.set("other", baseConfig("other"));
    sched.setTriggerBehavior({
      result: { runId: "run_1", status: "queued", probe: "smoke" },
    });
    const app = buildApp(sched, writer, configs);
    const first = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(first.status).toBe(200);
    const second = await app.request("/api/probes/other/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(second.status).toBe(200);
  });

  it("does not record the rate-limit timestamp on a 4xx/5xx trigger failure", async () => {
    // If the scheduler rejects (e.g. InflightConflict), a follow-up
    // legitimate trigger after the conflict clears must not be blocked
    // by a 5-min rate-limit hold.
    sched.setTriggerBehavior({ throw: new InflightConflictError("smoke") });
    let nowMs = 1_000_000_000_000;
    const app = buildApp(sched, writer, configs, { now: () => nowMs });
    const first = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(first.status).toBe(409);
    // Now the inflight conflict resolves; trigger should succeed
    sched.setTriggerBehavior({
      result: { runId: "run_2", status: "queued", probe: "smoke" },
    });
    nowMs += 1_000;
    const second = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(second.status).toBe(200);
  });
});

describe("GET routes do not require auth", () => {
  it("GET /api/probes works without Authorization header", async () => {
    const sched = makeFakeScheduler();
    const writer = makeFakeWriter();
    sched.setEntry({
      entry: { id: "smoke", cron: "*/5 * * * *", handler: async () => {} },
      status: baseStatus({ id: "smoke", cron: "*/5 * * * *" }),
      nextRunAt: null,
    });
    const configs = new Map<string, ProbeConfig>([
      ["smoke", baseConfig("smoke")],
    ]);
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes");
    expect(res.status).toBe(200);
  });

  it("GET /api/probes/:id works without Authorization header", async () => {
    const sched = makeFakeScheduler();
    const writer = makeFakeWriter();
    sched.setEntry({
      entry: { id: "smoke", cron: "*/5 * * * *", handler: async () => {} },
      status: baseStatus({ id: "smoke", cron: "*/5 * * * *" }),
      nextRunAt: null,
    });
    const configs = new Map<string, ProbeConfig>([
      ["smoke", baseConfig("smoke")],
    ]);
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/smoke");
    expect(res.status).toBe(200);
  });
});

async function res2Body(r: Response): Promise<Record<string, unknown>> {
  return (await r.json()) as Record<string, unknown>;
}
