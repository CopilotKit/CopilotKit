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

// A tiny SSOT: two services, both MANAGED-"disabled" in BOTH envs (a
// fully-managed fleet — exercises the general disabled-vs-minor comparison in
// both envs). autoUpdates is per-env, keyed by the same env names as
// `environments`.
const SSOT: Record<string, AutoUpdatesGateEntry> = {
  "showcase-mastra": {
    serviceId: "svc-mastra",
    environments: { prod: {}, staging: {} },
    autoUpdates: { prod: "disabled", staging: "disabled" },
  },
  "showcase-ag2": {
    serviceId: "svc-ag2",
    environments: { prod: {}, staging: {} },
    autoUpdates: { prod: "disabled", staging: "disabled" },
  },
};

// The staging-first SSOT: staging is MANAGED-"disabled" (enforced) while prod
// is "unmanaged" (the gate skips it entirely). This is the live rollout shape.
const SSOT_STAGING_FIRST: Record<string, AutoUpdatesGateEntry> = {
  "showcase-mastra": {
    serviceId: "svc-mastra",
    environments: { prod: {}, staging: {} },
    autoUpdates: { staging: "disabled", prod: "unmanaged" },
  },
  "showcase-ag2": {
    serviceId: "svc-ag2",
    environments: { prod: {}, staging: {} },
    autoUpdates: { staging: "disabled", prod: "unmanaged" },
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
  it("reads the per-env SSOT field for the requested env", () => {
    expect(
      expectedPolicyFor(
        {
          serviceId: "x",
          environments: { prod: {}, staging: {} },
          autoUpdates: { prod: "minor", staging: "disabled" },
        },
        "prod",
      ),
    ).toBe("minor");
  });

  it("resolves the 'unmanaged' sentinel for the requested env", () => {
    const entry: AutoUpdatesGateEntry = {
      serviceId: "x",
      environments: { prod: {}, staging: {} },
      autoUpdates: { staging: "disabled", prod: "unmanaged" },
    };
    expect(expectedPolicyFor(entry, "staging")).toBe("disabled");
    expect(expectedPolicyFor(entry, "prod")).toBe("unmanaged");
  });

  it("defaults to disabled when the SSOT field is absent", () => {
    expect(
      expectedPolicyFor({ serviceId: "x", environments: {} }, "prod"),
    ).toBe("disabled");
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

// ── Staging-first per-env rollout: enforce staging, skip unmanaged prod ─────
//
// autoUpdates is per-env. Staging is MANAGED-"disabled" (the gate enforces it:
// a live-minor staging service is a violation). Prod is "unmanaged" — the gate
// does NOT check it AT ALL, so prod's heterogeneous live autoUpdates (some
// minor, some disabled) produce ZERO violations and do not trip the per-env
// zero-checked floor (an unmanaged env is not counted as expected).

describe("runAutoUpdatesGate — staging-first per-env rollout", () => {
  it("(a) MANAGED staging with a live-minor service ⇒ violation", async () => {
    // staging: mastra minor (drift). prod: all disabled (but prod is unmanaged
    // anyway). Exactly one violation, in staging.
    const staging: EnvironmentConfigJson = {
      services: {
        "svc-mastra": { source: { autoUpdates: { type: "minor" } } },
        "svc-ag2": { source: {} },
      },
    };
    const prod: EnvironmentConfigJson = {
      services: {
        "svc-mastra": { source: { autoUpdates: null } },
        "svc-ag2": { source: {} },
      },
    };
    const result = await runAutoUpdatesGate({
      services: SSOT_STAGING_FIRST,
      envIds: ENV_IDS,
      fetchEnvConfig: fetcherFor({
        "staging-env-id": staging,
        "prod-env-id": prod,
      }),
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      service: "showcase-mastra",
      env: "staging",
      expected: "disabled",
      liveType: "minor",
    });
    // Prod is unmanaged → not checked; only the 2 staging services are.
    expect(result.checked).toBe(2);
    const summary = summarizeAutoUpdatesFailures(result);
    expect(summary.shouldFail).toBe(true);
    expect(summary.lines.join("\n")).toMatch(/\[staging\]/);
  });

  it("(b) UNMANAGED prod with a live-minor service ⇒ NOT flagged (skipped)", async () => {
    // Both envs carry a live-minor mastra. Staging (managed) ⇒ violation;
    // prod (unmanaged) ⇒ NOT flagged, and prod is not even counted/checked.
    const minorCfg: EnvironmentConfigJson = {
      services: {
        "svc-mastra": { source: { autoUpdates: { type: "minor" } } },
        "svc-ag2": { source: { autoUpdates: { type: "minor" } } },
      },
    };
    const result = await runAutoUpdatesGate({
      services: SSOT_STAGING_FIRST,
      envIds: ENV_IDS,
      fetchEnvConfig: fetcherFor({
        "staging-env-id": minorCfg,
        "prod-env-id": minorCfg,
      }),
    });
    // No prod violations despite prod being live-minor for BOTH services.
    expect(result.violations.every((v) => v.env !== "prod")).toBe(true);
    // Both staging services are flagged; prod produced nothing.
    expect(result.violations).toHaveLength(2);
    expect(result.violations.map((v) => v.env)).toEqual(["staging", "staging"]);
    // Prod is unmanaged → not counted as expected, not checked.
    expect(result.perEnv?.prod).toEqual({
      expected: 0,
      checked: 0,
      skipped: 0,
    });
    // The starvation floor must NOT fire for the unmanaged prod env.
    const summary = summarizeAutoUpdatesFailures(result);
    expect(summary.lines.join("\n")).not.toMatch(/\[prod\]/);
  });

  it("(b') all-unmanaged prod is entirely skipped and never trips the floor", async () => {
    // Even when prod's live config is EMPTY, an unmanaged prod produces no
    // starvation failure (it is not expected). A clean managed staging passes.
    const stagingClean: EnvironmentConfigJson = {
      services: {
        "svc-mastra": { source: { autoUpdates: null } },
        "svc-ag2": { source: {} },
      },
    };
    const prodEmpty: EnvironmentConfigJson = { services: {} };
    const result = await runAutoUpdatesGate({
      services: SSOT_STAGING_FIRST,
      envIds: ENV_IDS,
      fetchEnvConfig: fetcherFor({
        "staging-env-id": stagingClean,
        "prod-env-id": prodEmpty,
      }),
    });
    expect(result.violations).toHaveLength(0);
    expect(result.perEnv?.prod).toEqual({
      expected: 0,
      checked: 0,
      skipped: 0,
    });
    expect(summarizeAutoUpdatesFailures(result).shouldFail).toBe(false);
  });

  it("(c) MANAGED staging that verifies ZERO services ⇒ floor fails (named)", async () => {
    // Staging is managed (expected>0) but its live config is empty ⇒ checked 0
    // for a managed env ⇒ the per-env floor fails and names [staging]. Prod is
    // unmanaged, so it neither contributes nor masks the failure.
    const stagingEmpty: EnvironmentConfigJson = { services: {} };
    const prodMinor: EnvironmentConfigJson = {
      services: {
        "svc-mastra": { source: { autoUpdates: { type: "minor" } } },
        "svc-ag2": { source: {} },
      },
    };
    const result = await runAutoUpdatesGate({
      services: SSOT_STAGING_FIRST,
      envIds: ENV_IDS,
      fetchEnvConfig: fetcherFor({
        "staging-env-id": stagingEmpty,
        "prod-env-id": prodMinor,
      }),
    });
    const summary = summarizeAutoUpdatesFailures(result);
    expect(summary.shouldFail).toBe(true);
    expect(summary.lines.join("\n")).toMatch(/\[staging\]/);
    // Prod (unmanaged) must not be named as starved.
    expect(summary.lines.join("\n")).not.toMatch(/\[prod\]/);
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
