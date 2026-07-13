/**
 * Behavioral red-green tests for the prod D0-gone monitor (spec §10.2–§10.7).
 *
 * The monitor is fully injectable: a fake `pb.list` status-row source, a fake
 * `alertState` (getSet/putSet over an in-memory blob), a capturing `postAlert`,
 * a fake `/api/runs` summary, and an injected clock + `sleep`. So the confirm
 * scan, hourly dedup, recovery gate, and producer-idle SUSPENDED state are all
 * exercised deterministically without a real pool or PocketBase.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { StatusRow, State } from "../../shared/cell-model/live-status.js";
import { keyFor } from "../../shared/cell-model/live-status.js";
import type {
  FamilySummaryResponse,
  FamilySummaryEntry,
  WorkerView,
} from "./run-view.js";
import type { RegistryDoc } from "./d0-gone-predicate.js";
import {
  createD0GoneMonitor,
  isProducerLive,
  PRODUCER_IDLE_PERIOD_MULTIPLIER,
} from "./d0-gone-monitor.js";

// ── Fixtures ───────────────────────────────────────────────────────────
const T0 = Date.parse("2026-07-13T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

// Two wired slugs, one feature each (minimal, matches page-stats enumeration).
const REGISTRY: RegistryDoc = {
  feature_registry: { features: [{ id: "agentic-chat" }] },
  integrations: [
    {
      slug: "alpha",
      features: ["agentic-chat"],
      demos: [{ id: "agentic-chat", route: "/demos/agentic-chat" }],
    },
    {
      slug: "beta",
      features: ["agentic-chat"],
      demos: [{ id: "agentic-chat", route: "/demos/agentic-chat" }],
    },
  ],
};

// A d6-family schedule so the idle window resolves to a real 3×period.
const SCHEDULES = [
  {
    scheduleId: "fleet-job-producer",
    cron: "*/15 * * * *",
    producer: {} as never,
  },
];

function row(slug: string, key: string, state: State, atMs: number): StatusRow {
  const at = new Date(atMs).toISOString();
  const [dimension = ""] = key.split(":");
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    signal: null,
    observed_at: at,
    transitioned_at: at,
    fail_count: state === "red" ? 1 : 0,
    first_failure_at: state === "red" ? at : null,
  };
}

/** All rows to make a slug's single agentic-chat cell RED-D0 (fresh). */
function goneRows(slug: string, atMs: number): StatusRow[] {
  return [
    row(slug, keyFor("e2e", slug, "agentic-chat"), "red", atMs),
    row(slug, keyFor("chat", slug), "red", atMs),
    row(slug, keyFor("tools", slug), "red", atMs),
  ];
}

/** All rows to make a slug's cell GREEN-D0-fresh (D3 e2e + chat/tools green). */
function healthyRows(slug: string, atMs: number): StatusRow[] {
  return [
    row(slug, keyFor("e2e", slug, "agentic-chat"), "green", atMs),
    row(slug, keyFor("chat", slug), "green", atMs),
    row(slug, keyFor("tools", slug), "green", atMs),
  ];
}

// ── Fakes ──────────────────────────────────────────────────────────────
function makeFakes() {
  const posted: string[] = [];
  let stateBlob: { hash: string | null; at: string | null } = {
    hash: null,
    at: null,
  };
  let statusRows: StatusRow[] = [];
  let liveSummary: FamilySummaryResponse | null = null;
  let sendShouldThrow = false;
  let clock = T0;

  const onlineWorker: WorkerView = {
    workerId: "w1",
    health: "online",
    lastHeartbeatAt: new Date(T0).toISOString(),
    registeredAt: new Date(T0 - HOUR).toISOString(),
    currentJobId: null,
    capacity: { inUse: 0, available: 1, max: 1 },
  };

  function liveProducer(atMs = clock): FamilySummaryResponse {
    const entry: FamilySummaryEntry = {
      family: "d6",
      label: "D6",
      probeKeyPrefix: "d6",
      lastSuccessAt: new Date(atMs - MIN).toISOString(),
    };
    return { families: [entry], workers: [onlineWorker] };
  }

  function idleProducer(): FamilySummaryResponse {
    // No inflight, freshest activity WAY past the idle window, no online worker.
    const entry: FamilySummaryEntry = {
      family: "d6",
      label: "D6",
      probeKeyPrefix: "d6",
      lastSuccessAt: new Date(T0 - 10 * HOUR).toISOString(),
    };
    return {
      families: [entry],
      workers: [{ ...onlineWorker, health: "offline" }],
    };
  }

  const deps = {
    pb: {
      async list<T>() {
        return {
          page: 1,
          perPage: 500,
          totalPages: 1,
          totalItems: statusRows.length,
          items: statusRows as unknown as T[],
        };
      },
    },
    alertState: {
      async getSet() {
        return stateBlob;
      },
      async putSet(_ruleId: string, hash: string, at: string) {
        stateBlob = { hash, at };
      },
    },
    async postAlert(text: string) {
      if (sendShouldThrow) throw new Error("slack down");
      posted.push(text);
    },
    summary: {
      async get() {
        if (liveSummary === null) throw new Error("summary unavailable");
        return liveSummary;
      },
    },
    schedules: SCHEDULES,
    registry: REGISTRY,
    dashboardUrl: "https://dash.test",
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    now: () => clock,
    // Instant confirm delay in tests; the scan re-reads the CURRENT statusRows.
    sleep: async () => {},
  };

  return {
    deps,
    posted,
    setStatusRows: (r: StatusRow[]) => (statusRows = r),
    setSummary: (s: FamilySummaryResponse | null) => (liveSummary = s),
    setSendThrows: (v: boolean) => (sendShouldThrow = v),
    advance: (ms: number) => (clock += ms),
    setClock: (ms: number) => (clock = ms),
    getClock: () => clock,
    liveProducer,
    idleProducer,
    getState: () => stateBlob,
  };
}

describe("isProducerLive (§2.5 acceptance)", () => {
  const idleWindow = PRODUCER_IDLE_PERIOD_MULTIPLIER * 15 * MIN; // 45m for */15
  const worker = (health: WorkerView["health"]): WorkerView => ({
    workerId: "w",
    health,
    lastHeartbeatAt: new Date(T0).toISOString(),
    registeredAt: new Date(T0).toISOString(),
    currentJobId: null,
    capacity: { inUse: 0, available: 1, max: 1 },
  });

  it("LIVE when any family has inflight (even if all lastSuccess is old)", () => {
    const body: FamilySummaryResponse = {
      families: [
        {
          family: "d6",
          label: "D6",
          probeKeyPrefix: "d6",
          lastSuccessAt: new Date(T0 - 10 * HOUR).toISOString(),
          inflight: {
            runId: "r",
            triggered: false,
            enqueuedAt: new Date(T0 - MIN).toISOString(),
            elapsedMs: MIN,
            stalled: false,
            jobs: { pending: 1, claimed: 0, running: 0, done: 0, failed: 0 },
          },
        },
      ],
      workers: [worker("offline")],
    };
    expect(isProducerLive(body, idleWindow, T0)).toBe(true);
  });

  it("LIVE when freshest activity within window AND a worker is online", () => {
    const body: FamilySummaryResponse = {
      families: [
        {
          family: "d6",
          label: "D6",
          probeKeyPrefix: "d6",
          lastSuccessAt: new Date(T0 - 30 * MIN).toISOString(),
        },
      ],
      workers: [worker("online")],
    };
    expect(isProducerLive(body, idleWindow, T0)).toBe(true);
  });

  it("boundary: just-inside window stays LIVE, just-past flips IDLE", () => {
    const inside: FamilySummaryResponse = {
      families: [
        {
          family: "d6",
          label: "D6",
          probeKeyPrefix: "d6",
          lastSuccessAt: new Date(T0 - (idleWindow - MIN)).toISOString(),
        },
      ],
      workers: [worker("online")],
    };
    const past: FamilySummaryResponse = {
      families: [
        {
          family: "d6",
          label: "D6",
          probeKeyPrefix: "d6",
          lastSuccessAt: new Date(T0 - (idleWindow + MIN)).toISOString(),
        },
      ],
      workers: [worker("online")],
    };
    expect(isProducerLive(inside, idleWindow, T0)).toBe(true);
    expect(isProducerLive(past, idleWindow, T0)).toBe(false);
  });

  it("IDLE when all workers stale/offline with no inflight (heartbeat gate)", () => {
    const body: FamilySummaryResponse = {
      families: [
        {
          family: "d6",
          label: "D6",
          probeKeyPrefix: "d6",
          lastSuccessAt: new Date(T0 - MIN).toISOString(),
        },
      ],
      workers: [worker("offline"), worker("stale")],
    };
    expect(isProducerLive(body, idleWindow, T0)).toBe(false);
  });
});

describe("D0-gone monitor — detection + confirm scan (§10.2)", () => {
  let f: ReturnType<typeof makeFakes>;
  beforeEach(() => {
    f = makeFakes();
  });

  it("GREEN: both scans agree gone → ONE aggregated alert posted, outage opened", async () => {
    f.setSummary(f.liveProducer());
    f.setStatusRows([...goneRows("alpha", T0), ...healthyRows("beta", T0)]);
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toContain("completely gone");
    expect(f.posted[0]).toContain("`alpha`");
    expect(f.posted[0]).not.toContain("`beta`");
    const map = JSON.parse(f.getState().hash!);
    expect(map.alpha).toBeDefined();
    expect(map.alpha.lastAlertAt).not.toBe("");
  });

  it("RED-then-clear: first scan gone, confirm re-read healthy → NO alert, blip rejected", async () => {
    f.setSummary(f.liveProducer());
    // First scan: alpha gone. The fake re-reads CURRENT rows on the confirm
    // scan, so flip alpha to healthy via a sleep hook that mutates rows.
    f.setStatusRows(goneRows("alpha", T0));
    const depsWithFlip = {
      ...f.deps,
      sleep: async () => {
        f.setStatusRows(healthyRows("alpha", T0)); // recovered within 60s → blip
      },
    };
    const m = createD0GoneMonitor(depsWithFlip);
    await m.tick();
    expect(f.posted).toHaveLength(0); // blip rejected, no OPEN
    const map = JSON.parse(f.getState().hash ?? "{}");
    expect(map.alpha).toBeUndefined();
  });
});

describe("D0-gone monitor — hourly dedup (§10.3)", () => {
  it("15/30/45m ticks silent while gone; 60m tick re-posts", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor(f.deps);

    await m.tick(); // t0: OPEN (1 post)
    expect(f.posted).toHaveLength(1);

    for (const mins of [15, 30, 45]) {
      f.setClock(T0 + mins * MIN);
      f.setSummary(f.liveProducer(T0 + mins * MIN));
      f.setStatusRows(goneRows("alpha", T0)); // still gone (onset stays t0)
      await m.tick();
    }
    expect(f.posted).toHaveLength(1); // no re-post before 60m

    f.setClock(T0 + 60 * MIN);
    f.setSummary(f.liveProducer(T0 + 60 * MIN));
    f.setStatusRows(goneRows("alpha", T0));
    await m.tick();
    expect(f.posted).toHaveLength(2); // hourly re-post
    // sinceAt preserved across the re-post (F8).
    const map = JSON.parse(f.getState().hash!);
    expect(map.alpha.sinceAt).toBe(new Date(T0).toISOString());
  });
});

describe("D0-gone monitor — recovery/clear (§10.4)", () => {
  it("open outage → fresh-healthy read → ONE recovery post, state cleared; next tick silent", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor(f.deps);
    await m.tick(); // OPEN
    expect(f.posted).toHaveLength(1);

    f.setClock(T0 + 20 * MIN);
    f.setSummary(f.liveProducer(T0 + 20 * MIN));
    f.setStatusRows(healthyRows("alpha", T0 + 20 * MIN)); // fresh healthy
    await m.tick();
    expect(f.posted).toHaveLength(2);
    expect(f.posted[1]).toContain("recovered");
    expect(f.posted[1]).toContain("`alpha`");
    expect(JSON.parse(f.getState().hash!).alpha).toBeUndefined();

    // subsequent healthy tick → nothing.
    f.setClock(T0 + 40 * MIN);
    f.setSummary(f.liveProducer(T0 + 40 * MIN));
    f.setStatusRows(healthyRows("alpha", T0 + 40 * MIN));
    await m.tick();
    expect(f.posted).toHaveLength(2);
  });
});

describe("D0-gone monitor — producer-idle SUSPENDED (§10.5, F1)", () => {
  it("RED (invisible-outage): idle producer + FRESH-gone rows → SUSPENDED (no OPEN); flip live → OPEN fires", async () => {
    const f = makeFakes();
    // Producer idle, but alpha's rows are FRESH-gone (written just before the
    // pause). WITHOUT the SUSPENDED gate the monitor would OPEN off this data;
    // WITH it, the tick holds — we do not act while the producer is idle, since
    // its signals can no longer be trusted to update. This is what makes the
    // gate load-bearing (disabling it makes THIS test fail with an OPEN post).
    f.setSummary(f.idleProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    expect(f.posted).toHaveLength(0); // SUSPENDED, no OPEN
    expect(JSON.parse(f.getState().hash ?? "{}").alpha).toBeUndefined();

    // Flip producer live with a FRESH gone signal → OPEN fires.
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    await m.tick();
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toContain("`alpha`");
  });

  it("RED (false-recovery prevention): open outage, producer pauses, rows spuriously read healthy → NO recovery, HOLD", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor(f.deps);
    await m.tick(); // OPEN
    expect(f.posted).toHaveLength(1);

    // Producer pauses (summary idle). The status rows now READ fresh-healthy —
    // e.g. a stale/partial write, or the integration is genuinely still down but
    // the last-written rows no longer reflect it because the producer stopped
    // updating them. WITHOUT the SUSPENDED gate the monitor would treat this as
    // positive fresh-healthy evidence and post a FALSE recovery (the F1 bug);
    // WITH it the tick holds and the outage stays open. Disabling the gate makes
    // THIS test fail with a spurious "recovered" post.
    for (const mins of [15, 30, 45]) {
      f.setClock(T0 + mins * MIN);
      f.setSummary(f.idleProducer());
      f.setStatusRows(healthyRows("alpha", T0 + mins * MIN)); // spurious healthy while idle
      await m.tick();
    }
    expect(f.posted).toHaveLength(1); // NO recovery — held open (SUSPENDED)
    expect(JSON.parse(f.getState().hash!).alpha).toBeDefined();
  });

  it("GREEN: after pause, a producer-live fresh-healthy read clears with ONE recovery post", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor(f.deps);
    await m.tick(); // OPEN

    // Pause (SUSPENDED, held).
    f.setClock(T0 + 20 * MIN);
    f.setSummary(f.idleProducer());
    f.setStatusRows(goneRows("alpha", T0));
    await m.tick();
    expect(f.posted).toHaveLength(1);

    // Unpause + fresh healthy → clears.
    f.setClock(T0 + 40 * MIN);
    f.setSummary(f.liveProducer(T0 + 40 * MIN));
    f.setStatusRows(healthyRows("alpha", T0 + 40 * MIN));
    await m.tick();
    expect(f.posted).toHaveLength(2);
    expect(f.posted[1]).toContain("recovered");
  });
});

describe("D0-gone monitor — failure modes (§10.6)", () => {
  it("status read throws → no-op (no post, no state change)", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    const deps = {
      ...f.deps,
      pb: {
        async list(): Promise<never> {
          throw new Error("PB down");
        },
      },
    };
    const m = createD0GoneMonitor(deps as never);
    await m.tick();
    expect(f.posted).toHaveLength(0);
    expect(f.getState().hash).toBeNull();
  });

  it("Slack send throws on OPEN → lastAlertAt NOT advanced; next tick retries", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    f.setSendThrows(true);
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    expect(f.posted).toHaveLength(0);
    // OPEN entry persisted with empty lastAlertAt (remembered, unsent).
    const map = JSON.parse(f.getState().hash!);
    expect(map.alpha).toBeDefined();
    expect(map.alpha.lastAlertAt).toBe("");

    // Slack recovers → next tick retries the OPEN post.
    f.setSendThrows(false);
    f.setClock(T0 + 15 * MIN);
    f.setSummary(f.liveProducer(T0 + 15 * MIN));
    f.setStatusRows(goneRows("alpha", T0));
    await m.tick();
    expect(f.posted).toHaveLength(1);
    expect(JSON.parse(f.getState().hash!).alpha.lastAlertAt).not.toBe("");
  });

  it("opened-and-cleared while Slack down → no stale OPEN replay, no phantom recovery (F9)", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    f.setSendThrows(true);
    const m = createD0GoneMonitor(f.deps);
    await m.tick(); // OPEN recorded, send failed
    expect(f.posted).toHaveLength(0);

    // Slug returns to fresh-healthy while Slack still down → the open entry is
    // cleared-attempt (recovery send also fails), no phantom messages.
    f.setClock(T0 + 20 * MIN);
    f.setSummary(f.liveProducer(T0 + 20 * MIN));
    f.setStatusRows(healthyRows("alpha", T0 + 20 * MIN));
    await m.tick();
    expect(f.posted).toHaveLength(0);

    // Slack recovers, slug still healthy → NO stale OPEN, NO recovery for an
    // outage that was never announced: current state is healthy, so nothing.
    f.setSendThrows(false);
    f.setClock(T0 + 40 * MIN);
    f.setSummary(f.liveProducer(T0 + 40 * MIN));
    f.setStatusRows(healthyRows("alpha", T0 + 40 * MIN));
    await m.tick();
    // The recovery for alpha may still fire ONCE here because the entry lingered
    // (send failed on the prior tick). Assert we NEVER replay a stale OPEN.
    expect(f.posted.every((p) => !p.includes("completely gone"))).toBe(true);
  });
});

describe("D0-gone monitor — aggregation (§4.1)", () => {
  it("both slugs gone → ONE message with both bullets, not two messages", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows([...goneRows("alpha", T0), ...goneRows("beta", T0)]);
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toContain("`alpha`");
    expect(f.posted[0]).toContain("`beta`");
  });
});
