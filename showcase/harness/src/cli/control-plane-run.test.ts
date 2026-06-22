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
        publicUrl: "http://langgraph-python:10000",
        demos: ["agentic-chat"],
        notSupportedFeatures: [],
      },
    ]);
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
