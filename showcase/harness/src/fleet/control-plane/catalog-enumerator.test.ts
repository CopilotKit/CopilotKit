import { describe, it, expect } from "vitest";
import {
  createD6ServiceEnumerator,
  createE2eSmokeServiceEnumerator,
  createE2eDemosServiceEnumerator,
  createE2eDeepServiceEnumerator,
  createServiceEnumerator,
  D6_DRIVER_KIND,
  D6_DISCOVERY_FILTER,
  E2E_DEMOS_TIMEOUT_MS,
  D6_E2E_TIMEOUT_MS,
  D5_E2E_TIMEOUT_MS,
  ENUMERATE_RETRY_BACKOFF_MS,
  isRetryableEnumerateError,
} from "./catalog-enumerator.js";
import {
  E2E_SMOKE_DRIVER_KIND,
  E2E_DEMOS_DRIVER_KIND,
} from "../worker/payload-mapper.js";
import {
  DiscoverySourceAuthError,
  DiscoverySourceBackendError,
  DiscoverySourceTransportError,
  DiscoverySourceSchemaError,
} from "../../probes/discovery/errors.js";
import type { DiscoverySource } from "../../probes/types.js";
import type { RailwayServiceInfo } from "../../probes/discovery/railway-services.js";
import type { EnumerateContext } from "./job-producer.js";
import type { Logger } from "../../types/index.js";
import { e2eFullDriver } from "../../probes/drivers/d6-all-pills.js";

/**
 * Pins the real catalog enumerator (S10): it yields ONE ServiceJobSpec per
 * discovered showcase service, preserving the EXACT d6 keys the dashboard reads
 * — `probeKey = d6:<slug>`, `driverKind = e2e_d6`, and a `driverInputs` object
 * the worker re-hydrates into the d6 driver input. The discovery source is an
 * injected fake (no Railway, no network).
 */

const SILENT_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function svc(over: Partial<RailwayServiceInfo> = {}): RailwayServiceInfo {
  return {
    name: "showcase-langgraph-python",
    imageRef: "ghcr.io/org/showcase-langgraph-python:latest",
    publicUrl: "http://langgraph-python:10000",
    env: {},
    shape: "package",
    deployedDigest: "",
    demos: ["agentic_chat", "shared_state"],
    notSupportedFeatures: [],
    deployedAt: "",
    ...over,
  };
}

function fakeSource(
  services: RailwayServiceInfo[],
): DiscoverySource<RailwayServiceInfo> & {
  configs: unknown[];
} {
  const configs: unknown[] = [];
  return {
    name: "railway-services",
    configs,
    async enumerate(_ctx, config): Promise<RailwayServiceInfo[]> {
      configs.push(config);
      return services;
    },
  } as DiscoverySource<RailwayServiceInfo> & { configs: unknown[] };
}

const CTX: EnumerateContext = { triggered: false, runId: "run-1" };

describe("createD6ServiceEnumerator", () => {
  it("yields one spec per service with the exact d6 keys (probeKey d6:<slug>, kind e2e_d6)", async () => {
    const source = fakeSource([
      svc({ name: "showcase-langgraph-python" }),
      svc({ name: "showcase-crewai", publicUrl: "http://crewai:10000" }),
    ]);
    const enumerate = createD6ServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });

    const specs = await enumerate(CTX);

    expect(specs).toHaveLength(2);
    const lg = specs.find((s) => s.serviceSlug === "langgraph-python");
    expect(lg).toBeDefined();
    expect(lg?.probeKey).toBe("d6:langgraph-python");
    expect(lg?.driverKind).toBe(D6_DRIVER_KIND);
    expect(lg?.driverInputs?.key).toBe("d6:langgraph-python");
    expect(lg?.driverInputs?.backendUrl).toBe("http://langgraph-python:10000");
    expect(lg?.driverInputs?.demos).toEqual(["agentic_chat", "shared_state"]);
    expect(lg?.driverInputs?.shape).toBe("package");

    const cr = specs.find((s) => s.serviceSlug === "crewai");
    expect(cr?.probeKey).toBe("d6:crewai");
  });

  it("passes the d6 discovery filter (namePrefix + nameExcludes) to the source", async () => {
    const source = fakeSource([svc()]);
    const enumerate = createD6ServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });

    await enumerate(CTX);

    expect(source.configs).toHaveLength(1);
    const cfg = source.configs[0] as {
      namePrefix?: string;
      nameExcludes?: string[];
    };
    expect(cfg.namePrefix).toBe(D6_DISCOVERY_FILTER.namePrefix);
    expect(cfg.nameExcludes).toEqual([...D6_DISCOVERY_FILTER.nameExcludes]);
  });

  it("carries deployedAt only when the service has one (deploy-churn grace)", async () => {
    const source = fakeSource([
      svc({ name: "showcase-fresh", deployedAt: "2026-06-04T00:00:00.000Z" }),
      svc({ name: "showcase-stable", deployedAt: "" }),
    ]);
    const enumerate = createD6ServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });

    const specs = await enumerate(CTX);
    const fresh = specs.find((s) => s.serviceSlug === "fresh");
    const stable = specs.find((s) => s.serviceSlug === "stable");
    expect(fresh?.driverInputs?.deployedAt).toBe("2026-06-04T00:00:00.000Z");
    expect(stable?.driverInputs?.deployedAt).toBeUndefined();
  });

  it("scopes to the operator slug filter on a triggered run (empty when none match)", async () => {
    const source = fakeSource([
      svc({ name: "showcase-langgraph-python" }),
      svc({ name: "showcase-crewai" }),
    ]);
    const enumerate = createD6ServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });

    const scoped = await enumerate({
      triggered: true,
      runId: "run-2",
      filter: { slugs: ["crewai"] },
    });
    expect(scoped.map((s) => s.serviceSlug)).toEqual(["crewai"]);

    const none = await enumerate({
      triggered: true,
      runId: "run-3",
      filter: { slugs: ["does-not-exist"] },
    });
    expect(none).toEqual([]);
  });

  it("emits driverInputs that validate against the REAL d6 inputSchema and carry no fields the schema does not list", async () => {
    // The worker re-hydrates driverInputs THROUGH the d6 driver's own zod
    // inputSchema (the validation gate). Parse the emitted input through the
    // real schema — the strongest guard that the enumerator's output matches
    // the driver's contract. We also assert the enumerator does not emit a
    // redundant `publicUrl` field: `backendUrl` already carries the live URL
    // and the driver reads `backendUrl ?? publicUrl`, so the extra key is
    // dead weight that drifts the emitted shape from the documented contract.
    const source = fakeSource([
      svc({
        name: "showcase-langgraph-python",
        publicUrl: "http://langgraph-python:10000",
        deployedAt: "2026-06-04T00:00:00.000Z",
      }),
    ]);
    const enumerate = createD6ServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });

    const specs = await enumerate(CTX);
    const lg = specs.find((s) => s.serviceSlug === "langgraph-python");
    expect(lg).toBeDefined();

    // Parses cleanly through the real d6 inputSchema — the worker's gate.
    const parsed = e2eFullDriver.inputSchema.safeParse(lg!.driverInputs);
    expect(parsed.success).toBe(true);

    // No redundant `publicUrl` key — backendUrl carries the value.
    expect(lg!.driverInputs).not.toHaveProperty("publicUrl");
    expect(lg!.driverInputs?.backendUrl).toBe("http://langgraph-python:10000");
    // d6 conveys its YAML outer-cap in `timeout_ms` (so the fleet worker honors
    // the d6-all-pills-e2e.yml budget); the conveyed cap parses through the
    // driver's own schema (the worker's gate).
    expect(lg!.driverInputs?.timeout_ms).toBe(D6_E2E_TIMEOUT_MS);
  });

  it("conveys the d6 YAML outer-cap in driverInputs.timeout_ms (default = d6-all-pills-e2e.yml value)", async () => {
    // R-TIMEOUT (Fix B): the d6 enumerator conveys the 20-min outer cap per-job
    // so the fleet worker's pooled d6 driver reads it from the payload — the
    // worker never runs the in-process probe-invoker that applies cfg.timeout_ms.
    // Without it the driver falls back to DEFAULT_TIMEOUT_MS (10 min) and a slow
    // backend false-aborts.
    const source = fakeSource([
      svc({ name: "showcase-langgraph-python" }),
      svc({ name: "showcase-crewai", publicUrl: "http://crewai:10000" }),
    ]);
    const enumerate = createD6ServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });
    const specs = await enumerate(CTX);
    expect(D6_E2E_TIMEOUT_MS).toBe(1_200_000);
    for (const s of specs) {
      expect(s.driverInputs?.timeout_ms).toBe(D6_E2E_TIMEOUT_MS);
      // The conveyed cap survives the driver's own schema (the worker's gate).
      const parsed = e2eFullDriver.inputSchema.safeParse(s.driverInputs);
      expect(parsed.success).toBe(true);
    }
  });

  it("honors an explicit timeoutMs override on the conveyed d6 timeout_ms", async () => {
    const source = fakeSource([svc({ name: "showcase-langgraph-python" })]);
    const enumerate = createD6ServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
      timeoutMs: 777_000,
    });
    const specs = await enumerate(CTX);
    expect(specs[0]?.driverInputs?.timeout_ms).toBe(777_000);
  });

  it("produces a NON-EMPTY spec set for the real-shaped service catalog", async () => {
    // The producer's tick enqueues one job per spec; a non-empty enumerator is
    // what flips runControlPlane off the empty-run warning.
    const source = fakeSource([
      svc({ name: "showcase-langgraph-python" }),
      svc({ name: "showcase-crewai" }),
      svc({ name: "showcase-mastra" }),
    ]);
    const enumerate = createD6ServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });
    const specs = await enumerate(CTX);
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.length).toBe(3);
  });
});

describe("createServiceEnumerator (generic seam)", () => {
  it("stamps the passed driverKind and probeKey prefix (non-d6 params)", async () => {
    const source = fakeSource([
      svc({ name: "showcase-langgraph-python" }),
      svc({ name: "showcase-crewai", publicUrl: "http://crewai:10000" }),
    ]);
    const enumerate = createServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
      driverKind: "e2e_smoke",
      probeKeyPrefix: "smoke",
      filter: { namePrefix: "showcase-" },
    });

    const specs = await enumerate(CTX);

    expect(specs).toHaveLength(2);
    const lg = specs.find((s) => s.serviceSlug === "langgraph-python");
    expect(lg).toBeDefined();
    expect(lg?.driverKind).toBe("e2e_smoke");
    expect(lg?.probeKey).toBe("smoke:langgraph-python");
    expect(lg?.driverInputs?.key).toBe("smoke:langgraph-python");
    expect(lg?.driverInputs?.backendUrl).toBe("http://langgraph-python:10000");

    const cr = specs.find((s) => s.serviceSlug === "crewai");
    expect(cr?.probeKey).toBe("smoke:crewai");
    expect(cr?.driverKind).toBe("e2e_smoke");
  });

  it("passes the param-supplied filter (namePrefix + nameExcludes) to the source", async () => {
    const source = fakeSource([svc()]);
    const filter = {
      namePrefix: "showcase-",
      nameExcludes: ["showcase-harness", "showcase-shell"],
    } as const;
    const enumerate = createServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
      driverKind: "e2e_smoke",
      probeKeyPrefix: "smoke",
      filter,
    });

    await enumerate(CTX);

    expect(source.configs).toHaveLength(1);
    const cfg = source.configs[0] as {
      namePrefix?: string;
      nameExcludes?: string[];
    };
    expect(cfg.namePrefix).toBe("showcase-");
    expect(cfg.nameExcludes).toEqual([...filter.nameExcludes]);
  });

  it("accepts a function probeKey prefix builder", async () => {
    const source = fakeSource([svc({ name: "showcase-langgraph-python" })]);
    const enumerate = createServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
      driverKind: "e2e_deep",
      probeKeyPrefix: (slug) => `deep-${slug}`,
      filter: { namePrefix: "showcase-" },
    });

    const specs = await enumerate(CTX);
    const lg = specs.find((s) => s.serviceSlug === "langgraph-python");
    expect(lg?.probeKey).toBe("deep-langgraph-python");
    expect(lg?.driverInputs?.key).toBe("deep-langgraph-python");
  });

  // A5: a filter without a namePrefix would make the discovery source enumerate
  // ALL services (a documented incident class). Fail loud at construction.
  it("throws when the filter has no namePrefix (fail loud, never enumerate all)", () => {
    const source = fakeSource([svc()]);
    expect(() =>
      createServiceEnumerator({
        source,
        env: {},
        fetchImpl: globalThis.fetch,
        logger: SILENT_LOGGER,
        driverKind: "e2e_smoke",
        probeKeyPrefix: "smoke",
        filter: { nameExcludes: ["showcase-harness"] },
      }),
    ).toThrow(/namePrefix/);
  });

  it("throws when the filter namePrefix is an empty string", () => {
    const source = fakeSource([svc()]);
    expect(() =>
      createServiceEnumerator({
        source,
        env: {},
        fetchImpl: globalThis.fetch,
        logger: SILENT_LOGGER,
        driverKind: "e2e_smoke",
        probeKeyPrefix: "smoke",
        filter: { namePrefix: "" },
      }),
    ).toThrow(/namePrefix/);
  });

  // A6: a function-form probeKeyPrefix returning "" yields an empty
  // probeKey/driverInputs.key (a bad join key) — fail loud naming the slug.
  it("throws when a function probeKeyPrefix yields an empty key for a service", async () => {
    const source = fakeSource([svc({ name: "showcase-langgraph-python" })]);
    const enumerate = createServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
      driverKind: "e2e_deep",
      probeKeyPrefix: () => "",
      filter: { namePrefix: "showcase-" },
    });

    await expect(enumerate(CTX)).rejects.toThrow(/langgraph-python/);
  });
});

describe("createE2eSmokeServiceEnumerator", () => {
  it("stamps the e2e_smoke kind + d4:<slug> probeKey and carries driver inputs", async () => {
    const source = fakeSource([
      svc({ name: "showcase-langgraph-python" }),
      svc({ name: "showcase-crewai", publicUrl: "http://crewai:10000" }),
    ]);
    const enumerate = createE2eSmokeServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });

    const specs = await enumerate(CTX);

    expect(specs).toHaveLength(2);
    const lg = specs.find((s) => s.serviceSlug === "langgraph-python");
    expect(lg?.driverKind).toBe(E2E_SMOKE_DRIVER_KIND);
    expect(lg?.probeKey).toBe("d4:langgraph-python");
    expect(lg?.driverInputs?.key).toBe("d4:langgraph-python");
    expect(lg?.driverInputs?.name).toBe("showcase-langgraph-python");
    expect(lg?.driverInputs?.backendUrl).toBe("http://langgraph-python:10000");
    expect(lg?.driverInputs?.demos).toEqual(["agentic_chat", "shared_state"]);
    expect(lg?.driverInputs?.notSupportedFeatures).toEqual([]);
    // Smoke conveys no outer-cap timeout.
    expect(lg?.driverInputs).not.toHaveProperty("timeout_ms");

    const cr = specs.find((s) => s.serviceSlug === "crewai");
    expect(cr?.probeKey).toBe("d4:crewai");
  });

  it("passes the shared d6 discovery filter to the source", async () => {
    const source = fakeSource([svc()]);
    const enumerate = createE2eSmokeServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });
    await enumerate(CTX);
    const cfg = source.configs[0] as {
      namePrefix?: string;
      nameExcludes?: string[];
    };
    expect(cfg.namePrefix).toBe(D6_DISCOVERY_FILTER.namePrefix);
    expect(cfg.nameExcludes).toEqual([...D6_DISCOVERY_FILTER.nameExcludes]);
  });
});

describe("createE2eDeepServiceEnumerator", () => {
  // D5 is now "D6 take-one": the enumerator stamps the `e2e_d6` driver kind
  // (NOT a separate `e2e_deep` kind) and conveys `representativeOnly: true` +
  // `rowPrefix: "d5"` so the shared D6 driver runs one representative pill and
  // emits the `d5:` dashboard prefix. The probeKey prefix stays
  // `d5-single-pill-e2e:<slug>` (the claim/dashboard join key).
  it("stamps the e2e_d6 kind + d5-single-pill-e2e:<slug> probeKey + D5-scoping inputs", async () => {
    const source = fakeSource([
      svc({ name: "showcase-langgraph-python" }),
      svc({ name: "showcase-crewai", publicUrl: "http://crewai:10000" }),
    ]);
    const enumerate = createE2eDeepServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });

    const specs = await enumerate(CTX);

    expect(specs).toHaveLength(2);
    const lg = specs.find((s) => s.serviceSlug === "langgraph-python");
    expect(lg?.driverKind).toBe(D6_DRIVER_KIND);
    expect(lg?.probeKey).toBe("d5-single-pill-e2e:langgraph-python");
    expect(lg?.driverInputs?.key).toBe("d5-single-pill-e2e:langgraph-python");
    expect(lg?.driverInputs?.name).toBe("showcase-langgraph-python");
    expect(lg?.driverInputs?.backendUrl).toBe("http://langgraph-python:10000");
    expect(lg?.driverInputs?.demos).toEqual(["agentic_chat", "shared_state"]);
    expect(lg?.driverInputs?.notSupportedFeatures).toEqual([]);
    // D5-take-one scoping inputs conveyed onto every spec.
    expect(lg?.driverInputs?.representativeOnly).toBe(true);
    expect(lg?.driverInputs?.rowPrefix).toBe("d5");
    // D5 also conveys its YAML outer-cap (e2e-deep.yml, 10 min) so the fleet
    // worker's shared d6 driver honors the budget.
    expect(lg?.driverInputs?.timeout_ms).toBe(D5_E2E_TIMEOUT_MS);

    const cr = specs.find((s) => s.serviceSlug === "crewai");
    expect(cr?.probeKey).toBe("d5-single-pill-e2e:crewai");
    expect(cr?.driverKind).toBe(D6_DRIVER_KIND);
    expect(cr?.driverInputs?.representativeOnly).toBe(true);
    expect(cr?.driverInputs?.rowPrefix).toBe("d5");
  });

  it("conveys the d5 YAML outer-cap in driverInputs.timeout_ms (default = e2e-deep.yml value)", async () => {
    // R-TIMEOUT (Fix B): D5 runs the shared d6 driver scoped take-one, so it
    // conveys its own (10-min) YAML cap per-job alongside the scoping inputs.
    const source = fakeSource([
      svc({ name: "showcase-langgraph-python" }),
      svc({ name: "showcase-crewai", publicUrl: "http://crewai:10000" }),
    ]);
    const enumerate = createE2eDeepServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });
    const specs = await enumerate(CTX);
    expect(D5_E2E_TIMEOUT_MS).toBe(600_000);
    for (const s of specs) {
      expect(s.driverInputs?.timeout_ms).toBe(D5_E2E_TIMEOUT_MS);
      const parsed = e2eFullDriver.inputSchema.safeParse(s.driverInputs);
      expect(parsed.success).toBe(true);
    }
  });

  it("honors an explicit timeoutMs override on the conveyed d5 timeout_ms", async () => {
    const source = fakeSource([svc({ name: "showcase-langgraph-python" })]);
    const enumerate = createE2eDeepServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
      timeoutMs: 333_000,
    });
    const specs = await enumerate(CTX);
    expect(specs[0]?.driverInputs?.timeout_ms).toBe(333_000);
  });

  it("passes the shared d6 discovery filter to the source", async () => {
    const source = fakeSource([svc()]);
    const enumerate = createE2eDeepServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });
    await enumerate(CTX);
    const cfg = source.configs[0] as {
      namePrefix?: string;
      nameExcludes?: string[];
    };
    expect(cfg.namePrefix).toBe(D6_DISCOVERY_FILTER.namePrefix);
    expect(cfg.nameExcludes).toEqual([...D6_DISCOVERY_FILTER.nameExcludes]);
  });
});

describe("createE2eDemosServiceEnumerator", () => {
  it("stamps the e2e_demos kind + e2e-demos:<slug> probeKey and conveys the YAML timeout_ms", async () => {
    const source = fakeSource([
      svc({ name: "showcase-langgraph-python" }),
      svc({ name: "showcase-crewai", publicUrl: "http://crewai:10000" }),
    ]);
    const enumerate = createE2eDemosServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });

    const specs = await enumerate(CTX);

    expect(specs).toHaveLength(2);
    const lg = specs.find((s) => s.serviceSlug === "langgraph-python");
    expect(lg?.driverKind).toBe(E2E_DEMOS_DRIVER_KIND);
    expect(lg?.probeKey).toBe("e2e-demos:langgraph-python");
    expect(lg?.driverInputs?.key).toBe("e2e-demos:langgraph-python");
    expect(lg?.driverInputs?.name).toBe("showcase-langgraph-python");
    expect(lg?.driverInputs?.backendUrl).toBe("http://langgraph-python:10000");
    expect(lg?.driverInputs?.demos).toEqual(["agentic_chat", "shared_state"]);
    // R-TIMEOUT: the demos family conveys the 20-min outer cap per-job so the
    // fleet worker's pooled demos driver reads it from the payload (it never
    // sees the legacy E2E_DEMOS_TIMEOUT_MS env). Default = YAML value.
    expect(lg?.driverInputs?.timeout_ms).toBe(E2E_DEMOS_TIMEOUT_MS);
    expect(E2E_DEMOS_TIMEOUT_MS).toBe(1_200_000);

    const cr = specs.find((s) => s.serviceSlug === "crewai");
    expect(cr?.probeKey).toBe("e2e-demos:crewai");
    expect(cr?.driverInputs?.timeout_ms).toBe(E2E_DEMOS_TIMEOUT_MS);
  });

  it("honors an explicit timeoutMs override on the conveyed timeout_ms", async () => {
    const source = fakeSource([svc({ name: "showcase-langgraph-python" })]);
    const enumerate = createE2eDemosServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
      timeoutMs: 999_000,
    });

    const specs = await enumerate(CTX);
    const lg = specs.find((s) => s.serviceSlug === "langgraph-python");
    expect(lg?.driverInputs?.timeout_ms).toBe(999_000);
  });

  it("passes the shared d6 discovery filter to the source", async () => {
    const source = fakeSource([svc()]);
    const enumerate = createE2eDemosServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
    });
    await enumerate(CTX);
    const cfg = source.configs[0] as {
      namePrefix?: string;
      nameExcludes?: string[];
    };
    expect(cfg.namePrefix).toBe(D6_DISCOVERY_FILTER.namePrefix);
    expect(cfg.nameExcludes).toEqual([...D6_DISCOVERY_FILTER.nameExcludes]);
  });
});

/**
 * RED-GREEN gates for the Railway-GQL resilience policy (Changes 1 + 2 of the
 * 2026-06-17 Cloudflare-WAF-burst incident fix):
 *   - the enumerator retries transient `DiscoverySourceBackendError(429)` /
 *     `>=500` / Cloudflare-1015|1020|1022-marked responses and
 *     `DiscoverySourceTransportError` on the `ENUMERATE_RETRY_BACKOFF_MS`
 *     schedule (1s/4s/16s in production, collapsed to instant here),
 *   - it falls back to the last successful catalog from an in-memory cache
 *     when every retry is exhausted (LOUDLY logged — never silent),
 *   - it preserves the current hard-fail behavior on a fresh boot with no
 *     cache,
 *   - it does NOT retry on real config errors (`DiscoverySourceAuthError`,
 *     non-429 4xx, schema rot).
 *
 * The discovery source is an injected fake whose `enumerate` is scripted per
 * call. No network, no fake timers — `sleep` is stubbed to instant.
 */
const INSTANT_SLEEP_RES = async () => {};

function scriptedSource(
  script: Array<RailwayServiceInfo[] | (() => never)>,
): DiscoverySource<RailwayServiceInfo> & { calls: number } {
  let i = 0;
  const wrapper = {
    name: "railway-services",
    calls: 0,
    async enumerate(_ctx: unknown, _config: unknown) {
      wrapper.calls += 1;
      const step = script[Math.min(i, script.length - 1)];
      i += 1;
      if (typeof step === "function") {
        step();
        throw new Error("scriptedSource: function form must throw");
      }
      return step;
    },
  } as DiscoverySource<RailwayServiceInfo> & { calls: number };
  return wrapper;
}

function makeCapturingLogger(): {
  logger: Logger;
  warns: Array<{ msg: string; meta: Record<string, unknown> }>;
} {
  const warns: Array<{ msg: string; meta: Record<string, unknown> }> = [];
  return {
    logger: {
      info: () => {},
      debug: () => {},
      error: () => {},
      warn: (msg, meta) =>
        warns.push({ msg, meta: (meta ?? {}) as Record<string, unknown> }),
    },
    warns,
  };
}

describe("createServiceEnumerator — Railway-GQL resilience policy", () => {
  const INSTANT_SLEEP = INSTANT_SLEEP_RES;

  it("isRetryableEnumerateError: 429, 5xx, Cloudflare 1015/1020/1022, transport — retryable; auth + non-429 4xx + schema — not", () => {
    expect(
      isRetryableEnumerateError(
        new DiscoverySourceBackendError(
          "railway-services",
          "rate limited",
          429,
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableEnumerateError(
        new DiscoverySourceBackendError("railway-services", "boom", 502),
      ),
    ).toBe(true);
    expect(
      isRetryableEnumerateError(
        new DiscoverySourceBackendError(
          "railway-services",
          "error code: 1015",
          403,
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableEnumerateError(
        new DiscoverySourceBackendError(
          "railway-services",
          "error code: 1020 (access denied)",
          403,
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableEnumerateError(
        new DiscoverySourceBackendError(
          "railway-services",
          "1022 something",
          403,
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableEnumerateError(
        new DiscoverySourceTransportError(
          "railway-services",
          "fetch failed: ECONNRESET",
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableEnumerateError(
        new DiscoverySourceAuthError("railway-services", "401 unauthorized"),
      ),
    ).toBe(false);
    expect(
      isRetryableEnumerateError(
        new DiscoverySourceBackendError("railway-services", "bad request", 400),
      ),
    ).toBe(false);
    expect(
      isRetryableEnumerateError(
        new DiscoverySourceSchemaError(
          "railway-services",
          "shape rot",
          undefined,
        ),
      ),
    ).toBe(false);
  });

  it("retries 3x on 429 + Cloudflare 1015 body and succeeds on attempt 4 (RED on main: enumerate throws after first 429)", async () => {
    // The cron tick on 2026-06-17 hit a ~25 min Cloudflare WAF burst. Without
    // retries the discovery source threw HTTP 429 / error code 1015 and the
    // producer hard-failed, zeroing out the dashboard. With retries the
    // wrapper rides out three transient 429s and the 4th attempt returns the
    // catalog — the producer enqueues jobs as normal.
    const cf429 = () => {
      throw new DiscoverySourceBackendError(
        "railway-services",
        "railway gql 429: error code: 1015 (rate limited)",
        429,
      );
    };
    const services = [svc({ name: "showcase-langgraph-python" })];
    const source = scriptedSource([cf429, cf429, cf429, services]);
    const { logger, warns } = makeCapturingLogger();

    const enumerate = createServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger,
      driverKind: D6_DRIVER_KIND,
      probeKeyPrefix: "d6",
      filter: D6_DISCOVERY_FILTER,
      sleep: INSTANT_SLEEP,
      retrySchedule: ENUMERATE_RETRY_BACKOFF_MS,
    });

    const specs = await enumerate(CTX);

    // 1 initial + 3 retries = 4 source calls total.
    expect(source.calls).toBe(4);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.probeKey).toBe("d6:langgraph-python");
    const retryWarns = warns.filter(
      (w) => w.msg === "fleet.producer.enumerate-retry",
    );
    expect(retryWarns).toHaveLength(3);
    expect(
      warns.find(
        (w) => w.msg === "fleet.producer.enumerate-failed-using-cache",
      ),
    ).toBeUndefined();
  });

  it("falls back to the cached catalog on persistent 429 burst across ticks (LOUD warn, no zero-job tick)", async () => {
    // First tick: live catalog seeds the cache.
    // Second tick: every retry returns 429 — fallback returns the cached
    // catalog and emits a `fleet.producer.enumerate-failed-using-cache` warn.
    const live = [
      svc({ name: "showcase-langgraph-python" }),
      svc({ name: "showcase-crewai" }),
    ];
    const cf429 = () => {
      throw new DiscoverySourceBackendError(
        "railway-services",
        "railway gql 429: error code: 1015",
        429,
      );
    };
    const source = scriptedSource([live, cf429, cf429, cf429, cf429]);
    const { logger, warns } = makeCapturingLogger();
    let nowMs = 1_700_000_000_000;

    const enumerate = createServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger,
      driverKind: D6_DRIVER_KIND,
      probeKeyPrefix: "d6",
      filter: D6_DISCOVERY_FILTER,
      sleep: INSTANT_SLEEP,
      now: () => nowMs,
      retrySchedule: ENUMERATE_RETRY_BACKOFF_MS,
    });

    const tick1 = await enumerate(CTX);
    expect(tick1).toHaveLength(2);
    expect(source.calls).toBe(1);

    nowMs += 60_000;

    const tick2 = await enumerate(CTX);
    expect(source.calls).toBe(5);
    // Fallback returns the SAME catalog (two services) from the cache —
    // the dashboard does not zero out.
    expect(tick2).toHaveLength(2);
    const fallbackWarn = warns.find(
      (w) => w.msg === "fleet.producer.enumerate-failed-using-cache",
    );
    expect(fallbackWarn).toBeDefined();
    expect(fallbackWarn?.meta.services).toBe(2);
    expect(fallbackWarn?.meta.ageMs).toBe(60_000);
    expect(typeof fallbackWarn?.meta.reason).toBe("string");
  });

  it("re-throws the last transient error on a fresh boot with NO cache (preserves enumerate-failed hard-fail)", async () => {
    const cf429 = () => {
      throw new DiscoverySourceBackendError(
        "railway-services",
        "railway gql 429: error code: 1015",
        429,
      );
    };
    const source = scriptedSource([cf429, cf429, cf429, cf429]);
    const enumerate = createServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
      driverKind: D6_DRIVER_KIND,
      probeKeyPrefix: "d6",
      filter: D6_DISCOVERY_FILTER,
      sleep: INSTANT_SLEEP,
      retrySchedule: ENUMERATE_RETRY_BACKOFF_MS,
    });

    await expect(enumerate(CTX)).rejects.toBeInstanceOf(
      DiscoverySourceBackendError,
    );
    expect(source.calls).toBe(4); // 1 initial + 3 retries before giving up
  });

  it("does NOT retry on DiscoverySourceAuthError — config errors fail loud immediately", async () => {
    const authFail = () => {
      throw new DiscoverySourceAuthError(
        "railway-services",
        "railway gql 401: bad token",
      );
    };
    const source = scriptedSource([authFail, authFail, authFail, authFail]);
    const enumerate = createServiceEnumerator({
      source,
      env: {},
      fetchImpl: globalThis.fetch,
      logger: SILENT_LOGGER,
      driverKind: D6_DRIVER_KIND,
      probeKeyPrefix: "d6",
      filter: D6_DISCOVERY_FILTER,
      sleep: INSTANT_SLEEP,
      retrySchedule: ENUMERATE_RETRY_BACKOFF_MS,
    });
    await expect(enumerate(CTX)).rejects.toBeInstanceOf(
      DiscoverySourceAuthError,
    );
    // Exactly ONE call — no retry was attempted.
    expect(source.calls).toBe(1);
  });

  it("uses ENUMERATE_RETRY_BACKOFF_MS = [1000, 4000, 16000] in production (SSOT pin)", () => {
    expect(ENUMERATE_RETRY_BACKOFF_MS).toEqual([1_000, 4_000, 16_000]);
  });
});
