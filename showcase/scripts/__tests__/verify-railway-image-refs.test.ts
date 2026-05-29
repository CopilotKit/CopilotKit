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
  summarizeFailures,
} from "../verify-railway-image-refs";
import {
  SERVICES,
  repoNameFor,
  type ServiceEntry,
} from "../railway-envs";

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
    const missingStaging = findMissingServices(
      "staging",
      new Set<string>(),
    );
    expect(missingProd).toHaveLength(27);
    expect(missingStaging).toHaveLength(27);
  });
});
