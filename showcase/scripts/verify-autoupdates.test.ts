import { describe, expect, it } from "vitest";
import {
  checkAutoUpdates,
  expectedPolicyFor,
  isLiveAutoUpdatesEnabled,
  parseEnvironmentConfig,
  runAutoUpdatesGate,
  summarizeAutoUpdatesFailures,
} from "./verify-autoupdates";
import type {
  AutoUpdatesGateEntry,
  EnvironmentConfigJson,
} from "./verify-autoupdates";

// ── Fixtures ────────────────────────────────────────────────────────────
//
// Faithful to the LIVE surface the CI gate reads at runtime: the
// `Environment.config` JSON scalar, keyed `services.<serviceId>.source.
// autoUpdates`, with Railway's ENABLED form `{ type: "minor" }` and the
// DISABLED form being an absent/null autoUpdates block. The tests exercise the
// exact comparison logic main() runs; the only substitution is the fetch
// (fixtures instead of a live GraphQL read).

const ENV_IDS = {
  prod: "prod-env-id",
  staging: "staging-env-id",
} as const;

// A tiny SSOT: two services, both expected "disabled" (the invariant every
// real service satisfies).
const SSOT: Record<string, AutoUpdatesGateEntry> = {
  "showcase-mastra": {
    serviceId: "svc-mastra",
    environments: { prod: {}, staging: {} },
    autoUpdates: "disabled",
  },
  "showcase-ag2": {
    serviceId: "svc-ag2",
    environments: { prod: {}, staging: {} },
    autoUpdates: "disabled",
  },
};

/** All-disabled live config for both envs → the GREEN world. */
function allDisabledConfig(): Record<string, EnvironmentConfigJson> {
  const cfg: EnvironmentConfigJson = {
    services: {
      "svc-mastra": { source: { autoUpdates: null } },
      "svc-ag2": { source: {} },
    },
  };
  return { "prod-env-id": cfg, "staging-env-id": cfg };
}

/** One service with auto-updates ENABLED in prod → the RED world. */
function driftConfig(): Record<string, EnvironmentConfigJson> {
  const stagingCfg: EnvironmentConfigJson = {
    services: {
      "svc-mastra": { source: { autoUpdates: null } },
      "svc-ag2": { source: {} },
    },
  };
  const prodCfg: EnvironmentConfigJson = {
    services: {
      // DRIFT: Railway auto-updates left enabled on this prod service.
      "svc-mastra": { source: { autoUpdates: { type: "minor" } } },
      "svc-ag2": { source: {} },
    },
  };
  return { "prod-env-id": prodCfg, "staging-env-id": stagingCfg };
}

function fetcherFor(byEnvId: Record<string, EnvironmentConfigJson>) {
  return async (envId: string): Promise<EnvironmentConfigJson> => {
    const cfg = byEnvId[envId];
    if (!cfg) throw new Error(`no fixture for env id ${envId}`);
    return cfg;
  };
}

// ── isLiveAutoUpdatesEnabled ──────────────────────────────────────────────

describe("isLiveAutoUpdatesEnabled", () => {
  it("treats absent/null/empty as disabled", () => {
    expect(isLiveAutoUpdatesEnabled(undefined)).toBe(false);
    expect(isLiveAutoUpdatesEnabled(null)).toBe(false);
    expect(isLiveAutoUpdatesEnabled({})).toBe(false);
    expect(isLiveAutoUpdatesEnabled({ type: "" })).toBe(false);
    expect(isLiveAutoUpdatesEnabled({ type: "disabled" })).toBe(false);
  });

  it("treats a non-empty type as enabled", () => {
    expect(isLiveAutoUpdatesEnabled({ type: "minor" })).toBe(true);
    // A future enabled variant must still register as drift.
    expect(isLiveAutoUpdatesEnabled({ type: "all" })).toBe(true);
  });
});

// ── checkAutoUpdates (pure comparison) ────────────────────────────────────

describe("checkAutoUpdates", () => {
  it("passes when disabled is expected and live is disabled", () => {
    expect(
      checkAutoUpdates({
        service: "s",
        env: "prod",
        expected: "disabled",
        liveAutoUpdates: null,
      }),
    ).toBeNull();
  });

  it("flags drift when disabled is expected but live is minor", () => {
    const v = checkAutoUpdates({
      service: "s",
      env: "prod",
      expected: "disabled",
      liveAutoUpdates: { type: "minor" },
    });
    expect(v).not.toBeNull();
    expect(v!.liveType).toBe("minor");
    expect(v!.reason).toMatch(/ENABLED/);
  });

  it("flags drift when minor is expected but live is disabled", () => {
    const v = checkAutoUpdates({
      service: "s",
      env: "staging",
      expected: "minor",
      liveAutoUpdates: null,
    });
    expect(v).not.toBeNull();
    expect(v!.liveType).toBeNull();
  });
});

describe("expectedPolicyFor", () => {
  it("reads the SSOT field", () => {
    expect(
      expectedPolicyFor({
        serviceId: "x",
        environments: {},
        autoUpdates: "minor",
      }),
    ).toBe("minor");
  });

  it("defaults to disabled when the SSOT field is absent", () => {
    expect(expectedPolicyFor({ serviceId: "x", environments: {} })).toBe(
      "disabled",
    );
  });
});

// ── runAutoUpdatesGate — RED / GREEN ──────────────────────────────────────

describe("runAutoUpdatesGate — red/green", () => {
  it("RED: reports drift and would exit non-zero when a live service is minor", async () => {
    const result = await runAutoUpdatesGate({
      services: SSOT,
      envIds: ENV_IDS,
      fetchEnvConfig: fetcherFor(driftConfig()),
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      service: "showcase-mastra",
      env: "prod",
      expected: "disabled",
      liveType: "minor",
    });
    const summary = summarizeAutoUpdatesFailures(result);
    expect(summary.shouldFail).toBe(true);
    expect(summary.lines.join("\n")).toMatch(/autoUpdates drift detected/);
  });

  it("GREEN: no violations and would exit zero when all services are disabled", async () => {
    const result = await runAutoUpdatesGate({
      services: SSOT,
      envIds: ENV_IDS,
      fetchEnvConfig: fetcherFor(allDisabledConfig()),
    });
    expect(result.violations).toHaveLength(0);
    expect(result.checked).toBe(4); // 2 services × 2 envs
    const summary = summarizeAutoUpdatesFailures(result);
    expect(summary.shouldFail).toBe(false);
    expect(summary.lines).toEqual([]);
  });

  it("skips (does not fail) a service absent from an env's live config", async () => {
    const cfg: EnvironmentConfigJson = {
      services: { "svc-ag2": { source: {} } }, // mastra missing entirely
    };
    const result = await runAutoUpdatesGate({
      services: SSOT,
      envIds: ENV_IDS,
      fetchEnvConfig: fetcherFor({
        "prod-env-id": cfg,
        "staging-env-id": cfg,
      }),
    });
    expect(result.violations).toHaveLength(0);
    expect(result.checked).toBe(2); // only ag2, both envs
    expect(result.skipped).toBe(2); // mastra skipped in both envs
  });
});

// ── Fail-closed floor: zero-checked must never report green ────────────────
//
// The gate reported "✓ verified across 0 services" (exit 0) whenever the live
// config yielded no comparable services — empty/absent/string-form config,
// wrong project scope, or all-skipped. A drift gate that verified NOTHING must
// fail, not silently pass. (RED before the floor: shouldFail was false.)

describe("summarizeAutoUpdatesFailures — zero-checked floor", () => {
  it("FAILS when zero service/env pairs were checked (no false green)", () => {
    const summary = summarizeAutoUpdatesFailures({
      violations: [],
      checked: 0,
      skipped: 6,
    });
    expect(summary.shouldFail).toBe(true);
    expect(summary.lines.join("\n")).toMatch(/ZERO service\/env pairs/);
    expect(summary.lines.join("\n")).toMatch(/refusing to report success/);
  });

  it("still passes cleanly when at least one pair was checked and clean", () => {
    const summary = summarizeAutoUpdatesFailures({
      violations: [],
      checked: 4,
      skipped: 0,
    });
    expect(summary.shouldFail).toBe(false);
    expect(summary.lines).toEqual([]);
  });
});

// ── Per-env fail-closed floor: a healthy env must not mask a starved env ────
//
// The zero-checked floor was GLOBAL: if ONE env returned an empty/absent
// Environment.config, all of that env's services were silently skipped while a
// healthy OTHER env kept `checked>0` and the gate green — so drift in the
// broken env went unverified. The floor is now PER-ENV: every queried env that
// expected to check services must verify >0 of them, else the gate fails and
// names the starved env. (RED before the per-env floor: shouldFail was false
// because the healthy env kept the global checked count positive.)

describe("runAutoUpdatesGate + summary — per-env fail-closed floor", () => {
  it("FAILS naming the starved env when one env is healthy but another's config is empty", async () => {
    const healthy: EnvironmentConfigJson = {
      services: {
        "svc-mastra": { source: { autoUpdates: null } },
        "svc-ag2": { source: {} },
      },
    };
    const emptyEnv: EnvironmentConfigJson = { services: {} };
    const result = await runAutoUpdatesGate({
      services: SSOT,
      envIds: ENV_IDS,
      // env A (staging) healthy, env B (prod) empty/absent config.
      fetchEnvConfig: fetcherFor({
        "staging-env-id": healthy,
        "prod-env-id": emptyEnv,
      }),
    });
    // The healthy env keeps the GLOBAL checked count positive, so the old
    // global-only floor passed green here — the per-env floor must still fail.
    expect(result.checked).toBeGreaterThan(0);
    const summary = summarizeAutoUpdatesFailures(result);
    expect(summary.shouldFail).toBe(true);
    // The failure must name the starved env (prod), not the healthy one.
    expect(summary.lines.join("\n")).toMatch(/\[prod\]/);
    expect(summary.lines.join("\n")).not.toMatch(/\[staging\]/);
  });
});

describe("runAutoUpdatesGate + summary — zero-checked floor end-to-end", () => {
  it("FAILS when the live config has an empty/absent services map", async () => {
    // Empty services map for both envs → every pair skipped → checked===0.
    const empty: EnvironmentConfigJson = { services: {} };
    const result = await runAutoUpdatesGate({
      services: SSOT,
      envIds: ENV_IDS,
      fetchEnvConfig: fetcherFor({
        "prod-env-id": empty,
        "staging-env-id": empty,
      }),
    });
    expect(result.checked).toBe(0);
    // Pre-fix this reported shouldFail=false (false green); post-fix it fails.
    expect(summarizeAutoUpdatesFailures(result).shouldFail).toBe(true);
  });
});

// ── String-form Environment.config must be parsed, not silently skipped ─────
//
// Railway's `environment(id){config}` JSON scalar can arrive as a JSON STRING.
// The old code cast it `as EnvironmentConfigJson`, so `.services` was undefined
// and every service was skipped (checked===0) — a false green once combined
// with the missing floor. The gate now normalizes via parseEnvironmentConfig.
// (RED before the fix: checked===0 / skipped===4 because the string was never
// parsed.)

describe("string-form Environment.config", () => {
  it("parses a JSON-string config so services are actually checked", async () => {
    const cfgObj: EnvironmentConfigJson = {
      services: {
        "svc-mastra": { source: { autoUpdates: null } },
        "svc-ag2": { source: {} },
      },
    };
    const asString = JSON.stringify(cfgObj);
    const result = await runAutoUpdatesGate({
      services: SSOT,
      envIds: ENV_IDS,
      // Live GraphQL sometimes returns the JSON scalar as a string.
      fetchEnvConfig: async () => asString,
    });
    expect(result.violations).toHaveLength(0);
    expect(result.checked).toBe(4); // 2 services × 2 envs — parsed, not skipped
    expect(result.skipped).toBe(0);
    expect(summarizeAutoUpdatesFailures(result).shouldFail).toBe(false);
  });

  it("catches drift carried in a JSON-string config", async () => {
    const prod = JSON.stringify({
      services: {
        "svc-mastra": { source: { autoUpdates: { type: "minor" } } },
        "svc-ag2": { source: {} },
      },
    });
    const staging = JSON.stringify({
      services: {
        "svc-mastra": { source: { autoUpdates: null } },
        "svc-ag2": { source: {} },
      },
    });
    const byEnv: Record<string, string> = {
      "prod-env-id": prod,
      "staging-env-id": staging,
    };
    const result = await runAutoUpdatesGate({
      services: SSOT,
      envIds: ENV_IDS,
      fetchEnvConfig: async (envId: string) => byEnv[envId],
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      service: "showcase-mastra",
      env: "prod",
      liveType: "minor",
    });
  });
});

describe("parseEnvironmentConfig", () => {
  it("passes objects through unchanged", () => {
    const obj: EnvironmentConfigJson = { services: { a: { source: {} } } };
    expect(parseEnvironmentConfig(obj)).toBe(obj);
  });

  it("parses JSON strings", () => {
    expect(parseEnvironmentConfig('{"services":{"a":{"source":{}}}}')).toEqual({
      services: { a: { source: {} } },
    });
  });

  it("treats null/undefined as an empty config (floor then catches it)", () => {
    expect(parseEnvironmentConfig(null)).toEqual({});
    expect(parseEnvironmentConfig(undefined)).toEqual({});
  });

  it("fails loud on invalid JSON strings", () => {
    expect(() => parseEnvironmentConfig("{not json")).toThrow(/not valid JSON/);
  });

  it("fails loud on a non-object JSON scalar", () => {
    expect(() => parseEnvironmentConfig("42")).toThrow(/non-object/);
  });

  it("fails loud on an unexpected scalar type", () => {
    expect(() => parseEnvironmentConfig(42)).toThrow(/unexpected type/);
  });
});
