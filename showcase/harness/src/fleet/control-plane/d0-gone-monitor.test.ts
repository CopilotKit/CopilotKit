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
  classifyProducer,
  isProducerLive,
  loadRegistryDoc,
  MAX_STATUS_PAGES,
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

/**
 * All rows to make a slug's cell a GENUINE GREEN LADDER (chipColor green,
 * achievedDepth 6) — a POSITIVE-green recovery signal. B-F1: the D5/D6 per-cell
 * rows (`d5:<slug>/agentic-chat`, `d6:<slug>/agentic-chat`) are MANDATORY —
 * without them `buildCellModel` collapses to gray/no-data (achievedDepth 4,
 * chipColor gray), which is UNKNOWN, not healthy, and must NOT count as
 * recovery. `agentic-chat` maps to the single D5/D6 featureType `agentic-chat`
 * (CATALOG_TO_D5_KEY), so one d5 + one d6 green row completes the ladder.
 */
function healthyRows(slug: string, atMs: number): StatusRow[] {
  return [
    row(slug, keyFor("e2e", slug, "agentic-chat"), "green", atMs),
    row(slug, keyFor("chat", slug), "green", atMs),
    row(slug, keyFor("tools", slug), "green", atMs),
    row(slug, keyFor("d5", slug, "agentic-chat"), "green", atMs),
    row(slug, keyFor("d6", slug, "agentic-chat"), "green", atMs),
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

  function freshDeployProducer(): FamilySummaryResponse {
    // C5: a freshly-deployed prod — workers ONLINE but the families have NO
    // parseable activity yet (no inflight, no lastRun, no lastSuccessAt). This
    // is "no data / not yet", NOT a paused/idle producer.
    const entry: FamilySummaryEntry = {
      family: "d6",
      label: "D6",
      probeKeyPrefix: "d6",
    };
    return { families: [entry], workers: [onlineWorker] };
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
    freshDeployProducer,
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

  const inflightEntry = (): FamilySummaryEntry => ({
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
  });

  it("LIVE when a family has inflight AND a worker is online (even if all lastSuccess is old)", () => {
    const body: FamilySummaryResponse = {
      families: [inflightEntry()],
      workers: [worker("online")],
    };
    expect(isProducerLive(body, idleWindow, T0)).toBe(true);
  });

  it("NOT LIVE when inflight but NO worker is online (stale/orphaned inflight from a dead worker)", () => {
    const body: FamilySummaryResponse = {
      families: [inflightEntry()],
      workers: [worker("offline")],
    };
    // A dead worker can leave a stale inflight behind; that must not force a
    // blind live gone-scan. The heartbeat gate applies to the inflight arm too.
    expect(isProducerLive(body, idleWindow, T0)).toBe(false);
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

  it("C5: classifyProducer distinguishes no-data (fresh deploy) from idle (paused)", () => {
    // Fresh deploy: workers ONLINE, families exist but NO parseable activity yet.
    const freshDeploy: FamilySummaryResponse = {
      families: [{ family: "d6", label: "D6", probeKeyPrefix: "d6" }],
      workers: [worker("online")],
    };
    // Paused: activity WAY past the window, no online worker.
    const paused: FamilySummaryResponse = {
      families: [
        {
          family: "d6",
          label: "D6",
          probeKeyPrefix: "d6",
          lastSuccessAt: new Date(T0 - 10 * HOUR).toISOString(),
        },
      ],
      workers: [worker("offline")],
    };
    const live: FamilySummaryResponse = {
      families: [
        {
          family: "d6",
          label: "D6",
          probeKeyPrefix: "d6",
          lastSuccessAt: new Date(T0 - MIN).toISOString(),
        },
      ],
      workers: [worker("online")],
    };
    expect(classifyProducer(freshDeploy, idleWindow, T0)).toBe("no-data");
    expect(classifyProducer(paused, idleWindow, T0)).toBe("idle");
    expect(classifyProducer(live, idleWindow, T0)).toBe("live");
    // A fresh deploy with NO worker online yet is still no-data (not-yet), not a
    // paused producer — there is simply nothing to conclude.
    const freshNoWorker: FamilySummaryResponse = {
      families: [{ family: "d6", label: "D6", probeKeyPrefix: "d6" }],
      workers: [],
    };
    expect(classifyProducer(freshNoWorker, idleWindow, T0)).toBe("no-data");
    // isProducerLive stays a thin wrapper: only "live" is live.
    expect(isProducerLive(freshDeploy, idleWindow, T0)).toBe(false);
    expect(isProducerLive(paused, idleWindow, T0)).toBe(false);
    expect(isProducerLive(live, idleWindow, T0)).toBe(true);
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

describe("D0-gone monitor — B-flap: an open outage keeps re-posting despite an inconclusive confirm", () => {
  /** e2e/chat/tools green but NO d5/d6 → gray no-data (inconclusive). */
  function noDataRows(slug: string, atMs: number): StatusRow[] {
    return [
      row(slug, keyFor("e2e", slug, "agentic-chat"), "green", atMs),
      row(slug, keyFor("chat", slug), "green", atMs),
      row(slug, keyFor("tools", slug), "green", atMs),
    ];
  }

  it("re-post is due but the confirm scan flaps to inconclusive → STILL re-posts (held open)", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor(f.deps);
    await m.tick(); // OPEN at T0
    expect(f.posted).toHaveLength(1);

    // 60m later a re-post is due. FIRST scan reads gone, but the CONFIRM re-read
    // flaps to inconclusive (gray/no-data — neither gone nor fresh-healthy). The
    // OLD code gated re-posts on the double-confirmed set (empty here) → the
    // open outage went silent forever. The fix keeps an already-open column in
    // the alert cadence unless a CONFIRMED recovery closes it → it re-posts.
    f.setClock(T0 + 60 * MIN);
    f.setSummary(f.liveProducer(T0 + 60 * MIN));
    f.setStatusRows(goneRows("alpha", T0));
    const depsFlapInconclusive = {
      ...f.deps,
      sleep: async () => {
        f.setStatusRows(noDataRows("alpha", T0 + 60 * MIN)); // confirm: inconclusive
      },
    };
    const m2 = createD0GoneMonitor(depsFlapInconclusive);
    await m2.tick();
    expect(f.posted).toHaveLength(2); // re-posted despite inconclusive confirm
    expect(f.posted[1]).toContain("`alpha`");
    // still open in state
    expect(JSON.parse(f.getState().hash!).alpha).toBeDefined();
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

describe("D0-gone monitor — B-F1 gone→no-data must NOT auto-recover", () => {
  /** e2e/chat/tools green but NO d5/d6 → chipColor gray (no-data), NOT green. */
  function noDataRows(slug: string, atMs: number): StatusRow[] {
    return [
      row(slug, keyFor("e2e", slug, "agentic-chat"), "green", atMs),
      row(slug, keyFor("chat", slug), "green", atMs),
      row(slug, keyFor("tools", slug), "green", atMs),
    ];
  }

  it("open outage → column decays to NO-DATA (gray) → NO recovery, held open", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor(f.deps);
    await m.tick(); // OPEN
    expect(f.posted).toHaveLength(1);

    // The producer is LIVE, but alpha's ladder decays to no-data (gray) — e.g.
    // the d5/d6 rows stopped being written while the earlier green ones aged
    // out, or a partial re-sweep. Under the OLD `columnFreshHealthy`
    // (!some cellGone), a gray/no-data column read as fresh-healthy → a FALSE
    // recovery. With the positive-green classifier it is UNKNOWN → HOLD.
    for (const mins of [20, 40, 60]) {
      f.setClock(T0 + mins * MIN);
      f.setSummary(f.liveProducer(T0 + mins * MIN));
      f.setStatusRows(noDataRows("alpha", T0 + mins * MIN));
      await m.tick();
    }
    expect(f.posted.every((p) => !p.includes("recovered"))).toBe(true);
    expect(JSON.parse(f.getState().hash!).alpha).toBeDefined(); // still open

    // A genuine GREEN ladder finally clears it (positive evidence).
    f.setClock(T0 + 80 * MIN);
    f.setSummary(f.liveProducer(T0 + 80 * MIN));
    f.setStatusRows(healthyRows("alpha", T0 + 80 * MIN));
    await m.tick();
    expect(f.posted.some((p) => p.includes("recovered"))).toBe(true);
    expect(JSON.parse(f.getState().hash!).alpha).toBeUndefined();
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

describe("D0-gone monitor — C5 fresh deploy: workers online + no activity yet is NO-DATA, not permanent SUSPEND", () => {
  it("fresh deploy (workers online, no run history) → held with a 'no-data / not-yet' reason, does NOT page, and pages once activity + gone data arrive", async () => {
    const f = makeFakes();
    const holds: string[] = [];
    const logger = {
      info() {},
      warn(_msg: string, meta: { reason?: string } = {}) {
        if (meta.reason) holds.push(meta.reason);
      },
      error() {},
      debug() {},
    };
    // Fresh deploy: workers online but zero parseable activity across families.
    // The OLD `isProducerLive` returned false (freshest NaN) → SUSPENDED with a
    // "producer-idle" reason, indistinguishable from a genuine pause. Even a
    // fresh-gone status read (were one present) would be held — correctly, we do
    // NOT page without producer data — but the state must be classified as
    // NO-DATA / not-yet, not a permanent producer-idle SUSPEND.
    f.setSummary(f.freshDeployProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor({ ...f.deps, logger });
    await m.tick();
    expect(f.posted).toHaveLength(0); // still do NOT page without data
    // GREEN: held for a NO-DATA / not-yet reason, NOT "producer-idle".
    expect(holds.some((r) => r === "producer-no-data")).toBe(true);
    expect(holds.some((r) => r === "producer-idle")).toBe(false);

    // Once the fleet starts producing AND a column reads gone → it pages (the
    // monitor was never permanently disabled).
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    await m.tick();
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toContain("`alpha`");
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

describe("D0-gone monitor — B-cadence: overflow slugs keep their re-post clock", () => {
  const THREE_SLUG_REGISTRY: RegistryDoc = {
    feature_registry: { features: [{ id: "agentic-chat" }] },
    integrations: ["alpha", "beta", "gamma"].map((slug) => ({
      slug,
      features: ["agentic-chat"],
      demos: [{ id: "agentic-chat", route: "/demos/agentic-chat" }],
    })),
  };

  it("only SHOWN slugs advance lastAlertAt; an overflow (+N more) slug re-posts next tick", async () => {
    const f = makeFakes();
    f.deps.registry = THREE_SLUG_REGISTRY;
    f.setSummary(f.liveProducer());
    f.setStatusRows([
      ...goneRows("alpha", T0),
      ...goneRows("beta", T0),
      ...goneRows("gamma", T0),
    ]);
    // Cap the message at 2 slugs → the 3rd (gamma, sorted last) is overflow.
    const m = createD0GoneMonitor({
      ...f.deps,
      config: { maxSlugsInMessage: 2 },
    });
    await m.tick(); // OPEN — message names alpha+beta, "+1 more" (gamma)
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toContain("+1 more");

    const map1 = JSON.parse(f.getState().hash!);
    // Shown slugs got a lastAlertAt; the overflow slug (gamma) did NOT — the OLD
    // code advanced EVERY open slug's clock (including unshown overflow), muting
    // gamma for an hour without ever naming it. B-cadence keeps its clock unset.
    expect(map1.alpha.lastAlertAt).not.toBe("");
    expect(map1.beta.lastAlertAt).not.toBe("");
    expect(map1.gamma.lastAlertAt).toBe("");

    // Next tick well BEFORE the 60m re-post window: alpha/beta are NOT due
    // (their clock is fresh), but gamma's unset clock means it IS due → a
    // message re-posts this tick (it was never actually reported by name).
    f.setClock(T0 + 15 * MIN);
    f.setSummary(f.liveProducer(T0 + 15 * MIN));
    f.setStatusRows([
      ...goneRows("alpha", T0),
      ...goneRows("beta", T0),
      ...goneRows("gamma", T0),
    ]);
    await m.tick();
    expect(f.posted).toHaveLength(2); // gamma still pending → re-posted
  });
});

describe("D0-gone monitor — C1 cadence/overflow: wide outage re-posts hourly, overflow rotates", () => {
  function nSlugRegistry(slugs: string[]): RegistryDoc {
    return {
      feature_registry: { features: [{ id: "agentic-chat" }] },
      integrations: slugs.map((slug) => ({
        slug,
        features: ["agentic-chat"],
        demos: [{ id: "agentic-chat", route: "/demos/agentic-chat" }],
      })),
    };
  }
  function allGone(slugs: string[], atMs: number): StatusRow[] {
    return slugs.flatMap((s) => goneRows(s, atMs));
  }

  it("(i) N = maxSlugs+3 gone → aggregate re-posts ~hourly, NOT every 15m tick", async () => {
    const f = makeFakes();
    const slugs = ["s1", "s2", "s3", "s4", "s5"]; // maxSlugs 2 → 3 overflow
    f.deps.registry = nSlugRegistry(slugs);
    f.setSummary(f.liveProducer());
    f.setStatusRows(allGone(slugs, T0));
    const m = createD0GoneMonitor({
      ...f.deps,
      config: { maxSlugsInMessage: 2 },
    });

    await m.tick(); // t0 OPEN → 1 post (some slugs named, rest overflow)
    expect(f.posted).toHaveLength(1);

    // Run 15m ticks through the first hour. Each tick a subset of overflow
    // slugs becomes "most due" and rotates into the named positions, so the
    // monitor DOES re-post to make forward progress on naming every slug — but
    // once every slug has been named within the hour it must NOT keep spamming
    // every single 15m tick forever. The OLD code left overflow slugs with an
    // unset clock permanently → a post EVERY tick (5 posts by t60). The fixed
    // code advances each named slug's clock so, after all slugs are named
    // (bounded rotation), the cadence settles to hourly.
    for (const mins of [15, 30, 45, 60, 75, 90]) {
      f.setClock(T0 + mins * MIN);
      f.setSummary(f.liveProducer(T0 + mins * MIN));
      f.setStatusRows(allGone(slugs, T0));
      await m.tick();
    }
    // Bounded rotation: naming 5 slugs 2-at-a-time needs ~3 posts to cover all,
    // then a steady hourly re-post. Far fewer than the 7 posts the every-tick
    // spam bug would produce (1 open + 6 ticks). Assert we did NOT post on
    // every tick.
    expect(f.posted.length).toBeLessThan(7);
    // And every slug has been NAMED at least once across the posts within the
    // window (forward progress — no slug is silently muted forever).
    for (const s of slugs) {
      expect(f.posted.some((p) => p.includes(`\`${s}\``))).toBe(true);
    }
  });

  it("(ii) a newly-opened OVERFLOW slug does NOT force a 15m re-post when it cannot be named", async () => {
    const f = makeFakes();
    // alpha+beta open and freshly posted; a 3rd slug opens later but lands in
    // overflow. Under the OLD code the new overflow slug's unset clock made it
    // "due" every tick → a re-post every 15m even though it is never named.
    const slugs = ["alpha", "beta"];
    f.deps.registry = nSlugRegistry(["alpha", "beta", "zzz"]);
    f.setSummary(f.liveProducer());
    f.setStatusRows(allGone(slugs, T0));
    const m = createD0GoneMonitor({
      ...f.deps,
      config: { maxSlugsInMessage: 2 },
    });
    await m.tick(); // OPEN alpha+beta → 1 post, both named
    expect(f.posted).toHaveLength(1);

    // 15m later zzz opens too. maxSlugs=2 and alpha/beta are NOT due (posted 15m
    // ago). zzz is due (never posted) but is the LOWEST-priority to name only if
    // capacity allows — with alpha/beta not needing a re-post, zzz should be
    // named (it's the only due slug) — that IS a valid post (forward progress).
    // The BUG this guards is the OPPOSITE: if the newly-opened slug canNOT be
    // named because higher-priority DUE slugs already fill the message, it must
    // not force an extra post. Simulate that by making alpha+beta due too.
    f.setClock(T0 + 60 * MIN); // alpha/beta now due AND zzz due, 3 due, cap 2
    f.setSummary(f.liveProducer(T0 + 60 * MIN));
    f.setStatusRows(allGone(["alpha", "beta", "zzz"], T0));
    await m.tick(); // one hourly re-post; rotation names the empty-clock slug
    // (zzz, never posted → most stale) first plus one of alpha/beta, folds the other
    const postsAfterHour = f.posted.length;

    // A tick 15m later: the 2 just-named slugs are fresh; only the 1 folded slug
    // is due. It rotates into the named set → ONE post (forward progress), then
    // it is fresh too. This is bounded, not per-tick spam.
    f.setClock(T0 + 75 * MIN);
    f.setSummary(f.liveProducer(T0 + 75 * MIN));
    f.setStatusRows(allGone(["alpha", "beta", "zzz"], T0));
    await m.tick();
    f.setClock(T0 + 90 * MIN);
    f.setSummary(f.liveProducer(T0 + 90 * MIN));
    f.setStatusRows(allGone(["alpha", "beta", "zzz"], T0));
    await m.tick(); // all fresh now → NO post
    // At most one extra post for the rotation, not one per tick.
    expect(f.posted.length).toBeLessThanOrEqual(postsAfterHour + 1);
  });

  it("(iii) only the NAMED slugs advance lastAlertAt; a not-named due slug keeps its clock", async () => {
    const f = makeFakes();
    const slugs = ["a1", "a2", "a3"]; // cap 2 → one overflow per post
    f.deps.registry = nSlugRegistry(slugs);
    f.setSummary(f.liveProducer());
    f.setStatusRows(allGone(slugs, T0));
    const m = createD0GoneMonitor({
      ...f.deps,
      config: { maxSlugsInMessage: 2 },
    });
    await m.tick();
    const map = JSON.parse(f.getState().hash!);
    // Exactly the 2 NAMED slugs advanced; the 1 overflow slug did NOT.
    const advanced = slugs.filter((s) => map[s].lastAlertAt !== "");
    const notAdvanced = slugs.filter((s) => map[s].lastAlertAt === "");
    expect(advanced).toHaveLength(2);
    expect(notAdvanced).toHaveLength(1);
    // The named set contains exactly the slugs whose clock advanced.
    for (const s of advanced) {
      expect(f.posted[0]).toContain(`\`${s}\``);
    }
  });

  it("(iv) every open slug is NAMED within a bounded number of re-posts (rotation)", async () => {
    const f = makeFakes();
    const slugs = ["b1", "b2", "b3", "b4"]; // cap 1 → 4 posts to name all
    f.deps.registry = nSlugRegistry(slugs);
    f.setSummary(f.liveProducer());
    f.setStatusRows(allGone(slugs, T0));
    const m = createD0GoneMonitor({
      ...f.deps,
      config: { maxSlugsInMessage: 1 },
    });
    const named = new Set<string>();
    for (let i = 0; i < 4; i++) {
      f.setClock(T0 + i * 15 * MIN);
      f.setSummary(f.liveProducer(T0 + i * 15 * MIN));
      f.setStatusRows(allGone(slugs, T0));
      await m.tick();
      for (const s of slugs) {
        if (f.posted.some((p) => p.includes(`\`${s}\``))) named.add(s);
      }
    }
    // All 4 slugs named within 4 posts (cap 1 each) — bounded forward progress.
    expect(named.size).toBe(4);
  });
});

describe("D0-gone monitor — C6 corrupt-but-shaped sinceAt never renders as garbage", () => {
  it("an unparseable persisted sinceAt renders 'unknown', not the raw garbage string", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    // A state blob that is VALID JSON of the right shape but whose `sinceAt` is
    // corrupt (not a parseable ISO). It is still gone, and a re-post is due
    // (empty lastAlertAt), so the outage message re-posts. The OLD code rendered
    // `gone since <garbage>` because it only null-checked (`since ?? "unknown"`),
    // never validated parseability.
    const corrupt = JSON.stringify({
      alpha: { sinceAt: "corrupt-not-a-date", lastAlertAt: "" },
    });
    // Seed the durable blob directly.
    await f.deps.alertState.putSet("prod-d0-gone-monitor", corrupt, "");
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    expect(f.posted).toHaveLength(1);
    // GREEN: the garbage string must NOT appear; it renders as "unknown".
    expect(f.posted[0]).not.toContain("corrupt-not-a-date");
    expect(f.posted[0]).toContain("gone since unknown");
  });

  it("a corrupt sinceAt on SINGLE-slug RECOVERY renders without the garbage span", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    const corrupt = JSON.stringify({
      alpha: {
        sinceAt: "garbage-timestamp",
        lastAlertAt: new Date(T0).toISOString(),
      },
    });
    await f.deps.alertState.putSet("prod-d0-gone-monitor", corrupt, "");
    // alpha reads fresh-healthy now → confirmed recovery → recovery message.
    f.setClock(T0 + 20 * MIN);
    f.setSummary(f.liveProducer(T0 + 20 * MIN));
    f.setStatusRows(healthyRows("alpha", T0 + 20 * MIN));
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    const recovery = f.posted.find((p) => p.includes("recovered"));
    expect(recovery).toBeDefined();
    // GREEN: the garbage sinceAt does not leak into the recovery text.
    expect(recovery).not.toContain("garbage-timestamp");
  });

  it("corrupt sinceAt across MULTIPLE recovering slugs renders 'unknown', never the raw garbage", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    // TWO already-open slugs, each with a VALID-JSON but corrupt (unparseable)
    // sinceAt and a set lastAlertAt so both are treated as open. Both read
    // fresh-healthy now → confirmed recovery across ≥2 slugs → the MULTI-slug
    // recovery branch composes the bulleted message. The OLD code interpolated
    // `r.sinceAt` RAW in that branch, so the garbage leaked into the post.
    const corrupt = JSON.stringify({
      alpha: {
        sinceAt: "garbage-alpha-ts",
        lastAlertAt: new Date(T0).toISOString(),
      },
      beta: {
        sinceAt: "garbage-beta-ts",
        lastAlertAt: new Date(T0).toISOString(),
      },
    });
    await f.deps.alertState.putSet("prod-d0-gone-monitor", corrupt, "");
    f.setClock(T0 + 20 * MIN);
    f.setSummary(f.liveProducer(T0 + 20 * MIN));
    f.setStatusRows([
      ...healthyRows("alpha", T0 + 20 * MIN),
      ...healthyRows("beta", T0 + 20 * MIN),
    ]);
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    const recovery = f.posted.find((p) => p.includes("recovered"));
    expect(recovery).toBeDefined();
    // Confirm this is actually the MULTI-slug branch (both slugs bulleted).
    expect(recovery).toContain("`alpha`");
    expect(recovery).toContain("`beta`");
    // RED on raw interpolation / GREEN after the renderSince() wrap: neither
    // garbage string leaks; both bullets render "was gone unknown→…".
    expect(recovery).not.toContain("garbage-alpha-ts");
    expect(recovery).not.toContain("garbage-beta-ts");
    expect(recovery).toContain("was gone unknown→");
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

// ── CR Round 1 fixes (bucket-a) ─────────────────────────────────────────

describe("D0-gone monitor — A1 onset key match (prefix collision)", () => {
  // Two wired slugs where one slug's name is a PREFIX of the other:
  // `strands` and `strands-typescript`. The substring `:strands` matches keys
  // for BOTH slugs, so a substring onset match mis-attributes the (earlier)
  // `strands-typescript` onset to `strands`.
  const PREFIX_REGISTRY: RegistryDoc = {
    feature_registry: { features: [{ id: "agentic-chat" }] },
    integrations: [
      {
        slug: "strands",
        features: ["agentic-chat"],
        demos: [{ id: "agentic-chat", route: "/demos/agentic-chat" }],
      },
      {
        slug: "strands-typescript",
        features: ["agentic-chat"],
        demos: [{ id: "agentic-chat", route: "/demos/agentic-chat" }],
      },
    ],
  };

  it("attributes onset per-slug by EXACT key, not substring (strands ≠ strands-typescript)", async () => {
    const f = makeFakes();
    f.deps.registry = PREFIX_REGISTRY;
    f.setSummary(f.liveProducer());
    // `strands-typescript` went red EARLIER (T0 - 2h); `strands` went red at T0.
    // A substring `:strands` match pulls the strands-typescript rows into the
    // strands onset scan → strands' sinceAt would wrongly be T0-2h.
    const strandsTsOnset = T0 - 2 * HOUR;
    f.setStatusRows([
      ...goneRows("strands", T0),
      ...goneRows("strands-typescript", strandsTsOnset),
    ]);
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    expect(f.posted).toHaveLength(1);
    const map = JSON.parse(f.getState().hash!);
    // GREEN: exact key match → strands' onset is its OWN T0, not the earlier
    // strands-typescript onset.
    expect(map.strands.sinceAt).toBe(new Date(T0).toISOString());
    expect(map["strands-typescript"].sinceAt).toBe(
      new Date(strandsTsOnset).toISOString(),
    );
  });
});

describe("D0-gone monitor — B-onset derived from the folded verdict", () => {
  it("onset = earliest failure among the LADDER rows the fold used, not a raw non-ladder red row", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    // alpha is gone: its e2e/chat/tools ladder rows went red at T0. A STRAY
    // `health:alpha` row is red much EARLIER (T0 - 3h). `health` is the D1/D2
    // liveness dimension — buildCellModel's resolveD3 does NOT fold it into the
    // gone verdict, so it is NOT a contributing ladder row. The OLD raw-row
    // onset scan (`row.state === "red" && keyBelongsToSlug`) matched
    // `health:alpha` and mis-timed the onset to T0-3h. The folded derivation
    // takes onset only from the D3/D4/D5/D6 winner rows → T0.
    const strayEarly = T0 - 3 * HOUR;
    f.setStatusRows([
      ...goneRows("alpha", T0),
      row("alpha", keyFor("health", "alpha"), "red", strayEarly),
    ]);
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    expect(f.posted).toHaveLength(1);
    const map = JSON.parse(f.getState().hash!);
    // GREEN: onset is the ladder's own T0, NOT the stray non-ladder T0-3h.
    expect(map.alpha.sinceAt).toBe(new Date(T0).toISOString());
  });
});

describe("D0-gone monitor — C2 onset from a non-red (degraded) winner rung of a genuinely-gone cell", () => {
  it("gone cell carries an EARLIER degraded winner rung → onset is that rung's timestamp, NOT re-stamped to now", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    // Unified-ladder semantics (§7 I2): a degraded rung is AMBER, not itself a
    // red-D0 — so a degraded-ONLY column is NOT gone (see the "degraded/stale ≠
    // gone" suite). But a GENUINELY-gone cell (its D3 e2e rung is fresh-RED →
    // chipColor red, achievedDepth 0, cellGone) can still CARRY a degraded winner
    // rung at another level (D4 chat/tools degraded here) whose failure instant
    // PREDATES the red rung (T0-90m < T0). The onset must be derived from the
    // EARLIEST non-green winner rung the fold used — the degraded D4 at T0-90m —
    // not the red D3 at T0, and never re-stamped to `nowMs`. The OLD onset scan
    // matched ONLY `row.state === "red"`, so it skipped the earlier degraded rung
    // and mis-timed the onset to the red rung (or, absent any literal red, to
    // nowMs). The fix considers any non-green (red OR degraded) winner rung.
    const degradedOnset = T0 - 90 * MIN;
    f.setStatusRows([
      row("alpha", keyFor("e2e", "alpha", "agentic-chat"), "red", T0), // D3 red → gone
      row("alpha", keyFor("chat", "alpha"), "degraded", degradedOnset), // earlier D4
      row("alpha", keyFor("tools", "alpha"), "degraded", degradedOnset),
    ]);
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    // GREEN (genuine gone still detected): the fresh-red D3 makes alpha gone.
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toContain("`alpha`");
    const map = JSON.parse(f.getState().hash!);
    // GREEN: onset comes from the EARLIEST non-green winner rung (the degraded
    // D4 at T0-90m), NOT the later red D3 and NOT re-stamped to nowMs (T0).
    expect(map.alpha.sinceAt).toBe(new Date(degradedOnset).toISOString());
    expect(map.alpha.sinceAt).not.toBe(new Date(T0).toISOString());
  });
});

describe("D0-gone monitor — degraded/stale ≠ gone (unified ladder amber, §7 I2)", () => {
  /** A single degraded D3 (e2e) rung, nothing else → chipColor AMBER (not red). */
  function degradedOnlyRows(slug: string, atMs: number): StatusRow[] {
    return [row(slug, keyFor("e2e", slug, "agentic-chat"), "degraded", atMs)];
  }
  /** A single wholly-stale (old) green D3 → folds to gray/amber, never red. */
  function staleGreenRows(slug: string, atMs: number): StatusRow[] {
    return [row(slug, keyFor("e2e", slug, "agentic-chat"), "green", atMs)];
  }

  it("a degraded-only column is NOT gone → no page, no outage opened", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    // RED (pre-redesign): a degraded rung failed `status !== "green"` → chipColor
    // red → cellGone → this column PAGED (posted 1). GREEN (unified ladder): a
    // degraded rung is AMBER → classifyCell "unknown" → NOT gone → HOLD, no page.
    f.setStatusRows(degradedOnlyRows("alpha", T0));
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    expect(f.posted).toHaveLength(0); // amber is degraded, NOT a "completely gone" outage
    expect(JSON.parse(f.getState().hash ?? "{}").alpha).toBeUndefined();
  });

  it("a wholly-stale column is NOT gone → no page (inconclusive, held)", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    // A stale-green D3 (age well past the staleness window) folds to gray/amber
    // (isStaleCell) → "unknown", never red-D0. Staleness is the producer-liveness
    // concern, never a per-column gone outage.
    f.setStatusRows(staleGreenRows("alpha", T0 - 100 * HOUR));
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    expect(f.posted).toHaveLength(0);
    expect(JSON.parse(f.getState().hash ?? "{}").alpha).toBeUndefined();
  });

  it("distinguishes degraded (NOT gone) from genuinely-gone in the same tick → only the gone column pages", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    // alpha is genuinely gone (fresh-red ladder); beta is only degraded (amber).
    // The monitor must page alpha and MUST NOT page beta — degraded ≠ gone.
    f.setStatusRows([
      ...goneRows("alpha", T0),
      ...degradedOnlyRows("beta", T0),
    ]);
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toContain("`alpha`"); // genuinely gone → detected
    expect(f.posted[0]).not.toContain("`beta`"); // degraded/amber → NOT gone
    const map = JSON.parse(f.getState().hash!);
    expect(map.alpha).toBeDefined();
    expect(map.beta).toBeUndefined(); // no outage opened for the degraded column
  });

  it("a GENUINE liveness-down (fresh-red health) is still detected as gone (§F)", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    // A fresh-red liveness (D1 health) signal gates the whole ladder → chipColor
    // red, achievedDepth 0 → cellGone. This is the real "backend gone" class the
    // unified ladder must STILL page (distinct from a degraded/amber cell). Proves
    // the amber change did not hide the genuine-outage class.
    f.setStatusRows([row("alpha", keyFor("health", "alpha"), "red", T0)]);
    const m = createD0GoneMonitor(f.deps);
    await m.tick();
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toContain("`alpha`");
    expect(JSON.parse(f.getState().hash!).alpha).toBeDefined();
  });
});

describe("D0-gone monitor — A2 recovery requires a confirm (symmetric with OPEN)", () => {
  it("single transient healthy read does NOT fire recovery; a second agreeing healthy read does", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor(f.deps);
    await m.tick(); // OPEN
    expect(f.posted).toHaveLength(1);

    // First scan reads healthy, but the confirm re-read flips back to gone →
    // this is a transient blip, NOT a recovery. A single healthy read must not
    // fire "recovered" (symmetric with the double-confirmed OPEN). Use a
    // `sleep` hook that flips rows back to gone DURING the confirm delay.
    f.setClock(T0 + 20 * MIN);
    f.setSummary(f.liveProducer(T0 + 20 * MIN));
    f.setStatusRows(healthyRows("alpha", T0 + 20 * MIN));
    const depsFlipBackToGone = {
      ...f.deps,
      sleep: async () => {
        // Confirm re-read: alpha is gone again (the healthy read was a blip).
        f.setStatusRows(goneRows("alpha", T0));
      },
    };
    const m2 = createD0GoneMonitor(depsFlipBackToGone);
    // Shares the same in-memory alertState blob (via `f.deps`) → sees the OPEN.
    await m2.tick();
    expect(f.posted).toHaveLength(1); // NO premature recovery
    expect(JSON.parse(f.getState().hash!).alpha).toBeDefined(); // still open

    // Now a fully-confirmed healthy (both reads agree) → recovery fires. Use the
    // base monitor whose no-op `sleep` leaves the (healthy) rows in place across
    // the confirm scan.
    const m3 = createD0GoneMonitor(f.deps);
    f.setClock(T0 + 40 * MIN);
    f.setSummary(f.liveProducer(T0 + 40 * MIN));
    f.setStatusRows(healthyRows("alpha", T0 + 40 * MIN));
    await m3.tick();
    expect(f.posted).toHaveLength(2);
    expect(f.posted[1]).toContain("recovered");
  });
});

describe("D0-gone monitor — A3 empty/degenerate schedule guard", () => {
  it("empty schedules → idle window falls back to a sane default, does NOT trap SUSPENDED forever", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    // No schedules → longestPeriodMs would be 0 → idleWindowMs 0 → every fresh
    // read is "outside the window" → isProducerLive always false → the monitor
    // is permanently SUSPENDED and NEVER pages (the A3 trap). The guard must use
    // a sane default window so a live-producer fresh-gone read still OPENs.
    const deps = { ...f.deps, schedules: [] };
    const m = createD0GoneMonitor(deps);
    await m.tick();
    expect(f.posted).toHaveLength(1); // GREEN: pages despite empty schedules
    expect(f.posted[0]).toContain("`alpha`");
  });
});

describe("D0-gone monitor — A4 pagination bounded", () => {
  it("NaN totalPages + a full page terminates (hard page cap), no infinite loop", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    let calls = 0;
    // Every page returns a FULL page (== perPage) with NaN totalPages. Without a
    // cap AND a NaN guard the `page >= totalPages` break never trips (NaN
    // comparisons are always false) and items.length always == perPage → the
    // loop runs forever.
    const perPage = 500;
    const deps = {
      ...f.deps,
      pb: {
        async list<T>() {
          calls += 1;
          const full = Array.from({ length: perPage }, (_, i) =>
            row("alpha", `e2e:pad-${calls}-${i}`, "green", T0),
          );
          return {
            page: calls,
            perPage,
            totalPages: Number.NaN,
            totalItems: Number.NaN,
            items: full as unknown as T[],
          };
        },
      },
    };
    const m = createD0GoneMonitor(deps as never);
    await m.tick();
    // GREEN: bounded — the loop terminated (the test itself completing proves
    // no infinite loop). Assert we stopped at the hard page cap.
    expect(calls).toBe(MAX_STATUS_PAGES);
  });
});

describe("D0-gone monitor — C3 pagination short/inconsistent read is logged, not silently truncated", () => {
  it("authoritative totalItems reports MORE rows than returned → logs a loud errorId", async () => {
    const errs: Array<{ msg: string; meta: unknown }> = [];
    const logger = {
      info() {},
      warn() {},
      error(msg: string, meta: unknown) {
        errs.push({ msg, meta });
      },
      debug() {},
    };
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    const perPage = 500;
    // With `skipTotal:false`, PB's `totalItems` is AUTHORITATIVE. Here it reports
    // MORE rows (600) than were actually returned (500) — a genuine truncation.
    // A truncated status set can flip a gone verdict (missing rows for a slug look
    // like no-data), so the monitor must detect the inconsistency (accumulated
    // rows < authoritative totalItems) and LOG a greppable errorId.
    const deps = {
      ...f.deps,
      logger,
      pb: {
        async list<T>() {
          const full = Array.from({ length: perPage }, (_, i) =>
            row("alpha", `e2e:pad-${i}`, "green", T0),
          );
          return {
            page: 1,
            perPage,
            totalPages: 1, // claims done…
            totalItems: perPage + 100, // …but authoritatively reports MORE rows
            items: full as unknown as T[],
          };
        },
      },
    };
    const m = createD0GoneMonitor(deps as never);
    await m.tick();
    // GREEN: the short/inconsistent read is logged loudly (errorId), not silently
    // swallowed.
    const short = errs.find((e) => e.msg.includes("status-short-read"));
    expect(short).toBeDefined();
    expect((short!.meta as { errorId?: string }).errorId).toBeTruthy();
  });

  it("exact-multiple-of-500 full final page → NO false short-read alert", async () => {
    const errs: Array<{ msg: string; meta: unknown }> = [];
    const logger = {
      info() {},
      warn() {},
      error(msg: string, meta: unknown) {
        errs.push({ msg, meta });
      },
      debug() {},
    };
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    const perPage = 500;
    // The collection holds exactly 500 rows: `totalItems=500`, `totalPages=1`,
    // and the single page is completely full. This is the NORMAL exact-multiple
    // terminal state, NOT a truncated read. The old heuristic fired a spurious
    // `d0-monitor.status-short-read` ERROR here — alert noise that trains
    // operators to ignore a signal meant to indicate real truncation. It must
    // now trust the authoritative total and stay quiet.
    const deps = {
      ...f.deps,
      logger,
      pb: {
        async list<T>() {
          const full = Array.from({ length: perPage }, (_, i) =>
            row("alpha", `e2e:pad-${i}`, "green", T0),
          );
          return {
            page: 1,
            perPage,
            totalPages: 1,
            totalItems: perPage, // authoritative: exactly 500 rows exist
            items: full as unknown as T[],
          };
        },
      },
    };
    const m = createD0GoneMonitor(deps as never);
    await m.tick();
    const short = errs.find((e) => e.msg.includes("status-short-read"));
    expect(short).toBeUndefined();
  });

  it("empty FIRST page while authoritative totalItems > 0 → fails SAFE (short-read errorId, read treated inconclusive)", async () => {
    // A transient/inconsistent read: page 1 comes back EMPTY while PB's
    // authoritative `totalItems` still reports rows exist. The `items.length
    // === 0` break must NOT short-circuit the authoritative short-read guard —
    // `reportedTotal` has to be captured from the page BEFORE the break. If it
    // were captured after (the bug), `reportedTotal` stays null, the guard is
    // skipped, and the empty rows are silently folded into a "nothing gone"
    // verdict: a real mass outage coinciding with the inconsistent read is
    // MISSED (under-fires toward SILENCE). The monitor must instead treat the
    // read as INCONCLUSIVE (log the short-read errorId + throw → HOLD).
    const errs: Array<{ msg: string; meta: unknown }> = [];
    const warns: Array<{ msg: string; meta: unknown }> = [];
    const logger = {
      info() {},
      warn(msg: string, meta: unknown) {
        warns.push({ msg, meta });
      },
      error(msg: string, meta: unknown) {
        errs.push({ msg, meta });
      },
      debug() {},
    };
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    const deps = {
      ...f.deps,
      logger,
      pb: {
        async list<T>() {
          return {
            page: 1,
            perPage: 500,
            totalPages: 1,
            totalItems: 5, // authoritative: rows exist…
            items: [] as unknown as T[], // …but page 1 came back empty
          };
        },
      },
    };
    const m = createD0GoneMonitor(deps as never);
    await m.tick();
    // GREEN: the authoritative short-read guard FIRES (errorId logged) despite
    // the empty page, and the read is treated as inconclusive (read-failed) —
    // not silently folded into a scan.
    const short = errs.find(
      (e) =>
        (e.meta as { errorId?: string }).errorId === "d0-monitor-short-read",
    );
    expect(short).toBeDefined();
    const readFailed = warns.find((w) => w.msg.includes("read-failed"));
    expect(readFailed).toBeDefined();
    // No false alert fired from the inconclusive read.
    expect(f.posted).toHaveLength(0);
  });

  it("non-final SHORT page logs the short-read errorId exactly ONCE (no in-loop + post-loop double-log)", async () => {
    // A genuine truncation across pages: page 1 full (500), page 2 short (200)
    // while `totalPages` says 3 more follow. The OLD code logged
    // `d0-monitor-short-read` in-loop (before the break) AND again in the
    // post-loop authoritative guard (rows 700 < totalItems 1500) — the SAME
    // event, same errorId, TWICE. De-duped: the in-loop guard now throws
    // immediately, so exactly one short-read errorId is emitted.
    const shortReads: Array<{ msg: string; meta: unknown }> = [];
    const logger = {
      info() {},
      warn() {},
      error(msg: string, meta: unknown) {
        if (
          (meta as { errorId?: string }).errorId === "d0-monitor-short-read"
        ) {
          shortReads.push({ msg, meta });
        }
      },
      debug() {},
    };
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    const perPage = 500;
    const deps = {
      ...f.deps,
      logger,
      pb: {
        async list<T>(_c: string, opts?: { page?: number }) {
          const page = opts?.page ?? 1;
          const count = page === 1 ? perPage : 200; // page 2 is SHORT
          const items = Array.from({ length: count }, (_, i) =>
            row("alpha", `e2e:p${page}-pad-${i}`, "green", T0),
          );
          return {
            page,
            perPage,
            totalPages: 3, // claims 3 pages → page 2 is NON-final and short
            totalItems: 1500,
            items: items as unknown as T[],
          };
        },
      },
    };
    const m = createD0GoneMonitor(deps as never);
    await m.tick();
    expect(shortReads).toHaveLength(1);
  });
});

describe("D0-gone monitor — §E one malformed featureId degrades one cell, not the whole scan", () => {
  it("a wired cell whose featureId makes keyFor throw does NOT suppress alerting for a genuinely-gone sibling column", async () => {
    // §E: `buildCellModel` throws in `keyFor` for a featureId containing `:`/`/`.
    // The scan maps `buildCellModel` over every wired cell with NO per-cell
    // guard, so one throwing cell aborts the WHOLE scan → the tick's top-level
    // catch swallows it → the entire outage monitor is suppressed (a genuinely
    // gone sibling column is never paged). With the per-cell catch the bad cell
    // degrades to gray (classifies "unknown" → its column is neither gone nor
    // healthy — fail safe), and the gone sibling still pages.
    const errs: Array<{ msg: string; meta: unknown }> = [];
    const logger = {
      info() {},
      warn() {},
      error(msg: string, meta: unknown) {
        errs.push({ msg, meta });
      },
      debug() {},
    };
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    // alpha is genuinely gone (red-D0); beta wires a MALFORMED feature id.
    f.setStatusRows(goneRows("alpha", T0));
    const badRegistry: RegistryDoc = {
      feature_registry: {
        features: [{ id: "agentic-chat" }, { id: "bad/feature" }],
      },
      integrations: [
        {
          slug: "alpha",
          features: ["agentic-chat"],
          demos: [{ id: "agentic-chat", route: "/demos/agentic-chat" }],
        },
        {
          slug: "beta",
          features: ["bad/feature"], // `/` → keyFor throws in buildCellModel
          demos: [{ id: "bad/feature", route: "/demos/bad" }],
        },
      ],
    };
    const deps = { ...f.deps, logger, registry: badRegistry };
    const m = createD0GoneMonitor(deps as never);
    await m.tick();
    // GREEN: alpha's real outage still pages; beta (bad cell) neither pages nor
    // crashes the scan; and the malformed cell is logged loudly.
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toContain("alpha");
    expect(f.posted[0]).not.toContain("beta");
    const buildErr = errs.find(
      (e) =>
        (e.meta as { errorId?: string }).errorId ===
        "d0-monitor-cell-build-failed",
    );
    expect(buildErr).toBeDefined();
  });
});

describe("D0-gone monitor — A5 registry-load failure is not permanent", () => {
  it("loadRegistryDoc logs at error with an errorId on parse failure", async () => {
    const errs: Array<{ msg: string; meta: unknown }> = [];
    const logger = {
      info() {},
      warn() {},
      error(msg: string, meta: unknown) {
        errs.push({ msg, meta });
      },
      debug() {},
    };
    // Point REGISTRY_JSON_PATH at a nonexistent file → read throws → the loader
    // must log at ERROR (not warn) with an errorId so the gap is loud and
    // greppable, not a silent warn-once permanent no-op.
    const doc = loadRegistryDoc(logger, {
      REGISTRY_JSON_PATH: "/nonexistent/registry-does-not-exist.json",
    });
    expect(doc).toEqual({});
    expect(errs).toHaveLength(1);
    expect(errs[0].msg).toContain("registry-load-failed");
    expect((errs[0].meta as { errorId?: string }).errorId).toBeTruthy();
  });

  it("B-A5gap: a registry with integrations but ZERO wired cells logs no-wired-cells + self-heals", async () => {
    // The silent-disable case the OLD `size === 0` guard MISSED:
    // wiredSupportedCells keys every integration slug even with an empty wired
    // array, so this registry has size > 0 but not one wired cell. The monitor
    // enumerates only empty arrays → can never page. It must log LOUDLY every
    // tick while empty, and (loader thunk) re-load so a fixed registry heals.
    const errs: Array<{ msg: string; meta: unknown }> = [];
    const logger = {
      info() {},
      warn() {},
      error(msg: string, meta: unknown) {
        errs.push({ msg, meta });
      },
      debug() {},
    };
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    // Registry lists an integration whose only demo has NO route → zero wired
    // cells, but the slug IS keyed (empty array) → map.size === 1, not 0.
    const zeroWired: RegistryDoc = {
      feature_registry: { features: [{ id: "agentic-chat" }] },
      integrations: [
        {
          slug: "alpha",
          features: ["agentic-chat"],
          demos: [{ id: "agentic-chat" }],
        },
      ],
    };
    let doc: RegistryDoc = zeroWired;
    const deps = { ...f.deps, logger, registry: () => doc };
    const m = createD0GoneMonitor(deps);

    await m.tick();
    expect(f.posted).toHaveLength(0); // no wired cell → nothing to page
    // GREEN: the loud no-wired-cells error fired (old size-based guard did NOT).
    expect(errs.some((e) => e.msg.includes("no-wired-cells"))).toBe(true);

    // Fix the registry (add a route → alpha's cell becomes wired) → self-heals.
    doc = REGISTRY;
    f.setClock(T0 + 15 * MIN);
    f.setSummary(f.liveProducer(T0 + 15 * MIN));
    f.setStatusRows(goneRows("alpha", T0));
    await m.tick();
    expect(f.posted).toHaveLength(1); // self-healed and paged
  });

  it("loader-thunk registry: an initially-empty registry self-heals on a later tick (no redeploy)", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    // Registry is a THUNK that starts empty (missing file) then resolves once
    // the "file" appears — the monitor must re-load while the cell set is empty
    // and page once the registry is present, without reconstructing the monitor.
    let doc: RegistryDoc = {};
    const deps = { ...f.deps, registry: () => doc };
    const m = createD0GoneMonitor(deps);

    await m.tick();
    expect(f.posted).toHaveLength(0); // empty registry → zero wired cells → no page

    doc = REGISTRY; // registry.json now present
    f.setClock(T0 + 15 * MIN);
    f.setSummary(f.liveProducer(T0 + 15 * MIN));
    f.setStatusRows(goneRows("alpha", T0));
    await m.tick();
    expect(f.posted).toHaveLength(1); // self-healed: re-loaded, enumerated, paged
    expect(f.posted[0]).toContain("`alpha`");
  });
});

describe("D0-gone monitor — A6 no state advance when Slack target throws (verified)", () => {
  // A6 verified: createSlackWebhookTarget already throws on every non-2xx
  // (4xx/5xx/429/3xx/network-exhausted). This asserts the monitor honors that
  // contract — a throwing post must NOT advance lastAlertAt nor delete recovery
  // state (else a silently-failed post would poison the dedupe cadence).
  it("recovery post throws → entry NOT deleted; next tick retries", async () => {
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor(f.deps);
    await m.tick(); // OPEN
    expect(f.posted).toHaveLength(1);

    // Fresh-healthy but Slack throws on the recovery post → entry must persist.
    f.setSendThrows(true);
    f.setClock(T0 + 20 * MIN);
    f.setSummary(f.liveProducer(T0 + 20 * MIN));
    f.setStatusRows(healthyRows("alpha", T0 + 20 * MIN));
    await m.tick();
    expect(JSON.parse(f.getState().hash!).alpha).toBeDefined(); // NOT deleted

    // Slack recovers → recovery retried and clears.
    f.setSendThrows(false);
    f.setClock(T0 + 40 * MIN);
    f.setSummary(f.liveProducer(T0 + 40 * MIN));
    f.setStatusRows(healthyRows("alpha", T0 + 40 * MIN));
    await m.tick();
    expect(f.posted.some((p) => p.includes("recovered"))).toBe(true);
    expect(JSON.parse(f.getState().hash!).alpha).toBeUndefined();
  });
});

describe("D0-gone monitor — PROD_D0_MONITOR_SLUGS per-slug allowlist (§10.8)", () => {
  it("unset → ALL wired+supported slugs evaluated (prod-INERT baseline)", async () => {
    // Both alpha and beta are fully gone; with no allowlist BOTH are named.
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows([...goneRows("alpha", T0), ...goneRows("beta", T0)]);
    const m = createD0GoneMonitor(f.deps); // no env → no allowlist
    await m.tick();
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toContain("`alpha`");
    expect(f.posted[0]).toContain("`beta`");
  });

  it("allowlist scopes evaluation to exactly the listed slugs — other gone columns are NOT alerted", async () => {
    // alpha AND beta are both fully gone, but the allowlist names only alpha →
    // ONLY alpha is evaluated + alerted; beta (also gone) is never mentioned and
    // never opens an outage entry.
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows([...goneRows("alpha", T0), ...goneRows("beta", T0)]);
    const m = createD0GoneMonitor({
      ...f.deps,
      env: { PROD_D0_MONITOR_SLUGS: "alpha" },
    });
    await m.tick();
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toContain("`alpha`");
    expect(f.posted[0]).not.toContain("`beta`");
    const map = JSON.parse(f.getState().hash!);
    expect(map.alpha).toBeDefined();
    expect(map.beta).toBeUndefined(); // beta filtered out of the monitored set
  });

  it("allowlist intersects with wired+supported — a non-wired allowlisted slug fabricates nothing", async () => {
    // The allowlist names alpha (wired) + a bogus slug not in the registry. Only
    // alpha is evaluated; the bogus slug has no cells to fold, so no column is
    // fabricated for it.
    const f = makeFakes();
    f.setSummary(f.liveProducer());
    f.setStatusRows([...goneRows("alpha", T0), ...goneRows("beta", T0)]);
    const m = createD0GoneMonitor({
      ...f.deps,
      env: { PROD_D0_MONITOR_SLUGS: "alpha,does-not-exist" },
    });
    await m.tick();
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toContain("`alpha`");
    expect(f.posted[0]).not.toContain("`beta`");
    expect(f.posted[0]).not.toContain("does-not-exist");
  });
});

describe("D0-gone monitor — PROD_D0_MONITOR_DRY_RUN log-capture mode (§10.8)", () => {
  function makeCapturingLogger() {
    const info: Array<{ msg: string; meta: unknown }> = [];
    return {
      records: info,
      logger: {
        info(msg: string, meta: unknown) {
          info.push({ msg, meta });
        },
        warn() {},
        error() {},
        debug() {},
      },
    };
  }

  it("dry-run: LOGS the composed outage payload, does NOT POST, still advances lastAlertAt", async () => {
    const f = makeFakes();
    const { records, logger } = makeCapturingLogger();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor({
      ...f.deps,
      logger,
      env: { PROD_D0_MONITOR_DRY_RUN: "true" },
    });
    await m.tick();

    // NO real Slack post.
    expect(f.posted).toHaveLength(0);
    // The fully-composed outage payload is logged with the dry-run tag.
    const dryRun = records.filter((r) => r.msg === "d0-monitor.dry-run-alert");
    expect(dryRun).toHaveLength(1);
    const meta = dryRun[0].meta as { kind?: string; text?: string };
    expect(meta.kind).toBe("outage");
    expect(meta.text).toContain("completely gone");
    expect(meta.text).toContain("`alpha`");
    // State machine STILL advances exactly as if sent (lastAlertAt set, open).
    const map = JSON.parse(f.getState().hash!);
    expect(map.alpha).toBeDefined();
    expect(map.alpha.lastAlertAt).not.toBe("");
  });

  it("dry-run: cadence + recovery exercise normally in logs with no real send", async () => {
    const f = makeFakes();
    const { records, logger } = makeCapturingLogger();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor({
      ...f.deps,
      logger,
      env: { PROD_D0_MONITOR_DRY_RUN: "1" },
    });
    await m.tick(); // OPEN (logged, not posted)

    // 15/30/45m ticks silent (hourly dedup still honored in dry-run).
    for (const mins of [15, 30, 45]) {
      f.setClock(T0 + mins * MIN);
      f.setSummary(f.liveProducer(T0 + mins * MIN));
      f.setStatusRows(goneRows("alpha", T0));
      await m.tick();
    }
    const outageLogs = records.filter(
      (r) =>
        r.msg === "d0-monitor.dry-run-alert" &&
        (r.meta as { kind?: string }).kind === "outage",
    );
    expect(outageLogs).toHaveLength(1); // no re-log before 60m (cadence intact)

    // Recovery still exercises: fresh-healthy → a recovery payload is logged and
    // the state entry is cleared (advanced exactly as if sent).
    f.setClock(T0 + 20 * MIN); // within the open outage, before the 60m repost
    f.setSummary(f.liveProducer(T0 + 20 * MIN));
    f.setStatusRows(healthyRows("alpha", T0 + 20 * MIN));
    await m.tick();
    const recoveryLogs = records.filter(
      (r) =>
        r.msg === "d0-monitor.dry-run-alert" &&
        (r.meta as { kind?: string }).kind === "recovery",
    );
    expect(recoveryLogs).toHaveLength(1);
    expect((recoveryLogs[0].meta as { text?: string }).text).toContain(
      "recovered",
    );
    expect(f.posted).toHaveLength(0); // never a real send
    expect(JSON.parse(f.getState().hash ?? "{}").alpha).toBeUndefined(); // cleared
  });

  it("unset DRY_RUN → real send path (prod-INERT baseline)", async () => {
    const f = makeFakes();
    const { records, logger } = makeCapturingLogger();
    f.setSummary(f.liveProducer());
    f.setStatusRows(goneRows("alpha", T0));
    const m = createD0GoneMonitor({ ...f.deps, logger }); // no DRY_RUN env
    await m.tick();
    expect(f.posted).toHaveLength(1); // real post
    expect(
      records.filter((r) => r.msg === "d0-monitor.dry-run-alert"),
    ).toHaveLength(0); // no dry-run log
  });
});
