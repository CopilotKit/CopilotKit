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
