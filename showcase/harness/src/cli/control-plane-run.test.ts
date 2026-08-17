/**
 * Unit tests for the cli/control-plane-run module — A18's per-demo scoping
 * helpers (`buildLocalServicesJson`, `expectedKeys`, `dedupeScopes`) and the
 * `runViaControlPlane` orchestrator's error-surfacing behavior.
 *
 * The heavy fleet/queue/pb modules are mocked at import time so we can
 * exercise `runViaControlPlane`'s deduplication threading, scope-label error
 * messages, and partial-enqueue failure handling WITHOUT spinning up real
 * PocketBase / queue infrastructure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LocalConfig } from "./config.js";
import type { TestTarget } from "./targets.js";
import type { Logger } from "../types/index.js";

// ---------------------------------------------------------------------------
// Hoisted mocks — every dependency that opens a socket / shells out / reaches
// for the disk is replaced with a vi.fn we can introspect from the tests.
// ---------------------------------------------------------------------------
const {
  tickResultRef,
  createJobProducerMock,
  createPbClientMock,
  createJobClaimClientMock,
  createFleetQueueClientMock,
  createE2eDeepEnumMock,
  createServiceEnumMock,
  demosForSlugMock,
  loadManifestMock,
} = vi.hoisted(() => ({
  // A mutable ref the producer mock returns from `tick()` so per-test we can
  // simulate enqueue success / partial failure / total failure.
  tickResultRef: {
    current: {
      runId: "test-run-1",
      enqueued: 1,
      enqueueFailures: 0,
      truncatedByStop: 0,
      skippedForBacklog: 0,
      backlogGateFailedOpen: 0,
      sweptExpired: false,
      sweepFailed: false,
      reclaimed: 0,
      enumerateFailed: false,
    } as {
      runId: string;
      enqueued: number;
      enqueueFailures: number;
      truncatedByStop: number;
      skippedForBacklog: number;
      backlogGateFailedOpen: number;
      sweptExpired: boolean;
      sweepFailed: boolean;
      reclaimed: number;
      enumerateFailed: boolean;
    },
  },
  createJobProducerMock: vi.fn(),
  createPbClientMock: vi.fn(() => ({}) as unknown),
  createJobClaimClientMock: vi.fn(() => ({}) as unknown),
  createFleetQueueClientMock: vi.fn(() => ({}) as unknown),
  createE2eDeepEnumMock: vi.fn(() => async () => []),
  createServiceEnumMock: vi.fn(() => async () => []),
  demosForSlugMock: vi.fn((slug: string): string[] => [
    `${slug}-demo-a`,
    `${slug}-demo-b`,
  ]),
  // `loadManifest` reads manifest.yaml from disk; mock so tests don't need a
  // real integration tree. Default = no NSF; per-test override via
  // `mockReturnValue` to simulate a manifest that declares NSF.
  loadManifestMock: vi.fn(
    (
      slug: string,
    ): {
      slug: string;
      name: string;
      features: string[];
      not_supported_features?: string[];
    } => ({
      slug,
      name: `Showcase ${slug}`,
      features: [],
      not_supported_features: undefined,
    }),
  ),
}));

vi.mock("../fleet/control-plane/job-producer.js", () => ({
  createJobProducer: createJobProducerMock,
}));
vi.mock("../storage/pb-client.js", () => ({
  createPbClient: createPbClientMock,
}));
vi.mock("../fleet/job-claim.js", () => ({
  createJobClaimClient: createJobClaimClientMock,
}));
vi.mock("../fleet/queue-client.js", () => ({
  createFleetQueueClient: createFleetQueueClientMock,
}));
vi.mock("../fleet/control-plane/catalog-enumerator.js", () => ({
  createE2eDeepServiceEnumerator: createE2eDeepEnumMock,
  createServiceEnumerator: createServiceEnumMock,
  D6_DRIVER_KIND: "d6",
}));
vi.mock("../probes/discovery/railway-services.js", () => ({
  railwayServicesSource: () => async () => ({ ok: true, items: [] }),
}));

// `demosForSlug` reads the manifest from disk — mock so tests don't need a
// real integration tree on disk.
vi.mock("./targets.js", async () => {
  const actual =
    await vi.importActual<typeof import("./targets.js")>("./targets.js");
  return {
    ...actual,
    demosForSlug: (slug: string, _config: LocalConfig) =>
      demosForSlugMock(slug),
    loadManifest: (slug: string, _config: LocalConfig) =>
      loadManifestMock(slug),
  };
});

import {
  buildLocalServicesJson,
  expectedKeys,
  dedupeScopes,
  runViaControlPlane,
  verdictsFromOwnJobs,
} from "./control-plane-run.js";
import type { SlugScope } from "./control-plane-run.js";

const SILENT_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const STUB_CONFIG: LocalConfig = {
  showcaseDir: "/tmp/showcase",
  composeFile: "/tmp/docker-compose.local.yml",
  localPorts: {},
  pocketbase: {
    url: "http://localhost:8090",
    email: "admin@example.com",
    password: "showcase-local-dev",
  },
  aimockUrl: "http://localhost:4010",
  dashboardUrl: "http://localhost:3210",
  dashboardPort: 3210,
  frontendBaseUrl: "http://localhost:3200",
  frontendPort: 3200,
  // Empty = no slug is served by the unified frontend, which is the state of
  // the tree today and keeps every composed URL on the pre-split shape.
  unifiedFrontendSlugs: new Set<string>(),
};

// Replace process.env.LOCAL_SERVICES_JSON across tests so `buildLocalServicesJson`
// always falls through to the synthesis branch.
const origEnv = { ...process.env };
beforeEach(() => {
  delete process.env.LOCAL_SERVICES_JSON;
  loadManifestMock.mockReset();
  loadManifestMock.mockImplementation((slug: string) => ({
    slug,
    name: `Showcase ${slug}`,
    features: [],
    not_supported_features: undefined,
  }));
  createJobProducerMock.mockReset();
  createJobProducerMock.mockReturnValue({
    start: vi.fn(),
    stop: vi.fn(async () => {}),
    tick: vi.fn(async () => tickResultRef.current),
  });
  // Reset the tick payload to the default (single successful enqueue).
  tickResultRef.current = {
    runId: "test-run-1",
    enqueued: 1,
    enqueueFailures: 0,
    truncatedByStop: 0,
    skippedForBacklog: 0,
    backlogGateFailedOpen: 0,
    sweptExpired: false,
    sweepFailed: false,
    reclaimed: 0,
    enumerateFailed: false,
  };
});
afterEach(() => {
  // Restore env between tests so a stray set doesn't bleed across.
  process.env = { ...origEnv };
});

// ---------------------------------------------------------------------------
// buildLocalServicesJson
// ---------------------------------------------------------------------------
describe("buildLocalServicesJson", () => {
  it("d5 no demo → demos:[agentic-chat] regardless of manifest", () => {
    const scopes: SlugScope[] = [{ slug: "langgraph-python" }];
    const out = JSON.parse(
      buildLocalServicesJson(scopes, "d5", STUB_CONFIG),
    ) as Array<{
      name: string;
      publicUrl: string;
      demos: string[];
      notSupportedFeatures: string[];
    }>;
    expect(out).toEqual([
      {
        name: "showcase-langgraph-python",
        // BOTH AXES are always emitted now. For an UNMIGRATED slug (STUB_CONFIG
        // has an empty `unifiedFrontendSlugs`) they are the same origin, so the
        // composed URLs are byte-identical to the pre-two-axis behaviour and
        // `toDriverInputs` still emits a single `backendUrl`.
        publicUrl: "http://langgraph-python:10000",
        agentBaseUrl: "http://langgraph-python:10000",
        demos: ["agentic-chat"],
        notSupportedFeatures: [],
      },
    ]);
  });

  // ─────────────────────────────────────────────────────────────────────
  // MIGRATION AXIS. `showcase test <slug> --d6` goes through the fleet
  // control-plane by DEFAULT (`--direct` is labelled legacy/debug), so this is
  // the path that has to honour `demo_frontend: unified`. It previously
  // hardcoded `http://<slug>:10000` and emitted no agent axis at all, which
  // made the real verification path unusable for exactly the slugs being
  // migrated.
  // ─────────────────────────────────────────────────────────────────────
  it("migrated slug: demo origin goes through the unified frontend, agent origin does NOT", () => {
    const migratedConfig: LocalConfig = {
      ...STUB_CONFIG,
      unifiedFrontendSlugs: new Set(["langgraph-python"]),
    };
    const out = JSON.parse(
      buildLocalServicesJson(
        [{ slug: "langgraph-python" }],
        "d5",
        migratedConfig,
      ),
    ) as Array<{ publicUrl: string; agentBaseUrl: string }>;

    // Demos: the unified app, WITH the /<slug> segment (consumers append
    // /demos/<id>; without the segment every cell probes the app root).
    expect(out[0].publicUrl).toBe(
      "http://frontend-nextjs:3000/langgraph-python",
    );
    // Agent: still the integration's own container. THE FALSE-GREEN GUARD — if
    // this ever becomes the frontend origin, a live unified frontend greens a
    // cell whose agent is dead.
    expect(out[0].agentBaseUrl).toBe("http://langgraph-python:10000");
    expect(out[0].agentBaseUrl).not.toContain("frontend-nextjs");
  });

  it("migrated slug: the two axes are different values (not one URL twice)", () => {
    const migratedConfig: LocalConfig = {
      ...STUB_CONFIG,
      unifiedFrontendSlugs: new Set(["mastra"]),
    };
    const out = JSON.parse(
      buildLocalServicesJson([{ slug: "mastra" }], "d6", migratedConfig),
    ) as Array<{ publicUrl: string; agentBaseUrl: string }>;
    expect(out[0].publicUrl).not.toBe(out[0].agentBaseUrl);
  });

  it("unmigrated slug: the two axes coincide, so nothing changes for it", () => {
    const out = JSON.parse(
      buildLocalServicesJson([{ slug: "agno" }], "d6", STUB_CONFIG),
    ) as Array<{ publicUrl: string; agentBaseUrl: string }>;
    expect(out[0].publicUrl).toBe("http://agno:10000");
    expect(out[0].agentBaseUrl).toBe("http://agno:10000");
  });

  it("d5 with demo → demos:[<demo>] (overrides the level default)", () => {
    const scopes: SlugScope[] = [
      { slug: "built-in-agent", demo: "tool-rendering" },
    ];
    const out = JSON.parse(
      buildLocalServicesJson(scopes, "d5", STUB_CONFIG),
    ) as Array<{ demos: string[] }>;
    expect(out[0].demos).toEqual(["tool-rendering"]);
  });

  it("d6 no demo → demos:[full demo set] via demosForSlug", () => {
    demosForSlugMock.mockReturnValueOnce(["agentic-chat", "tool-rendering"]);
    const scopes: SlugScope[] = [{ slug: "langgraph-python" }];
    const out = JSON.parse(
      buildLocalServicesJson(scopes, "d6", STUB_CONFIG),
    ) as Array<{ demos: string[] }>;
    expect(out[0].demos).toEqual(["agentic-chat", "tool-rendering"]);
  });

  it("d6 with demo → demos:[<demo>] (per-demo scoping)", () => {
    const scopes: SlugScope[] = [
      { slug: "built-in-agent", demo: "tool-rendering" },
    ];
    const out = JSON.parse(
      buildLocalServicesJson(scopes, "d6", STUB_CONFIG),
    ) as Array<{ demos: string[] }>;
    expect(out[0].demos).toEqual(["tool-rendering"]);
  });

  it("honors LOCAL_SERVICES_JSON env override verbatim", () => {
    process.env.LOCAL_SERVICES_JSON = '[{"name":"showcase-from-env"}]';
    const scopes: SlugScope[] = [{ slug: "ignored" }];
    expect(buildLocalServicesJson(scopes, "d5", STUB_CONFIG)).toBe(
      '[{"name":"showcase-from-env"}]',
    );
  });

  // ─────────────────────────────────────────────────────────────────────
  // not_supported_features (NSF) threading — LOCAL==STAGING parity.
  // The synthesized roster MUST carry the manifest's NSF so the worker's
  // D6 driver reclassifies architecturally/upstream-blocked features as
  // skipped-incapable instead of red (mirrors the legacy --direct path in
  // targets.ts buildFullInputs / buildDeepInputs).
  // ─────────────────────────────────────────────────────────────────────
  it("d6 threads manifest not_supported_features into the synthesized roster", () => {
    loadManifestMock.mockReturnValue({
      slug: "ms-agent-harness-dotnet",
      name: "Showcase ms-agent-harness-dotnet",
      features: ["beautiful-chat"],
      not_supported_features: [
        "shared-state-streaming",
        "gen-ui-interrupt",
        "interrupt-headless",
      ],
    });
    const scopes: SlugScope[] = [{ slug: "ms-agent-harness-dotnet" }];
    const out = JSON.parse(
      buildLocalServicesJson(scopes, "d6", STUB_CONFIG),
    ) as Array<{ notSupportedFeatures: string[] }>;
    expect(out[0].notSupportedFeatures).toEqual([
      "shared-state-streaming",
      "gen-ui-interrupt",
      "interrupt-headless",
    ]);
  });

  it("d5 threads manifest not_supported_features into the synthesized roster", () => {
    loadManifestMock.mockReturnValue({
      slug: "ms-agent-harness-dotnet",
      name: "Showcase ms-agent-harness-dotnet",
      features: ["beautiful-chat"],
      not_supported_features: ["shared-state-streaming"],
    });
    const scopes: SlugScope[] = [{ slug: "ms-agent-harness-dotnet" }];
    const out = JSON.parse(
      buildLocalServicesJson(scopes, "d5", STUB_CONFIG),
    ) as Array<{ notSupportedFeatures: string[] }>;
    expect(out[0].notSupportedFeatures).toEqual(["shared-state-streaming"]);
  });

  it("defaults notSupportedFeatures to [] when the manifest omits the field", () => {
    // default loadManifestMock returns not_supported_features: undefined
    const scopes: SlugScope[] = [{ slug: "langgraph-python" }];
    const out = JSON.parse(
      buildLocalServicesJson(scopes, "d6", STUB_CONFIG),
    ) as Array<{ notSupportedFeatures: string[] }>;
    expect(out[0].notSupportedFeatures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// expectedKeys
// ---------------------------------------------------------------------------
describe("expectedKeys", () => {
  it("d5 no demo → aggregate + agentic-chat side row", () => {
    expect(expectedKeys("d5", "langgraph-python")).toEqual([
      "d5-single-pill-e2e:langgraph-python",
      "d5:langgraph-python/agentic-chat",
    ]);
  });

  it("d5 with demo → per-featureType side row only", () => {
    // `tool-rendering` maps 1:1 to feature `tool-rendering`.
    expect(expectedKeys("d5", "built-in-agent", "tool-rendering")).toEqual([
      "d5:built-in-agent/tool-rendering",
    ]);
  });

  it("d6 no demo → per-service aggregate", () => {
    expect(expectedKeys("d6", "langgraph-python")).toEqual([
      "d6:langgraph-python",
    ]);
  });

  it("d6 with demo → per-featureType side row (not the aggregate)", () => {
    expect(expectedKeys("d6", "built-in-agent", "tool-rendering")).toEqual([
      "d6:built-in-agent/tool-rendering",
    ]);
  });

  it("with demo → expands one demo into multiple featureTypes when the registry splits it", () => {
    // `beautiful-chat` maps to 5 featureTypes in REGISTRY_TO_D5.
    const keys = expectedKeys("d6", "langgraph-python", "beautiful-chat");
    expect(keys).toContain("d6:langgraph-python/beautiful-chat-toggle-theme");
    expect(keys).toContain("d6:langgraph-python/beautiful-chat-pie-chart");
    expect(keys.length).toBe(5);
  });

  it("throws on unmappable demo so the run cannot hang to timeout", () => {
    expect(() =>
      expectedKeys("d5", "langgraph-python", "no-such-demo"),
    ).toThrow(/does not map to any D5 featureType/);
  });
});

// ---------------------------------------------------------------------------
// dedupeScopes
// ---------------------------------------------------------------------------
describe("dedupeScopes", () => {
  it("collapses repeated bare-slug targets into one scope", () => {
    const targets: TestTarget[] = [
      { slug: "a", level: "d5" },
      { slug: "a", level: "d5" },
    ];
    expect(dedupeScopes(targets)).toEqual([{ slug: "a", demo: undefined }]);
  });

  it("keeps the bare slug AND a per-demo scope for the same slug distinct", () => {
    const targets: TestTarget[] = [
      { slug: "built-in-agent", level: "d6" },
      { slug: "built-in-agent", demo: "tool-rendering", level: "d6" },
    ];
    const scopes = dedupeScopes(targets);
    expect(scopes).toEqual([
      { slug: "built-in-agent", demo: undefined },
      { slug: "built-in-agent", demo: "tool-rendering" },
    ]);
  });

  it("collapses repeated identical (slug, demo) pairs", () => {
    const targets: TestTarget[] = [
      { slug: "x", demo: "d", level: "d6" },
      { slug: "x", demo: "d", level: "d6" },
    ];
    expect(dedupeScopes(targets)).toEqual([{ slug: "x", demo: "d" }]);
  });
});

// ---------------------------------------------------------------------------
// runViaControlPlane — error surfacing
// ---------------------------------------------------------------------------
describe("runViaControlPlane error surfacing", () => {
  it("0 enqueued → throws with the per-demo scope label, not the bare slug", async () => {
    tickResultRef.current = { ...tickResultRef.current, enqueued: 0 };
    const targets: TestTarget[] = [
      { slug: "built-in-agent", demo: "tool-rendering", level: "d5" },
    ];
    await expect(
      runViaControlPlane(
        targets,
        { level: "d5", timeoutMs: 1, pollIntervalMs: 1 },
        STUB_CONFIG,
        SILENT_LOGGER,
      ),
    ).rejects.toThrow(/built-in-agent:tool-rendering/);
  });

  it("0 enqueued with empty targets → guards the double-space gap (uses placeholder label)", async () => {
    tickResultRef.current = { ...tickResultRef.current, enqueued: 0 };
    await expect(
      runViaControlPlane(
        [],
        { level: "d5", timeoutMs: 1, pollIntervalMs: 1 },
        STUB_CONFIG,
        SILENT_LOGGER,
      ),
    ).rejects.toThrow(/\(no targets\)/);
  });

  it("partial enqueue failure → aborts before poll (does not silently proceed)", async () => {
    tickResultRef.current = {
      ...tickResultRef.current,
      enqueued: 1,
      enqueueFailures: 2,
    };
    const targets: TestTarget[] = [{ slug: "a", level: "d5" }];
    await expect(
      runViaControlPlane(
        targets,
        { level: "d5", timeoutMs: 1, pollIntervalMs: 1 },
        STUB_CONFIG,
        SILENT_LOGGER,
      ),
    ).rejects.toThrow(/2 failure\(s\)/);
  });
});

// ---------------------------------------------------------------------------
// RESULT CORRELATION — the false-GREEN guard.
//
// The control-plane container runs its own cron producer over the same
// LOCAL_SERVICES_JSON roster, so a FOREIGN job for the same probeKey
// (`d6:<slug>`) lands on the same dashboard `status` row as the CLI's job. The
// CLI used to wait only on that row, freshness-filtered by
// `updated >= <tick time>`. Observed consequence: an invocation exited 0 with
// "1 passed" in 9.9 SECONDS off a foreign row while its own 41-cell job had
// only just been claimed, and finished RED five minutes later.
//
// Every test below is built so a regression back to key-only polling FAILS: a
// fresh, GREEN, FOREIGN `status` row for the expected key is always present and
// always readable, and the CLI must ignore it in favour of its own job.
// ---------------------------------------------------------------------------
describe("runViaControlPlane — result correlation with THIS run's jobs", () => {
  const OUR_RUN_ID = "frun_ours_abcdef_1";
  const PB = "http://localhost:8090";

  interface FakePbOptions {
    /** Polls of `probe_jobs` before our job reports terminal + processed. */
    pollsBeforeTerminal: number;
    /** The `aggregateState` our OWN job reports. */
    ownState: string;
    /** `run_id` the fake's row is stamped with (defaults to OUR_RUN_ID). */
    stampedRunId?: string;
  }

  /**
   * Stub `fetch` with a PocketBase good enough for the read-back path:
   * superuser auth, a `probe_jobs` list that only answers when the filter
   * carries the stamped run id, and a `status` list that ALWAYS serves a fresh
   * green FOREIGN row for the key the CLI waits on.
   */
  function installFakePb(opts: FakePbOptions) {
    const calls: string[] = [];
    let jobPolls = 0;
    const stampedRunId = opts.stampedRunId ?? OUR_RUN_ID;
    const fake = vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("auth-with-password")) {
        return {
          ok: true,
          json: async () => ({ token: "tok" }),
        } as unknown as Response;
      }
      if (url.includes("/api/collections/probe_jobs/records")) {
        jobPolls += 1;
        // Only rows stamped with the run_id in the filter are visible — this
        // IS the correlation the fix relies on.
        if (!url.includes(encodeURIComponent(stampedRunId))) {
          return {
            ok: true,
            json: async () => ({ items: [] }),
          } as unknown as Response;
        }
        const terminal = jobPolls > opts.pollsBeforeTerminal;
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: "job-1",
                probe_key: "d6:mastra",
                status: terminal ? "done" : "running",
                result_processed: terminal,
                result: terminal
                  ? {
                      jobId: "job-1",
                      probeKey: "d6:mastra",
                      runId: stampedRunId,
                      aggregateKey: "d6:mastra",
                      aggregateState: opts.ownState,
                      cells: [
                        {
                          cellId: "headless-simple",
                          cellKey: "d6:mastra/headless-simple",
                          state: opts.ownState,
                          signal: null,
                          observedAt: new Date().toISOString(),
                        },
                      ],
                    }
                  : undefined,
              },
            ],
          }),
        } as unknown as Response;
      }
      if (url.includes("/api/collections/status/records")) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                key: "d6:mastra",
                state: "green",
                updated: new Date().toISOString(),
              },
            ],
          }),
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });
    vi.stubGlobal("fetch", fake);
    return {
      get jobPolls() {
        return jobPolls;
      },
      get statusReads() {
        return calls.filter((c) =>
          c.includes("/api/collections/status/records"),
        ).length;
      },
    };
  }

  const pbConfig = (): LocalConfig => ({
    ...STUB_CONFIG,
    pocketbase: { ...STUB_CONFIG.pocketbase, url: PB },
  });

  beforeEach(() => {
    tickResultRef.current = { ...tickResultRef.current, runId: OUR_RUN_ID };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports OUR job's RED verdict even though a fresh GREEN foreign status row exists for the same key", async () => {
    const pb = installFakePb({ pollsBeforeTerminal: 0, ownState: "red" });
    const results = await runViaControlPlane(
      [{ slug: "mastra", level: "d6" }],
      { level: "d6", timeoutMs: 5_000, pollIntervalMs: 1 },
      pbConfig(),
      SILENT_LOGGER,
    );
    expect(results).toEqual([
      { key: "d6:mastra", state: "red", durationMs: 0, error: "state=red" },
    ]);
    // The verdict came from our OWN job — the shared status row was never
    // consulted at all. Key-only polling read "green" here.
    expect(pb.statusReads).toBe(0);
  });

  it("does NOT return while its own job is still running, however fresh the foreign green row is", async () => {
    const pb = installFakePb({ pollsBeforeTerminal: 4, ownState: "red" });
    const results = await runViaControlPlane(
      [{ slug: "mastra", level: "d6" }],
      { level: "d6", timeoutMs: 5_000, pollIntervalMs: 1 },
      pbConfig(),
      SILENT_LOGGER,
    );
    // It waited on its OWN job across 5 polls instead of exiting on the
    // foreign row, which was green and fresh from the very first read.
    expect(pb.jobPolls).toBeGreaterThan(4);
    expect(results[0]!.state).toBe("red");
  });

  it("passes GREEN through when OUR OWN job is the one that reported green", async () => {
    installFakePb({ pollsBeforeTerminal: 1, ownState: "green" });
    const results = await runViaControlPlane(
      [{ slug: "mastra", level: "d6" }],
      { level: "d6", timeoutMs: 5_000, pollIntervalMs: 1 },
      pbConfig(),
      SILENT_LOGGER,
    );
    expect(results).toEqual([
      { key: "d6:mastra", state: "green", durationMs: 0, error: undefined },
    ]);
  });

  it("times out naming OUR outstanding job rather than falling back to the key-only read", async () => {
    // Our job never goes terminal. The foreign green row is present and fresh
    // the whole time; the run must still FAIL, not report it as a pass.
    installFakePb({
      pollsBeforeTerminal: Number.MAX_SAFE_INTEGER,
      ownState: "green",
    });
    await expect(
      runViaControlPlane(
        [{ slug: "mastra", level: "d6" }],
        { level: "d6", timeoutMs: 20, pollIntervalMs: 1 },
        pbConfig(),
        SILENT_LOGGER,
      ),
    ).rejects.toThrow(/its OWN 1 job\(s\)/);
  });

  it("refuses to poll at all when the tick minted no runId (nothing to correlate on)", async () => {
    installFakePb({ pollsBeforeTerminal: 0, ownState: "green" });
    tickResultRef.current = { ...tickResultRef.current, runId: "" };
    await expect(
      runViaControlPlane(
        [{ slug: "mastra", level: "d6" }],
        { level: "d6", timeoutMs: 5_000, pollIntervalMs: 1 },
        pbConfig(),
        SILENT_LOGGER,
      ),
    ).rejects.toThrow(/empty runId/);
  });

  it("a foreign job row (different run_id) is invisible to the gate", async () => {
    // The fake serves its row only when the filter carries `stampedRunId`, so
    // stamping a DIFFERENT run id models a foreign producer's job: our filter
    // matches nothing, and the run must time out rather than adopt it.
    installFakePb({
      pollsBeforeTerminal: 0,
      ownState: "green",
      stampedRunId: "frun_someone_else_1",
    });
    await expect(
      runViaControlPlane(
        [{ slug: "mastra", level: "d6" }],
        { level: "d6", timeoutMs: 20, pollIntervalMs: 1 },
        pbConfig(),
        SILENT_LOGGER,
      ),
    ).rejects.toThrow(/saw 0 row\(s\)/);
  });
});

// ---------------------------------------------------------------------------
// verdictsFromOwnJobs — projecting a job's OWN result onto status keys
// ---------------------------------------------------------------------------
describe("verdictsFromOwnJobs", () => {
  it("projects aggregateKey and every cellKey", () => {
    const m = verdictsFromOwnJobs([
      {
        id: "j1",
        probe_key: "d6:mastra",
        status: "done",
        result: {
          aggregateKey: "d6:mastra",
          aggregateState: "red",
          cells: [
            { cellKey: "d6:mastra/headless-simple", state: "green" },
            { cellKey: "d6:mastra/hitl", state: "red" },
          ],
        },
      },
    ]);
    expect(m.get("d6:mastra")).toBe("red");
    expect(m.get("d6:mastra/headless-simple")).toBe("green");
    expect(m.get("d6:mastra/hitl")).toBe("red");
  });

  it("accepts a JSON-STRING result column", () => {
    const m = verdictsFromOwnJobs([
      {
        id: "j1",
        probe_key: "d6:x",
        status: "done",
        result: JSON.stringify({
          aggregateKey: "d6:x",
          aggregateState: "green",
          cells: [],
        }),
      },
    ]);
    expect(m.get("d6:x")).toBe("green");
  });

  it("contributes nothing for a missing / unparseable / blank-key result", () => {
    expect(
      verdictsFromOwnJobs([
        { id: "j1", probe_key: "d6:x", status: "done" },
        { id: "j2", probe_key: "d6:y", status: "done", result: "not-json" },
        { id: "j3", probe_key: "d6:z", status: "done", result: null },
        {
          id: "j4",
          probe_key: "d6:w",
          status: "done",
          result: { aggregateKey: "   ", aggregateState: "green" },
        },
      ]).size,
    ).toBe(0);
  });
});
