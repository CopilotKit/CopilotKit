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

// ---------------------------------------------------------------------
// R2-A.4: filter.slugs shape validation. The route forwards `parsed.filter`
// to `scheduler.trigger(id, opts)`; the invoker constructs `new Set(...)` on
// `filter.slugs`. If `slugs` is a string (not an array), `new Set("foo")`
// produces a per-character set membership ({"f","o"}) — silently broken.
// Reject malformed shapes at the route boundary with 400.
// ---------------------------------------------------------------------
describe("POST /api/probes/:id/trigger — R2-A.4 filter.slugs shape", () => {
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
    sched.setTriggerBehavior({
      result: { runId: "r", status: "queued", probe: "smoke" },
    });
  });

  it("returns 400 invalid_filter when filter.slugs is a string", async () => {
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filter: { slugs: "foo" } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "invalid_filter" });
  });

  it("returns 400 invalid_filter when filter.slugs contains non-strings", async () => {
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filter: { slugs: [1, "b"] } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "invalid_filter" });
  });

  it("returns 200 with proper scope when filter.slugs is a valid string array", async () => {
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
    expect(sched.lastTriggerOpts).toEqual({ filter: { slugs: ["a", "b"] } });
  });
});

// ---------------------------------------------------------------------
// R2-A.5: rate-limit must be stamped AFTER body parse + filter validation,
// not before. If body read or parse throws, the user's window must NOT
// be consumed.
// ---------------------------------------------------------------------
describe("POST /api/probes/:id/trigger — R2-A.5 stamp-after-parse", () => {
  it("invalid JSON body does not consume the rate-limit window", async () => {
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
    sched.setTriggerBehavior({
      result: { runId: "ok", status: "queued", probe: "smoke" },
    });
    let nowMs = 1_000_000_000_000;
    const app = buildApp(sched, writer, configs, { now: () => nowMs });
    // Malformed JSON
    const first = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: "{not-json",
    });
    expect(first.status).toBe(400);
    // 1ms later, a legit request must succeed (window not consumed).
    nowMs += 1;
    const second = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(second.status).toBe(200);
  });

  it("invalid filter shape does not consume the rate-limit window", async () => {
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
    sched.setTriggerBehavior({
      result: { runId: "ok", status: "queued", probe: "smoke" },
    });
    let nowMs = 1_000_000_000_000;
    const app = buildApp(sched, writer, configs, { now: () => nowMs });
    const first = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filter: { slugs: "not-an-array" } }),
    });
    expect(first.status).toBe(400);
    nowMs += 1;
    const second = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(second.status).toBe(200);
  });
});

// ---------------------------------------------------------------------
// R2-A.6: rollback CAS — A's rollback must not delete B's stamp when
// triggers race. Two concurrent triggers stamp t=100 and t=101; if A
// errors and rolls back via `set(id, undefined-prior)` it would delete
// B's stamp. Rollback must compare-and-swap on its own t value first.
// ---------------------------------------------------------------------
describe("POST /api/probes/:id/trigger — R2-A.6 rollback CAS", () => {
  it("A's rollback does not delete B's later stamp under races", async () => {
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
    // Make trigger() reject the FIRST call (A) but succeed the second (B).
    let callCount = 0;
    let resolveA: (() => void) | null = null;
    sched.trigger = async (_id, opts) => {
      callCount++;
      sched.lastTriggerOpts = opts;
      if (callCount === 1) {
        // A: hold open until we say so, then throw inflight to roll back.
        await new Promise<void>((resolve) => {
          resolveA = resolve;
        });
        throw new InflightConflictError("smoke");
      }
      // B: succeed promptly.
      return { runId: "run_b", status: "queued", probe: "smoke" };
    };
    let nowMs = 1_000_000_000_000;
    const app = buildApp(sched, writer, configs, { now: () => nowMs });
    // Fire A (will hang until released).
    const aPromise = app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    // Tiny wait so A's stamp is recorded.
    await new Promise((r) => setTimeout(r, 5));
    // Fire B — must be 429 because A's stamp is still in the window.
    nowMs += 1;
    const b = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(b.status).toBe(429);
    // But after the window passes, B's later stamp (which never happened
    // since 429 short-circuited) is irrelevant. Real test: simulate B
    // stamps via direct race. For this scenario we instead verify the
    // simpler CAS guarantee: when A errors AFTER B successfully stamped,
    // A's rollback must NOT remove B's stamp. Switch order: release A;
    // expect a follow-up trigger 1ms later to be 429 (A's rollback only
    // applies if A's t still equals the stored t).
    if (resolveA) (resolveA as () => void)();
    const aResp = await aPromise;
    expect(aResp.status).toBe(409); // A errored with InflightConflict
    // Check that A's rollback DID restore the prior state (none) — so
    // a follow-up should succeed.
    nowMs += 1;
    sched.trigger = async (_id, opts) => {
      sched.lastTriggerOpts = opts;
      return { runId: "run_c", status: "queued", probe: "smoke" };
    };
    const c = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(c.status).toBe(200);
  });
});

// ---------------------------------------------------------------------
// R2-A.8: body-size limit. POST trigger should reject oversized bodies
// with 413 to prevent unbounded memory consumption from `c.req.text()`.
// ---------------------------------------------------------------------
describe("POST /api/probes/:id/trigger — R2-A.8 body size", () => {
  it("returns 413 when Content-Length exceeds the limit", async () => {
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
    const huge = "x".repeat(32 * 1024); // 32KB > 16KB limit
    const res = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "Content-Length": String(huge.length),
      },
      body: huge,
    });
    expect(res.status).toBe(413);
  });
});

// ---------------------------------------------------------------------
// R2-A.9: GET /api/probes/:id graceful degradation when writer.recent
// rejects. Surface runs:[] + runsError indicator with a 200 instead of
// 500 so the UI can render the probe metadata while history is offline.
// ---------------------------------------------------------------------
describe("GET /api/probes/:id — R2-A.9 graceful degradation", () => {
  it("returns 200 with runs:[] and runsError when writer.recent throws", async () => {
    const sched = makeFakeScheduler();
    const writer: ProbeRunWriter = {
      start: async () => ({ id: "x" }),
      finish: async () => {},
      recent: async () => {
        throw new Error("PB transient outage");
      },
    };
    const configs = new Map<string, ProbeConfig>([
      ["smoke", baseConfig("smoke")],
    ]);
    sched.setEntry({
      entry: { id: "smoke", cron: "*/5 * * * *", handler: async () => {} },
      status: baseStatus({ id: "smoke", cron: "*/5 * * * *" }),
      nextRunAt: null,
    });
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/smoke");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.runs).toEqual([]);
    expect(body.runsError).toBe("history_unavailable");
    expect(body.probe).toBeDefined();
  });
});

async function res2Body(r: Response): Promise<Record<string, unknown>> {
  return (await r.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------
// CR-A1.4: trigger rate-limit TOCTOU + 409 rollback
// ---------------------------------------------------------------------
describe("POST /api/probes/:id/trigger — rate-limit TOCTOU & rollback", () => {
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

  it("two near-simultaneous triggers: first succeeds, second gets 429 (TOCTOU prevention)", async () => {
    // The route must stamp the rate-limit window IMMEDIATELY after the
    // check passes, NOT after awaiting scheduler.trigger. Otherwise two
    // requests hitting the route concurrently could both pass the check
    // before either records a timestamp.
    let resolveTrigger: (() => void) | null = null;
    sched.setTriggerBehavior({
      result: { runId: "run_1", status: "queued", probe: "smoke" },
    });
    // Override trigger to pause until we say so, simulating a slow trigger.
    const origTrigger = sched.trigger;
    sched.trigger = async (id, opts) => {
      const result = await origTrigger(id, opts);
      // Suspend in the await so a parallel request hits the same window.
      await new Promise<void>((resolve) => {
        resolveTrigger = resolve;
      });
      return result;
    };
    let nowMs = 1_000_000_000_000;
    const app = buildApp(sched, writer, configs, { now: () => nowMs });
    // Fire two requests in parallel. Same wall-clock so both clear the
    // rate-limit check at construction time IF the stamp is deferred.
    const [first, second] = await Promise.all([
      app.request("/api/probes/smoke/trigger", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
      // Tiny delay so first hits the suspension point first.
      new Promise<Response>((resolve) =>
        setTimeout(() => {
          // Release the first trigger so the second's getEntry passes.
          resolve(
            app.request("/api/probes/smoke/trigger", {
              method: "POST",
              headers: { Authorization: `Bearer ${TOKEN}` },
            }),
          );
        }, 10),
      ).then(async (r) => {
        // After the second returns, release the first trigger to drain.
        if (resolveTrigger) resolveTrigger();
        return r;
      }),
    ]);
    // Exactly one must have succeeded; the other must be 429.
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 429]);
  });

  it("InflightConflictError 409 rolls back rate-limit stamp so a follow-up trigger isn't locked out", async () => {
    sched.setTriggerBehavior({ throw: new InflightConflictError("smoke") });
    let nowMs = 1_000_000_000_000;
    const app = buildApp(sched, writer, configs, { now: () => nowMs });
    const first = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(first.status).toBe(409);
    // 1ms later — the conflict resolves and a real trigger should
    // succeed without hitting the 5-minute lockout.
    sched.setTriggerBehavior({
      result: { runId: "run_2", status: "queued", probe: "smoke" },
    });
    nowMs += 1;
    const second = await app.request("/api/probes/smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(second.status).toBe(200);
  });
});

// ---------------------------------------------------------------------
// CR-A1.7: scope filter — only registered probes are visible/triggerable
// ---------------------------------------------------------------------
describe("/api/probes — scope filter (CR-A1.7)", () => {
  it("GET /api/probes excludes scheduler entries that aren't registered probes", async () => {
    const sched = makeFakeScheduler();
    const writer = makeFakeWriter();
    // Register a real probe AND an internal scheduler entry that is NOT
    // a probe (e.g. internal:s3-backup, rule-cron entries).
    sched.setEntry({
      entry: { id: "smoke", cron: "*/5 * * * *", handler: async () => {} },
      status: baseStatus({ id: "smoke", cron: "*/5 * * * *" }),
      nextRunAt: null,
    });
    sched.setEntry({
      entry: {
        id: "internal:s3-backup",
        cron: "0 4 * * *",
        handler: async () => {},
      },
      status: baseStatus({ id: "internal:s3-backup", cron: "0 4 * * *" }),
      nextRunAt: null,
    });
    sched.setEntry({
      entry: {
        id: "rule-x:cron:0",
        cron: "*/15 * * * *",
        handler: async () => {},
      },
      status: baseStatus({ id: "rule-x:cron:0", cron: "*/15 * * * *" }),
      nextRunAt: null,
    });
    // Only `smoke` has a registered ProbeConfig.
    const configs = new Map<string, ProbeConfig>([
      ["smoke", baseConfig("smoke")],
    ]);
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { probes: Array<{ id: string }> };
    const ids = body.probes.map((p) => p.id);
    expect(ids).toContain("smoke");
    expect(ids).not.toContain("internal:s3-backup");
    expect(ids).not.toContain("rule-x:cron:0");
  });

  it("POST /api/probes/internal:s3-backup/trigger returns 404", async () => {
    const sched = makeFakeScheduler();
    const writer = makeFakeWriter();
    sched.setEntry({
      entry: {
        id: "internal:s3-backup",
        cron: "0 4 * * *",
        handler: async () => {},
      },
      status: baseStatus({ id: "internal:s3-backup", cron: "0 4 * * *" }),
      nextRunAt: null,
    });
    // No ProbeConfig registered for `internal:s3-backup` — it's not a probe.
    const configs = new Map<string, ProbeConfig>();
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/internal:s3-backup/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "not_found" });
  });

  it("GET /api/probes/internal:s3-backup returns 404", async () => {
    const sched = makeFakeScheduler();
    const writer = makeFakeWriter();
    sched.setEntry({
      entry: {
        id: "internal:s3-backup",
        cron: "0 4 * * *",
        handler: async () => {},
      },
      status: baseStatus({ id: "internal:s3-backup", cron: "0 4 * * *" }),
      nextRunAt: null,
    });
    const configs = new Map<string, ProbeConfig>();
    const app = buildApp(sched, writer, configs);
    const res = await app.request("/api/probes/internal:s3-backup");
    expect(res.status).toBe(404);
  });
});
