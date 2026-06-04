/**
 * Tests for the Railway image-ref gate (`verify-railway-image-refs.ts`)
 * and the SSOT fields it consumes (`railway-envs.ts`).
 *
 * Style note: validators are pure and exported; the GraphQL fetch is
 * the only impure surface and is exercised manually (per the script's
 * docstring). We unit-test the pure validators against synthesized
 * inputs — no Railway API calls.
 */

import { describe, it, expect } from "vitest";
import {
  findMissingServices,
  findUntrackedServices,
  isStarterFleetService,
  summarizeFailures,
  validateImage,
} from "../verify-railway-image-refs";
import { SERVICES, repoNameFor } from "../railway-envs";
import type { ServiceEntry } from "../railway-envs";

describe("ServiceEntry gateIgnore field", () => {
  it("is optional on the type and defaults to falsy when unset", () => {
    // Every real SSOT entry has gateIgnore unset (undefined / falsy).
    for (const [name, entry] of Object.entries(SERVICES)) {
      const gi = (entry as ServiceEntry).gateIgnore;
      expect(gi === undefined || gi === false, `${name} gateIgnore`).toBe(true);
    }
  });
});

describe("findUntrackedServices (Railway -> SSOT direction)", () => {
  it("returns empty when every Railway-reported service is in the SSOT", () => {
    // The SSOT keys themselves are by definition all in the SSOT, so
    // passing them as "Railway-reported" should yield zero untracked.
    const all = new Set(Object.keys(SERVICES));
    expect(findUntrackedServices(all)).toEqual([]);
  });

  it("flags a Railway service that is not in the SSOT", () => {
    const railway = new Set<string>([
      "showcase-mastra", // tracked
      "phantom-relay", // untracked
    ]);
    expect(findUntrackedServices(railway)).toEqual(["phantom-relay"]);
  });

  it("returns names sorted for stable output", () => {
    const railway = new Set<string>([
      "zeta-svc",
      "alpha-svc",
      "showcase-mastra",
    ]);
    expect(findUntrackedServices(railway)).toEqual(["alpha-svc", "zeta-svc"]);
  });

  it("does NOT flag a `starter-*` live service that is absent from the SSOT", () => {
    // The starter container fleet (starter-<slug>) is auto-discovered by
    // the starter_smoke probe (railway-services source, namePrefix
    // "starter-") and is intentionally DECOUPLED from this 27-service
    // SSOT. Provisioning a starter-* service must NOT trip the
    // Railway->SSOT drift gate (which previously SKIPPED the build).
    const railway = new Set<string>([
      "showcase-mastra", // tracked
      "starter-langgraph-python", // starter fleet, decoupled — tolerated
      "starter-mastra", // starter fleet, decoupled — tolerated
    ]);
    expect(findUntrackedServices(railway)).toEqual([]);
  });

  it("STILL flags a real (non-starter) untracked Railway service", () => {
    // Drift detection for the tracked fleet must be preserved: a genuine
    // out-of-band service (here a rogue `showcase-*`) is still a hard fail
    // even when a tolerated starter-* service is present alongside it.
    const railway = new Set<string>([
      "showcase-mastra", // tracked
      "starter-mastra", // starter fleet — tolerated
      "showcase-rogue-untracked", // real drift — must be flagged
    ]);
    expect(findUntrackedServices(railway)).toEqual([
      "showcase-rogue-untracked",
    ]);
  });

  it("does NOT flag a service that the SSOT marks gateIgnore: true", () => {
    // Inject a transient entry into SERVICES for this test, then remove.
    const sentinel = "transient-third-party-relay";
    (SERVICES as Record<string, ServiceEntry>)[sentinel] = {
      serviceId: "00000000-0000-0000-0000-000000000000",
      prodInstanceId: "11111111-1111-1111-1111-111111111111",
      stagingInstanceId: "22222222-2222-2222-2222-222222222222",
      ciBuilt: false,
      gateValidated: false,
      gateIgnore: true,
      domains: {
        staging: "transient-third-party-relay-staging.up.railway.app",
        prod: "transient-third-party-relay-production.up.railway.app",
      },
      probe: { staging: false, prod: false, driver: "agent" },
    };
    try {
      const railway = new Set<string>([sentinel, "showcase-mastra"]);
      expect(findUntrackedServices(railway)).toEqual([]);
    } finally {
      delete (SERVICES as Record<string, ServiceEntry>)[sentinel];
    }
  });
});

describe("isStarterFleetService predicate", () => {
  it("matches names that start with the `starter-` prefix", () => {
    expect(isStarterFleetService("starter-mastra")).toBe(true);
    expect(isStarterFleetService("starter-langgraph-python")).toBe(true);
    expect(isStarterFleetService("starter-")).toBe(true);
  });

  it("does NOT match tracked showcase / infra service names", () => {
    expect(isStarterFleetService("showcase-mastra")).toBe(false);
    expect(isStarterFleetService("dashboard")).toBe(false);
    expect(isStarterFleetService("pocketbase")).toBe(false);
    // The decommissioned `showcase-starter-*` services use the
    // `showcase-` prefix, NOT `starter-`, so they are NOT starter-fleet.
    expect(isStarterFleetService("showcase-starter-ag2")).toBe(false);
  });
});

describe("findMissingServices — starter fleet is never required", () => {
  it("does not require any `starter-*` service (none are in the SSOT)", () => {
    // Starter services are decoupled from the SSOT, so they are never
    // gateValidated SSOT entries and findMissingServices never demands
    // them. A present-set containing only a starter service must still
    // report the real gateValidated services as missing — and never the
    // starter itself.
    const present = new Set<string>(["starter-mastra"]);
    const missing = findMissingServices("prod", present);
    expect(missing).not.toContain("starter-mastra");
    // Sanity: the tracked fleet is still required when absent.
    expect(missing).toContain("showcase-mastra");
  });
});

describe("main() unknown-service policy", () => {
  // We exercise the pure helper that main() uses, not main() itself
  // (main wraps the live GraphQL call and process.exit; out of scope
  // for a unit test).
  it("reports an untracked Railway service as a hard violation", () => {
    const railwayReported = new Set<string>([
      "showcase-mastra",
      "rogue-service",
    ]);
    const untracked = findUntrackedServices(railwayReported);
    expect(untracked).toContain("rogue-service");
    // Hard-fail semantics: any non-empty result must cause the gate
    // to exit non-zero. We assert the contract by checking the
    // boolean the caller will branch on:
    expect(untracked.length > 0).toBe(true);
  });
});

describe("summarizeFailures", () => {
  it("includes untracked Railway services in the failure block and exits non-zero", () => {
    const out = summarizeFailures({
      violations: [],
      missingByEnv: { prod: [], staging: [] },
      untracked: ["phantom-relay"],
      checked: 50,
      skipped: 0,
    });
    expect(out.shouldFail).toBe(true);
    expect(out.lines.join("\n")).toMatch(/phantom-relay/);
    expect(out.lines.join("\n")).toMatch(/not in the SSOT/i);
  });

  it("does not fail when nothing is wrong", () => {
    const out = summarizeFailures({
      violations: [],
      missingByEnv: { prod: [], staging: [] },
      untracked: [],
      checked: 54,
      skipped: 0,
    });
    expect(out.shouldFail).toBe(false);
  });

  it("flags shape violations", () => {
    const out = summarizeFailures({
      violations: [
        {
          service: "showcase-mastra",
          env: "prod",
          image: "ghcr.io/copilotkit/showcase-mastra:latest",
          reason: "prod must be pinned to `@sha256:<digest>` (got `:latest`)",
        },
      ],
      missingByEnv: { prod: [], staging: [] },
      untracked: [],
      checked: 50,
      skipped: 0,
    });
    expect(out.shouldFail).toBe(true);
    expect(out.lines.join("\n")).toMatch(/showcase-mastra/);
  });

  it("flags missing services per env", () => {
    const out = summarizeFailures({
      violations: [],
      missingByEnv: { prod: ["showcase-foo"], staging: [] },
      untracked: [],
      checked: 50,
      skipped: 0,
    });
    expect(out.shouldFail).toBe(true);
    expect(out.lines.join("\n")).toMatch(/showcase-foo/);
  });
});

describe("WS-C: all 27 services gateValidated, with correct overrides", () => {
  const FIVE_NEW = [
    ["dashboard", "showcase-shell-dashboard"],
    ["docs", "showcase-shell-docs"],
    ["dojo", "showcase-shell-dojo"],
    ["shell", "showcase-shell"],
    ["harness", "showcase-harness"],
  ] as const;

  it("has 27 services in the SSOT", () => {
    expect(Object.keys(SERVICES)).toHaveLength(27);
  });

  it("marks every service gateValidated (no Phase-2 holdouts)", () => {
    const unvalidated = Object.entries(SERVICES)
      .filter(([, entry]) => !entry.gateValidated)
      .map(([name]) => name);
    expect(unvalidated).toEqual([]);
  });

  for (const [serviceKey, expectedRepo] of FIVE_NEW) {
    it(`resolves ${serviceKey} -> ${expectedRepo} for both envs via repoNameFor`, () => {
      expect(repoNameFor(serviceKey, "prod")).toBe(expectedRepo);
      expect(repoNameFor(serviceKey, "staging")).toBe(expectedRepo);
    });

    it(`carries the repoNameOverride directly on the SERVICES entry for ${serviceKey}`, () => {
      const entry = SERVICES[serviceKey];
      expect(entry.repoNameOverride?.prod).toBe(expectedRepo);
      expect(entry.repoNameOverride?.staging).toBe(expectedRepo);
    });
  }

  it("findMissingServices treats all 27 as gateValidated targets", () => {
    // With nothing "present", every gateValidated service should
    // appear in the missing set; after C.3 that means all 27.
    const missingProd = findMissingServices("prod", new Set<string>());
    const missingStaging = findMissingServices("staging", new Set<string>());
    expect(missingProd).toHaveLength(27);
    expect(missingStaging).toHaveLength(27);
  });
});

describe("WS-C: shape validation for the five newly-gated services", () => {
  const PROD_DIGEST = "@sha256:" + "a".repeat(64);

  const FIVE_NEW = [
    { key: "dashboard", repo: "showcase-shell-dashboard" },
    { key: "docs", repo: "showcase-shell-docs" },
    { key: "dojo", repo: "showcase-shell-dojo" },
    { key: "shell", repo: "showcase-shell" },
    { key: "harness", repo: "showcase-harness" },
  ] as const;

  for (const { key, repo } of FIVE_NEW) {
    it(`${key}: prod requires @sha256, :latest on prod fails`, () => {
      const v = validateImage(`ghcr.io/copilotkit/${repo}:latest`, {
        env: "prod",
        repoName: repo,
      });
      expect(v).not.toBeNull();
      expect(v?.reason).toMatch(/prod must be pinned to `@sha256:<digest>`/);
    });

    it(`${key}: prod accepts the canonical @sha256 shape`, () => {
      const v = validateImage(`ghcr.io/copilotkit/${repo}${PROD_DIGEST}`, {
        env: "prod",
        repoName: repo,
      });
      expect(v).toBeNull();
    });

    it(`${key}: staging accepts :latest on the correct repo`, () => {
      const v = validateImage(`ghcr.io/copilotkit/${repo}:latest`, {
        env: "staging",
        repoName: repo,
      });
      expect(v).toBeNull();
    });

    it(`${key}: staging rejects @sha256 (must float on :latest)`, () => {
      const v = validateImage(`ghcr.io/copilotkit/${repo}${PROD_DIGEST}`, {
        env: "staging",
        repoName: repo,
      });
      expect(v).not.toBeNull();
      expect(v?.reason).toMatch(/staging must float on :latest/);
    });

    it(`${key}: rejects the wrong GHCR repo name on prod`, () => {
      // E.g. ghcr.io/copilotkit/dashboard@sha256:... — what the gate
      // would see if someone added gateValidated:true without the
      // matching repoNameOverride. Repo NAME must match override.
      const wrongRepo = `ghcr.io/copilotkit/${key}${PROD_DIGEST}`;
      const v = validateImage(wrongRepo, { env: "prod", repoName: repo });
      expect(v).not.toBeNull();
      expect(v?.reason).toMatch(/image repo name mismatches expected/);
    });

    it(`${key}: rejects the wrong GHCR repo name on staging`, () => {
      const wrongRepo = `ghcr.io/copilotkit/${key}:latest`;
      const v = validateImage(wrongRepo, {
        env: "staging",
        repoName: repo,
      });
      expect(v).not.toBeNull();
      expect(v?.reason).toMatch(/image repo name mismatches expected/);
    });
  }
});

describe("WS-C: malformed ref negatives", () => {
  it("rejects `:sha256-<hex>` on prod (missing the @ separator)", () => {
    // Shape: ghcr.io/copilotkit/<repo>:sha256-<hex>
    // Looks vaguely like a digest pin but is actually a *tag* whose
    // literal name starts with "sha256-". This is the closest shape
    // to the 2026-04-21 "atest" corruption and must fail loudly.
    const bad = "ghcr.io/copilotkit/showcase-shell:sha256-" + "a".repeat(64);
    const v = validateImage(bad, {
      env: "prod",
      repoName: "showcase-shell",
    });
    expect(v).not.toBeNull();
    expect(v?.image).toBe(bad);
    // Reason must mention canonical prod shape so the operator knows
    // exactly what to fix.
    expect(v?.reason).toMatch(/canonical (prod )?shape/);
  });

  it("rejects bare `@sha256:<too-short-hex>` on prod", () => {
    const bad = "ghcr.io/copilotkit/showcase-shell@sha256:" + "a".repeat(10);
    const v = validateImage(bad, {
      env: "prod",
      repoName: "showcase-shell",
    });
    expect(v).not.toBeNull();
  });

  it("rejects a truncated `atest`-style tag on staging", () => {
    // The exact 2026-04-21 corruption shape from the script docstring.
    const bad = "ghcr.io/copilotkit/showcase-shell-dashboardatest";
    const v = validateImage(bad, {
      env: "staging",
      repoName: "showcase-shell-dashboard",
    });
    expect(v).not.toBeNull();
  });

  it("rejects non-ghcr.io registries on both envs", () => {
    const prodBad =
      "docker.io/copilotkit/showcase-shell@sha256:" + "b".repeat(64);
    const stagingBad = "docker.io/copilotkit/showcase-shell:latest";
    expect(
      validateImage(prodBad, { env: "prod", repoName: "showcase-shell" }),
    ).not.toBeNull();
    expect(
      validateImage(stagingBad, {
        env: "staging",
        repoName: "showcase-shell",
      }),
    ).not.toBeNull();
  });
});
