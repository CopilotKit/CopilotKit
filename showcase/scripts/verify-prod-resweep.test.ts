import { describe, it, expect } from "vitest";
import {
  enqueueProdResweep,
  pollProdFreshness,
  runVerifyProdResweep,
  freshnessKeysForCell,
  cellsFromClosureCsv,
  partitionCellsByAxis,
  createRealProdControlPlane,
} from "./verify-prod-resweep";
import type {
  ProdResweepDeps,
  FakeProdControlPlane,
} from "./verify-prod-resweep";
import type {
  LiveStatusMap,
  StatusRow,
} from "../shell-dashboard/src/lib/live-status";
import { keyFor } from "../shell-dashboard/src/lib/live-status";
import type { GateCell } from "./equivalence-gate";

// ---------------------------------------------------------------------------
// Fake prod control-plane
//
// The real prod path enqueues a triggered tick against the prod harness
// producer (→ probe_jobs in prod PB), the prod harness-workers claim + run the
// jobs, and the result-aggregator writes fresh `status` rows. We model that as
// a clock-driven fake: `enqueue` records the trigger time; the worker fleet
// (modeled by `advanceWorkers`) writes post-trigger rows into the prod map
// after a configurable lag; the poller reads the prod map.
// ---------------------------------------------------------------------------

const NOW0 = Date.parse("2026-06-19T12:00:00.000Z");

function row(
  dimension: string,
  slug: string,
  featureId: string | undefined,
  state: StatusRow["state"],
  observedAtMs: number,
  signal: unknown = null,
): [string, StatusRow] {
  const key = keyFor(dimension, slug, featureId);
  const observed = new Date(observedAtMs).toISOString();
  return [
    key,
    {
      id: `${key}#id`,
      key,
      dimension,
      state,
      signal,
      observed_at: observed,
      transitioned_at: observed,
      fail_count: state === "red" ? 1 : 0,
      first_failure_at: state === "red" ? observed : null,
    },
  ];
}

const MAPPED_FEATURE = "agentic-chat"; // present in CATALOG_TO_D5_KEY

/** Build a green-ladder cell map at a given observed_at (ms). */
function greenCellMap(slug: string, observedAtMs: number): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  m.set(...row("e2e", slug, MAPPED_FEATURE, "green", observedAtMs));
  m.set(...row("chat", slug, undefined, "green", observedAtMs));
  m.set(...row("d5", slug, MAPPED_FEATURE, "green", observedAtMs));
  m.set(...row("d6", slug, MAPPED_FEATURE, "green", observedAtMs));
  return m;
}

function redCellMap(slug: string, observedAtMs: number): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  m.set(...row("e2e", slug, MAPPED_FEATURE, "red", observedAtMs));
  m.set(...row("chat", slug, undefined, "green", observedAtMs));
  return m;
}

function mergeMaps(...maps: LiveStatusMap[]): LiveStatusMap {
  const out: LiveStatusMap = new Map();
  for (const m of maps) for (const [k, v] of m) out.set(k, v);
  return out;
}

const CELL = (slug: string): GateCell => ({
  slug,
  featureId: MAPPED_FEATURE,
  isSupported: true,
  isWired: true,
});

/**
 * A controllable fake prod control-plane. `enqueue` records the trigger and
 * how many jobs went on the queue. `runWorkers(atMs, builder)` simulates the
 * worker fleet draining the queue and writing fresh status rows (the
 * aggregator output) at `atMs` — call it to land post-trigger rows.
 */
function makeFake(opts: {
  enqueued?: number;
  enqueueFailures?: number;
  workersProvisioned?: boolean;
}): FakeProdControlPlane & {
  prod: LiveStatusMap;
  runWorkers: (atMs: number, mapBuilder: () => LiveStatusMap) => void;
  triggerAt: number | null;
} {
  const prod: LiveStatusMap = new Map();
  let triggerAt: number | null = null;
  return {
    prod,
    triggerAt,
    enqueue: async (atMs: number) => {
      triggerAt = atMs;
      return {
        triggerAt: atMs,
        enqueued: opts.enqueued ?? 3,
        enqueueFailures: opts.enqueueFailures ?? 0,
        workersProvisioned: opts.workersProvisioned ?? true,
      };
    },
    readProdStatus: async () => new Map(prod),
    runWorkers(atMs, mapBuilder) {
      for (const [k, v] of mapBuilder()) prod.set(k, v);
      void atMs;
    },
  };
}

// ---------------------------------------------------------------------------
// cellsFromClosureCsv — closure-CSV (U4 succeeded_csv) → gate cells
//
// The closure CSV carries SSOT `.name` values: integrations are
// `showcase-<slug>` (prefixed); infra/shell services are bare names
// (`aimock`, `dashboard`, `docs`, `dojo`, `webhooks`, `pocketbase`,
// `harness`). The derived cell must (1) strip the `showcase-` prefix to the
// harness slug the enqueue discovery + keyFor use, (2) carry only catalogued
// integrations (infra/shells excluded), and (3) stamp the slug's
// representative catalog feature.
// ---------------------------------------------------------------------------

describe("cellsFromClosureCsv", () => {
  it("derives integration cells with the showcase- prefix STRIPPED and infra/shells excluded", () => {
    const cells = cellsFromClosureCsv(
      "showcase-langgraph-python,aimock,pocketbase,dashboard,docs,harness",
    );
    // Only the one real integration becomes a cell; every infra/shell token
    // (aimock/pocketbase/dashboard/docs/harness) is dropped.
    expect(cells).toHaveLength(1);
    const cell = cells[0]!;
    // Slug is the HARNESS slug (prefix stripped) — NOT the raw closure token
    // `showcase-langgraph-python`, which would never match keyFor / the
    // enqueue discovery's serviceSlug.
    expect(cell.slug).toBe("langgraph-python");
    // featureId is the slug's representative catalog feature (present in
    // CATALOG_TO_D5_KEY), NOT a phantom.
    expect(cell.featureId).toBe(MAPPED_FEATURE);
  });

  it("excludes a showcase-prefixed but non-probe-wired service (ms-agent-harness-dotnet)", () => {
    const cells = cellsFromClosureCsv(
      "showcase-langgraph-python,showcase-ms-agent-harness-dotnet",
    );
    expect(cells.map((c) => c.slug)).toEqual(["langgraph-python"]);
  });

  it("derives multiple integration cells, each prefix-stripped", () => {
    const cells = cellsFromClosureCsv(
      "showcase-langgraph-python,showcase-mastra,webhooks,dojo",
    );
    expect(cells.map((c) => c.slug).sort()).toEqual([
      "langgraph-python",
      "mastra",
    ]);
  });

  it("routes a starter-* token to the STARTER axis (column slug + probeAxis), NOT a phantom agentic-chat cell", () => {
    // A closure carrying BOTH a showcase-* integration and a starter-* slug.
    // The integration stays on the feature (agent) axis; the starter must be
    // emitted on the STARTER axis: slug remapped to its dashboard COLUMN slug
    // (STARTER_TO_COLUMN), probeAxis "starter", and NOT a second agentic-chat
    // cell.
    const cells = cellsFromClosureCsv("showcase-langgraph-python,starter-adk");

    const integration = cells.find((c) => c.slug === "langgraph-python");
    expect(integration).toBeDefined();
    expect(integration!.featureId).toBe(MAPPED_FEATURE);
    expect(integration!.probeAxis ?? "agent").toBe("agent");

    // `starter-adk` → STARTER_TO_COLUMN["adk"] === "google-adk".
    const starter = cells.find((c) => c.probeAxis === "starter");
    expect(starter).toBeDefined();
    expect(starter!.slug).toBe("google-adk");
    // The starter cell must NOT masquerade as an agentic-chat feature cell.
    expect(starter!.featureId).not.toBe(MAPPED_FEATURE);

    // Exactly two cells, and exactly ONE of them is a starter — no phantom
    // duplicate agentic-chat cell for the starter.
    expect(cells).toHaveLength(2);
    expect(cells.filter((c) => c.featureId === MAPPED_FEATURE)).toHaveLength(1);
  });

  it("maps a direct-slug starter-* token (slug === column slug)", () => {
    // `langgraph-python` is a DIRECT starter mapping (starter slug === column
    // slug), distinct from the `showcase-langgraph-python` integration token.
    const cells = cellsFromClosureCsv("starter-langgraph-python");
    expect(cells).toHaveLength(1);
    expect(cells[0]!.slug).toBe("langgraph-python");
    expect(cells[0]!.probeAxis).toBe("starter");
  });
});

// ---------------------------------------------------------------------------
// freshnessKeysForCell
// ---------------------------------------------------------------------------

describe("freshnessKeysForCell", () => {
  it("enumerates the e2e/chat/tools/health + d5/d6 family keys for a cell", () => {
    const keys = freshnessKeysForCell(CELL("langgraph-python"));
    expect(keys).toContain(keyFor("e2e", "langgraph-python", MAPPED_FEATURE));
    expect(keys).toContain(keyFor("chat", "langgraph-python"));
    expect(keys).toContain(keyFor("d6", "langgraph-python", MAPPED_FEATURE));
  });

  it("enumerates the starter:<col>/<level> keys for a STARTER-axis cell", () => {
    const keys = freshnessKeysForCell({
      slug: "google-adk",
      featureId: "starter",
      isSupported: true,
      isWired: true,
      probeAxis: "starter",
    });
    // Starter axis: the 4 per-level rows, NOT the agent e2e/chat/d5/d6 keys.
    expect(keys).toContain(keyFor("starter", "google-adk", "health"));
    expect(keys).toContain(keyFor("starter", "google-adk", "interaction"));
    expect(keys).not.toContain(keyFor("e2e", "google-adk", MAPPED_FEATURE));
  });

  it("uses only D1/D2 rows for a liveness-only cell", () => {
    const keys = freshnessKeysForCell({
      slug: "langgraph-python",
      featureId: null,
      isSupported: true,
      isWired: true,
    });

    expect(keys).toEqual([
      keyFor("health", "langgraph-python"),
      keyFor("agent", "langgraph-python"),
    ]);
  });
});

// ---------------------------------------------------------------------------
// enqueueProdResweep
// ---------------------------------------------------------------------------

describe("enqueueProdResweep", () => {
  it("fires the triggered enqueue against prod and returns the trigger instant", async () => {
    const fake = makeFake({ enqueued: 3 });
    const deps: ProdResweepDeps = {
      controlPlane: fake,
      cells: [CELL("a"), CELL("b"), CELL("c")],
      readStagingStatus: async () => new Map(),
      now: () => NOW0,
      sleep: async () => {},
    };
    const res = await enqueueProdResweep(deps);
    expect(res.triggerAt).toBe(NOW0);
    expect(res.enqueued).toBe(3);
    expect(res.workersProvisioned).toBe(true);
  });

  it("REFUSES when zero jobs are enqueued (nothing will ever land)", async () => {
    const fake = makeFake({ enqueued: 0 });
    const deps: ProdResweepDeps = {
      controlPlane: fake,
      cells: [CELL("a")],
      readStagingStatus: async () => new Map(),
      now: () => NOW0,
      sleep: async () => {},
    };
    await expect(enqueueProdResweep(deps)).rejects.toThrow(/enqueued 0 jobs/i);
  });

  it("REFUSES on partial enqueue failure (the missing cells never report)", async () => {
    const fake = makeFake({ enqueued: 2, enqueueFailures: 1 });
    const deps: ProdResweepDeps = {
      controlPlane: fake,
      cells: [CELL("a"), CELL("b"), CELL("c")],
      readStagingStatus: async () => new Map(),
      now: () => NOW0,
      sleep: async () => {},
    };
    await expect(enqueueProdResweep(deps)).rejects.toThrow(/enqueue failure/i);
  });

  it("annotates fallback (inline) mode when prod workers are unprovisioned", async () => {
    const fake = makeFake({ enqueued: 3, workersProvisioned: false });
    const deps: ProdResweepDeps = {
      controlPlane: fake,
      cells: [CELL("a")],
      readStagingStatus: async () => new Map(),
      now: () => NOW0,
      sleep: async () => {},
    };
    const res = await enqueueProdResweep(deps);
    expect(res.workersProvisioned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pollProdFreshness
// ---------------------------------------------------------------------------

describe("pollProdFreshness", () => {
  it("waits until every promoted cell has a post-trigger row, then returns", async () => {
    const fake = makeFake({ enqueued: 2 });
    const triggerAt = NOW0;
    // The worker fleet lands fresh rows on the 2nd poll tick.
    let tick = 0;
    const clock = { t: NOW0 + 1_000 };
    const deps: ProdResweepDeps = {
      controlPlane: fake,
      cells: [CELL("a"), CELL("b")],
      readStagingStatus: async () => new Map(),
      now: () => clock.t,
      sleep: async (ms) => {
        clock.t += ms;
        tick += 1;
        if (tick === 2) {
          // Workers drain on the 2nd sleep: write fresh post-trigger rows.
          fake.runWorkers(clock.t, () =>
            mergeMaps(
              greenCellMap("a", triggerAt + 5_000),
              greenCellMap("b", triggerAt + 5_000),
            ),
          );
        }
      },
    };
    const prodRows = await pollProdFreshness(deps, {
      triggerAt,
      timeoutMs: 20 * 60_000,
      pollIntervalMs: 5_000,
    });
    // Every cell now has a contributing row at/after the trigger.
    expect(prodRows.get(keyFor("e2e", "a", MAPPED_FEATURE))?.state).toBe(
      "green",
    );
    expect(prodRows.get(keyFor("e2e", "b", MAPPED_FEATURE))?.state).toBe(
      "green",
    );
  });

  it("REFUSES with 'did not complete' on timeout when rows never post-date the trigger", async () => {
    const fake = makeFake({ enqueued: 1 });
    const triggerAt = NOW0;
    // Pre-existing STALE row from before the trigger — never refreshed.
    for (const [k, v] of greenCellMap("a", triggerAt - 60_000)) {
      fake.prod.set(k, v);
    }
    const clock = { t: NOW0 + 1_000 };
    const deps: ProdResweepDeps = {
      controlPlane: fake,
      cells: [CELL("a")],
      readStagingStatus: async () => new Map(),
      now: () => clock.t,
      sleep: async (ms) => {
        clock.t += ms;
      },
    };
    await expect(
      pollProdFreshness(deps, {
        triggerAt,
        timeoutMs: 20 * 60_000,
        pollIntervalMs: 5_000,
      }),
    ).rejects.toThrow(/re-sweep did not complete/i);
  });
});

// ---------------------------------------------------------------------------
// runVerifyProdResweep — the full enqueue → poll → equivalence-gate path
// ---------------------------------------------------------------------------

describe("runVerifyProdResweep", () => {
  it("PASSES when fresh prod equals staging (both green) after the re-sweep", async () => {
    const fake = makeFake({ enqueued: 1 });
    const clock = { t: NOW0 + 1_000 };
    let tick = 0;
    const deps: ProdResweepDeps = {
      controlPlane: fake,
      cells: [CELL("a")],
      readStagingStatus: async () => greenCellMap("a", NOW0),
      now: () => clock.t,
      sleep: async (ms) => {
        clock.t += ms;
        tick += 1;
        if (tick === 1) {
          fake.runWorkers(clock.t, () => greenCellMap("a", NOW0 + 5_000));
        }
      },
    };
    const result = await runVerifyProdResweep(deps);
    expect(result.gate.passed).toBe(true);
    // The trigger watermark is the clock reading AT enqueue (NOW0 + 1_000),
    // not the test's NOW0 constant.
    expect(result.triggerAt).toBe(NOW0 + 1_000);
  });

  it("FAILS the gate on a genuine prod regression (staging green, fresh prod red)", async () => {
    const fake = makeFake({ enqueued: 1 });
    const clock = { t: NOW0 + 1_000 };
    let tick = 0;
    const deps: ProdResweepDeps = {
      controlPlane: fake,
      cells: [CELL("a")],
      readStagingStatus: async () => greenCellMap("a", NOW0),
      now: () => clock.t,
      sleep: async (ms) => {
        clock.t += ms;
        tick += 1;
        if (tick === 1) {
          // Fresh post-trigger prod row, but RED → genuine regression.
          fake.runWorkers(clock.t, () => redCellMap("a", NOW0 + 5_000));
        }
      },
    };
    const result = await runVerifyProdResweep(deps);
    expect(result.gate.passed).toBe(false);
    expect(result.gate.mismatches).toHaveLength(1);
  });

  it("REFUSES (timeout) before consulting the gate when the re-sweep never lands", async () => {
    const fake = makeFake({ enqueued: 1 });
    const clock = { t: NOW0 + 1_000 };
    const deps: ProdResweepDeps = {
      controlPlane: fake,
      cells: [CELL("a")],
      readStagingStatus: async () => greenCellMap("a", NOW0),
      now: () => clock.t,
      sleep: async (ms) => {
        clock.t += ms;
      },
    };
    await expect(runVerifyProdResweep(deps)).rejects.toThrow(
      /re-sweep did not complete/i,
    );
  });
});

// ---------------------------------------------------------------------------
// partitionCellsByAxis — split the promoted closure into the two enqueue axes
//
// The REAL prod enqueue must drive BOTH probe families: the AGENT-axis cells
// (showcase-* integrations) go through the d6 producer→queue tick, while the
// STARTER-axis cells (starter-* containers) are probed on the `starter_smoke`
// CRON matrix. The two have DIFFERENT trigger surfaces + DIFFERENT keyspaces,
// so the enqueue must partition the closure and fire the correct tick per axis.
// A starter cell carries the dashboard COLUMN slug; the starter_smoke trigger
// filter is keyed by the discovery service name (`starter_smoke:starter-<raw>`),
// so the partition must reverse-map column→raw via STARTER_TO_COLUMN.
// ---------------------------------------------------------------------------

const STARTER_CELL = (columnSlug: string): GateCell => ({
  slug: columnSlug,
  featureId: "starter",
  isSupported: true,
  isWired: true,
  probeAxis: "starter",
});

describe("partitionCellsByAxis", () => {
  it("separates agent (showcase-*) slugs from starter trigger keys", () => {
    const { agentSlugs, starterTriggerKeys } = partitionCellsByAxis([
      CELL("langgraph-python"),
      CELL("mastra"),
      // google-adk is the COLUMN slug; its starter raw slug is `adk`.
      STARTER_CELL("google-adk"),
    ]);
    expect(agentSlugs.sort()).toEqual(["langgraph-python", "mastra"]);
    // Starter trigger key uses the discovery service name (raw slug), NOT the
    // column slug, and NOT a d6 keyspace.
    expect(starterTriggerKeys).toEqual(["starter_smoke:starter-adk"]);
  });

  it("reverse-maps a DIRECT starter mapping (column slug === raw slug)", () => {
    // langgraph-python is a direct mapping (raw === column).
    const { agentSlugs, starterTriggerKeys } = partitionCellsByAxis([
      STARTER_CELL("langgraph-python"),
    ]);
    expect(agentSlugs).toEqual([]);
    expect(starterTriggerKeys).toEqual([
      "starter_smoke:starter-langgraph-python",
    ]);
  });

  it("reverse-maps a DRIFT starter mapping (column slug !== raw slug)", () => {
    // strands column slug maps from the `strands-python` raw starter slug.
    const { starterTriggerKeys } = partitionCellsByAxis([
      STARTER_CELL("strands"),
    ]);
    expect(starterTriggerKeys).toEqual([
      "starter_smoke:starter-strands-python",
    ]);
  });
});

// ---------------------------------------------------------------------------
// createRealProdControlPlane — axis-split real enqueue (injected seams)
//
// The real enqueue is the bug surface the CR flagged: a starter-inclusive
// promote's enqueue must (a) enumerate the prod starter service and fire a
// starter_smoke tick (NOT a d6 tick — d6 discovery EXCLUDES starters), and
// (b) the freshness poll must then wait on `starter:<col>/<level>` keys (which
// the starter_smoke probe produces), NOT the agent e2e/d6 keys. Before the
// fix, starter cells were dropped by the showcase- discovery filter and a d6
// tick was fired, so the `starter:<col>/<level>` rows the freshness poll waits
// on were NEVER produced → 20-min timeout → REFUSE.
//
// We exercise the real factory with INJECTED enqueue seams (no Railway, no
// harness graph, no HTTP): the seams record which axis was driven with which
// slugs/keys, so the test proves the split fires a starter_smoke tick for the
// starter cell and a d6 tick for the agent cell.
// ---------------------------------------------------------------------------

describe("createRealProdControlPlane axis split", () => {
  const prodPb = { url: "http://pb", email: "e", password: "p" };
  const prodRailwayEnv = {
    token: "rw",
    projectId: "proj",
    environmentId: "env",
  };

  it("fires a starter_smoke tick for starter cells and a d6 tick for agent cells", async () => {
    const calls: {
      agentSlugs?: string[];
      starterTriggerKeys?: string[];
    } = {};
    const cp = createRealProdControlPlane({
      cells: [CELL("langgraph-python"), STARTER_CELL("google-adk")],
      prodPb,
      prodRailwayEnv,
      workersProvisioned: true,
      // Injected seams — record the axis-routed payloads instead of touching
      // Railway / the harness producer / the prod harness HTTP trigger.
      agentEnqueue: async (slugs) => {
        calls.agentSlugs = slugs;
        return { enqueued: slugs.length, enqueueFailures: 0 };
      },
      starterEnqueue: async (triggerKeys) => {
        calls.starterTriggerKeys = triggerKeys;
        return { enqueued: triggerKeys.length, enqueueFailures: 0 };
      },
    });

    const res = await cp.enqueue(NOW0);

    // Agent axis: the showcase integration goes through the d6 producer tick.
    expect(calls.agentSlugs).toEqual(["langgraph-python"]);
    // Starter axis: the starter container is triggered on starter_smoke, keyed
    // by its discovery service name (raw slug), NOT a d6 keyspace.
    expect(calls.starterTriggerKeys).toEqual(["starter_smoke:starter-adk"]);
    // Both jobs counted toward the enqueue total.
    expect(res.enqueued).toBe(2);
    expect(res.enqueueFailures).toBe(0);
    expect(res.triggerAt).toBe(NOW0);
  });

  it("does NOT fire a d6 tick when the closure is starter-only", async () => {
    let agentCalled = false;
    let starterKeys: string[] = [];
    const cp = createRealProdControlPlane({
      cells: [STARTER_CELL("google-adk")],
      prodPb,
      prodRailwayEnv,
      workersProvisioned: true,
      agentEnqueue: async (slugs) => {
        agentCalled = true;
        return { enqueued: slugs.length, enqueueFailures: 0 };
      },
      starterEnqueue: async (triggerKeys) => {
        starterKeys = triggerKeys;
        return { enqueued: triggerKeys.length, enqueueFailures: 0 };
      },
    });

    const res = await cp.enqueue(NOW0);

    // A starter-only closure must NOT drive the d6 producer at all (no agent
    // cells → no showcase-* discovery tick).
    expect(agentCalled).toBe(false);
    expect(starterKeys).toEqual(["starter_smoke:starter-adk"]);
    expect(res.enqueued).toBe(1);
  });

  it("freshness keys the poll waits on for a starter cell are starter:<col>/<level>, matching what starter_smoke produces", () => {
    // The enqueue fires starter_smoke (above); the freshness poll must then
    // consult the SAME keyspace starter_smoke writes — `starter:<col>/<level>`,
    // NOT the agent e2e/d6 family. This closes the loop the CR flagged: enqueue
    // axis ↔ freshness keyspace must agree, else the poll times out.
    const keys = freshnessKeysForCell(STARTER_CELL("google-adk"));
    expect(keys).toEqual([
      keyFor("starter", "google-adk", "health"),
      keyFor("starter", "google-adk", "agent"),
      keyFor("starter", "google-adk", "chat"),
      keyFor("starter", "google-adk", "interaction"),
    ]);
    // It must NOT consult the d6 keyspace the (wrong) d6 tick would produce.
    expect(keys).not.toContain(keyFor("d6", "google-adk", MAPPED_FEATURE));
  });
});
