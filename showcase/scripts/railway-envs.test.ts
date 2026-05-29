import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CI_BUILT_SERVICES,
  type Domains,
  ENV_IDS,
  PRODUCTION_ENV_ID,
  PROJECT_ID,
  type ProbeConfig,
  type ProbeDriver,
  SERVICES,
  STAGING_ENV_ID,
  assertDispatchNamesUnique,
  domainFor,
  instanceIdFor,
  listServiceNames,
  repoNameFor,
  resolveEnv,
  serviceForDispatchName,
} from "./railway-envs";

// Compile-time guard: ensure the Domains type alias is referenced so this
// import is not removed by an over-eager organizer. The runtime body of
// this assignment is unused; it exists solely to anchor the type.
const _domainsTypeAnchor: Domains | undefined = undefined;
void _domainsTypeAnchor;

describe("railway-envs SSOT", () => {
  it("exposes the canonical project id", () => {
    expect(PROJECT_ID).toBe("6f8c6bff-a80d-4f8f-b78d-50b32bcf4479");
  });

  it("exposes both env ids and they differ", () => {
    expect(PRODUCTION_ENV_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(STAGING_ENV_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(PRODUCTION_ENV_ID).not.toBe(STAGING_ENV_ID);
  });

  it("resolves env synonyms", () => {
    expect(resolveEnv("prod").envId).toBe(PRODUCTION_ENV_ID);
    expect(resolveEnv("production").envId).toBe(PRODUCTION_ENV_ID);
    expect(resolveEnv("PROD").envId).toBe(PRODUCTION_ENV_ID);
    expect(resolveEnv("staging").envId).toBe(STAGING_ENV_ID);
    expect(resolveEnv(" Staging ").envId).toBe(STAGING_ENV_ID);
  });

  it("throws on unknown env names", () => {
    expect(() => resolveEnv("dev")).toThrow(/Unknown env/);
    expect(() => resolveEnv("")).toThrow(/Unknown env/);
  });

  it("ENV_IDS contains all synonyms", () => {
    expect(ENV_IDS.prod).toBe(PRODUCTION_ENV_ID);
    expect(ENV_IDS.production).toBe(PRODUCTION_ENV_ID);
    expect(ENV_IDS.staging).toBe(STAGING_ENV_ID);
  });

  it("contains exactly 27 services", () => {
    const names = listServiceNames();
    expect(names.length).toBe(27);
  });

  it("contains the expected canonical services", () => {
    const names = listServiceNames();
    // Sample sentinels — checking the full list is overkill, but these
    // are the ones we cannot tolerate losing without noticing.
    for (const expected of [
      "aimock",
      "harness",
      "pocketbase",
      "shell",
      "showcase-ag2",
      "showcase-langgraph-python",
      "showcase-mastra",
      "webhooks",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("every service has non-empty UUIDs for prod and staging", () => {
    const uuid = /^[0-9a-f-]{36}$/;
    for (const [name, entry] of Object.entries(SERVICES)) {
      expect(entry.serviceId, `${name}.serviceId`).toMatch(uuid);
      expect(entry.prodInstanceId, `${name}.prodInstanceId`).toMatch(uuid);
      expect(entry.stagingInstanceId, `${name}.stagingInstanceId`).toMatch(
        uuid,
      );
    }
  });

  it("prod and staging instance IDs differ per service", () => {
    for (const [name, entry] of Object.entries(SERVICES)) {
      expect(
        entry.prodInstanceId,
        `${name}: prod and staging instanceIds collided`,
      ).not.toBe(entry.stagingInstanceId);
    }
  });

  it("aimock has the showcase-aimock wrapper override in BOTH envs (permanent)", () => {
    // Both prod and staging run the `showcase-aimock` wrapper image — the
    // wrapper bakes showcase fixtures into base aimock and is the permanent
    // image for the aimock showcase service. Prod is digest-pinned; staging
    // floats :latest.
    expect(SERVICES.aimock.repoNameOverride?.prod).toBe("showcase-aimock");
    expect(SERVICES.aimock.repoNameOverride?.staging).toBe("showcase-aimock");
  });

  it("instanceIdFor returns the right ID per env", () => {
    expect(instanceIdFor("showcase-mastra", "prod")).toBe(
      "eaeddd9c-8b75-426f-b033-0fd935cbf6ef",
    );
    expect(instanceIdFor("showcase-mastra", "staging")).toBe(
      "eec22411-aab5-47a1-8f5b-d097e233d7f8",
    );
  });

  it("instanceIdFor throws on unknown service", () => {
    expect(() => instanceIdFor("nope", "prod")).toThrow(
      /Unknown showcase service/,
    );
  });

  it("CI_BUILT_SERVICES contains exactly 25 services and excludes pocketbase/webhooks", () => {
    expect(CI_BUILT_SERVICES.size).toBe(25);
    expect(CI_BUILT_SERVICES.has("pocketbase")).toBe(false);
    expect(CI_BUILT_SERVICES.has("webhooks")).toBe(false);
    // Sample positives.
    expect(CI_BUILT_SERVICES.has("showcase-mastra")).toBe(true);
    expect(CI_BUILT_SERVICES.has("aimock")).toBe(true);
    expect(CI_BUILT_SERVICES.has("dashboard")).toBe(true);
  });

  it("pocketbase and webhooks have per-env GHCR repo-name overrides", () => {
    expect(SERVICES.pocketbase.repoNameOverride).toEqual({
      prod: "showcase-pocketbase",
      staging: "showcase-pocketbase",
    });
    expect(SERVICES.webhooks.repoNameOverride).toEqual({
      prod: "showcase-eval-webhook",
      staging: "showcase-eval-webhook",
    });
  });

  it("pocketbase and webhooks are marked ciBuilt=false but gateValidated=true", () => {
    expect(SERVICES.pocketbase.ciBuilt).toBe(false);
    expect(SERVICES.pocketbase.gateValidated).toBe(true);
    expect(SERVICES.webhooks.ciBuilt).toBe(false);
    expect(SERVICES.webhooks.gateValidated).toBe(true);
  });

  it("repoNameFor resolves the showcase-aimock wrapper override in BOTH envs", () => {
    // Both prod and staging run the `showcase-aimock` wrapper image
    // (the fixture-baking wrapper is the permanent, canonical aimock
    // showcase image — no migration). Prod is digest-pinned; staging
    // floats :latest. The SSOT expresses this via overrides on both envs.
    expect(repoNameFor("aimock", "prod")).toBe("showcase-aimock");
    expect(repoNameFor("aimock", "staging")).toBe("showcase-aimock");
  });

  it("repoNameFor resolves pocketbase/webhooks overrides in BOTH envs", () => {
    expect(repoNameFor("pocketbase", "prod")).toBe("showcase-pocketbase");
    expect(repoNameFor("pocketbase", "staging")).toBe("showcase-pocketbase");
    expect(repoNameFor("webhooks", "prod")).toBe("showcase-eval-webhook");
    expect(repoNameFor("webhooks", "staging")).toBe("showcase-eval-webhook");
  });

  it("repoNameFor returns the service name verbatim when no override exists", () => {
    expect(repoNameFor("showcase-mastra", "prod")).toBe("showcase-mastra");
    expect(repoNameFor("showcase-mastra", "staging")).toBe("showcase-mastra");
  });

  it("serviceForDispatchName round-trips through SSOT keys", () => {
    expect(serviceForDispatchName("mastra")).toBe("showcase-mastra");
    expect(serviceForDispatchName("shell-dashboard")).toBe("dashboard");
    expect(serviceForDispatchName("showcase-aimock")).toBe("aimock");
    expect(serviceForDispatchName("shell")).toBe("shell");
    expect(serviceForDispatchName("nonsense")).toBeUndefined();
  });

  it("every dispatchName resolves back to its own SSOT entry", () => {
    for (const [name, entry] of Object.entries(SERVICES)) {
      if (entry.dispatchName === undefined) continue;
      expect(
        serviceForDispatchName(entry.dispatchName),
        `${name}.dispatchName="${entry.dispatchName}" did not round-trip`,
      ).toBe(name);
    }
  });

  it("dispatchName values are unique across SERVICES", () => {
    const values = Object.values(SERVICES)
      .map((entry) => entry.dispatchName)
      .filter((v): v is string => v !== undefined);
    expect(new Set(values).size).toBe(values.length);
  });

  it("every showcase_build.yml ALL_SERVICES dispatch_name maps to an SSOT entry (bidirectional for CI-built)", () => {
    // Forward-guard: parse the build workflow and assert every matrix
    // `dispatch_name` resolves through the SSOT. Without this, a contributor
    // can add a matrix entry whose dispatch_name has no SERVICES entry and
    // only discover it at redeploy time when `redeploy-env.ts` throws
    // `Unknown service` mid-deploy.
    //
    // Implementation note: ALL_SERVICES is a heredoc-style shell variable
    // holding a JSON array INSIDE the YAML — so a YAML parser (we have
    // `yaml` as a dep) wouldn't expose dispatch_names at any structural
    // position. The robust extraction is a regex over the file text scoped
    // to `"dispatch_name":"…"` JSON key/value pairs, which only appear
    // inside the ALL_SERVICES JSON literal (the workflow_dispatch options
    // list uses unkeyed YAML scalars and is not matched).
    const workflowPath = resolve(
      __dirname,
      "../../.github/workflows/showcase_build.yml",
    );
    const yaml = readFileSync(workflowPath, "utf8");
    const regex = /"dispatch_name"\s*:\s*"([^"]+)"/g;
    const dispatchNames: string[] = [];
    for (const match of yaml.matchAll(regex)) {
      dispatchNames.push(match[1]);
    }
    // Sanity: we expect a populated list (25 CI-built services today).
    expect(
      dispatchNames.length,
      "no dispatch_name entries found in showcase_build.yml — regex broken or file moved",
    ).toBeGreaterThan(0);

    // Forward direction: every YAML dispatch_name resolves to a defined
    // SSOT key. Catches "added to matrix, forgot SSOT entry."
    for (const dispatchName of dispatchNames) {
      const resolved = serviceForDispatchName(dispatchName);
      expect(
        resolved,
        `workflow dispatch_name "${dispatchName}" has no SSOT entry in railway-envs.ts`,
      ).toBeDefined();
    }

    // Reverse direction (scoped to CI-built): every CI-built SSOT entry's
    // dispatchName appears in the YAML matrix. Catches "added SSOT entry,
    // forgot matrix slot." Non-CI-built services (pocketbase, webhooks)
    // legitimately have no matrix entry — they're built by separate
    // release workflows — so they are excluded from the reverse check.
    const yamlSet = new Set(dispatchNames);
    for (const name of CI_BUILT_SERVICES) {
      const entry = SERVICES[name];
      expect(
        entry.dispatchName,
        `CI-built service "${name}" has no dispatchName in SSOT`,
      ).toBeDefined();
      expect(
        yamlSet.has(entry.dispatchName as string),
        `CI-built service "${name}" (dispatchName="${entry.dispatchName}") has no matching entry in showcase_build.yml ALL_SERVICES matrix`,
      ).toBe(true);
    }
  });
});

describe("webhooks SSOT entry", () => {
  it("has a dispatchName", () => {
    expect(SERVICES.webhooks).toBeDefined();
    expect(SERVICES.webhooks.dispatchName).toBe("webhooks");
  });

  it("is mirrored in showcase_build.yml dispatch choices", () => {
    const yml = readFileSync(
      resolve(__dirname, "../../.github/workflows/showcase_build.yml"),
      "utf-8",
    );
    // The workflow_dispatch.inputs.service options list MUST include
    // the SSOT dispatchName for webhooks so humans can target it.
    expect(yml).toMatch(/^\s*- webhooks\s*$/m);
    // The ALL_SERVICES matrix MUST include a webhooks entry.
    expect(yml).toMatch(/"dispatch_name":"webhooks"/);
  });

  it("is wired into showcase_deploy.yml's verify matrix via the SSOT", () => {
    // showcase_deploy.yml is SSOT-driven (A.7): the verify matrix is
    // derived from railway-envs.generated.json by selecting services
    // with `probe.staging === true`, and the workflow_dispatch input is
    // a free-form string resolved against the SSOT (key or dispatchName).
    // For webhooks to be probe-eligible AND human-dispatchable, the SSOT
    // entry MUST carry probe.staging:true and a dispatchName of "webhooks".
    expect(SERVICES.webhooks.probe.staging).toBe(true);
    expect(SERVICES.webhooks.dispatchName).toBe("webhooks");
    // Pin the workflow's SSOT-driven contract so a future regression
    // back to a hardcoded matrix is caught: deploy.yml must consume the
    // generated SSOT JSON and select on probe.staging.
    const yml = readFileSync(
      resolve(__dirname, "../../.github/workflows/showcase_deploy.yml"),
      "utf-8",
    );
    expect(yml).toMatch(/railway-envs\.generated\.json/);
    expect(yml).toMatch(/probe\.staging\s*==\s*true/);
  });
});

describe("dispatchName uniqueness invariant", () => {
  it("the production SSOT has no duplicate dispatchNames", () => {
    // This calls the invariant against the real exported SERVICES map;
    // it MUST pass on a healthy tree.
    expect(() => assertDispatchNamesUnique()).not.toThrow();
  });

  it("throws when two services share a dispatchName", () => {
    // Synthetic input: same as production SERVICES but with two
    // entries pointing at the same dispatchName "showcase-aimock".
    const synthetic: Record<string, { dispatchName?: string }> = {
      aimock: { dispatchName: "showcase-aimock" },
      "showcase-aimock-dupe": { dispatchName: "showcase-aimock" },
      mastra: { dispatchName: "mastra" },
    };
    expect(() => assertDispatchNamesUnique(synthetic)).toThrow(
      /duplicate dispatchName.*showcase-aimock.*aimock.*showcase-aimock-dupe/i,
    );
  });

  it("ignores entries without a dispatchName", () => {
    const synthetic: Record<string, { dispatchName?: string }> = {
      pocketbase: {}, // no dispatchName — out-of-band
      webhooks: { dispatchName: "webhooks" },
    };
    expect(() => assertDispatchNamesUnique(synthetic)).not.toThrow();
  });
});

describe("railway-envs SSOT — domains + probe", () => {
  it("every service exposes a domains.staging and domains.prod (no scheme)", () => {
    for (const [name, entry] of Object.entries(SERVICES)) {
      expect(entry.domains, `${name}.domains missing`).toBeDefined();
      expect(entry.domains.staging, `${name}.domains.staging`).toMatch(
        /^[A-Za-z0-9.-]+$/,
      );
      expect(entry.domains.prod, `${name}.domains.prod`).toMatch(
        /^[A-Za-z0-9.-]+$/,
      );
      expect(
        entry.domains.staging.startsWith("http"),
        `${name}: staging domain must not include scheme`,
      ).toBe(false);
      expect(
        entry.domains.prod.startsWith("http"),
        `${name}: prod domain must not include scheme`,
      ).toBe(false);
    }
  });

  it("confirmed staging domains match the documented values", () => {
    expect(SERVICES.pocketbase.domains.staging).toBe(
      "pocketbase-staging-eec0.up.railway.app",
    );
    expect(SERVICES.harness.domains.staging).toBe(
      "harness-staging-2ee4.up.railway.app",
    );
    expect(SERVICES.shell.domains.staging).toBe(
      "showcase.staging.copilotkit.ai",
    );
    expect(SERVICES.docs.domains.staging).toBe("docs.staging.copilotkit.ai");
    expect(SERVICES.dashboard.domains.staging).toBe(
      "dashboard.showcase.staging.copilotkit.ai",
    );
  });

  it("confirmed prod domains match the bin/railway:73-88 EXPECTED_DOMAINS", () => {
    expect(SERVICES.shell.domains.prod).toBe("showcase.copilotkit.ai");
    expect(SERVICES.dashboard.domains.prod).toBe(
      "dashboard.showcase.copilotkit.ai",
    );
    expect(SERVICES.dojo.domains.prod).toBe("dojo.showcase.copilotkit.ai");
    expect(SERVICES.docs.domains.prod).toBe("docs.copilotkit.ai");
    expect(SERVICES.webhooks.domains.prod).toBe("hooks.showcase.copilotkit.ai");
  });

  it("every service exposes a probe.staging, probe.prod, probe.driver", () => {
    const validDrivers: ProbeDriver[] = [
      "shell",
      "harness",
      "eval",
      "aimock",
      "pocketbase",
      "webhooks",
      "dojo",
      "docs",
      "dashboard",
      "agent",
    ];
    for (const [name, entry] of Object.entries(SERVICES)) {
      expect(entry.probe, `${name}.probe missing`).toBeDefined();
      expect(typeof entry.probe.staging).toBe("boolean");
      expect(typeof entry.probe.prod).toBe("boolean");
      expect(validDrivers).toContain(entry.probe.driver);
    }
  });

  it("aimock probes BOTH envs by default (the carve-out is digest-only, not probe-skip)", () => {
    // The aimock-prod carve-out only freezes the digest; the prod probe
    // still runs against whatever is pinned. Spec §3 / §11.
    expect(SERVICES.aimock.probe.prod).toBe(true);
    expect(SERVICES.aimock.probe.staging).toBe(true);
  });

  it("domainFor returns the no-scheme host for known service+env", () => {
    expect(domainFor("docs", "staging")).toBe("docs.staging.copilotkit.ai");
    expect(domainFor("docs", "prod")).toBe("docs.copilotkit.ai");
    expect(domainFor("pocketbase", "staging")).toBe(
      "pocketbase-staging-eec0.up.railway.app",
    );
  });

  it("domainFor throws on unknown service (no silent empty string)", () => {
    expect(() => domainFor("nope", "staging")).toThrow(
      /Unknown showcase service/,
    );
    expect(() => domainFor("nope", "prod")).toThrow(
      /Unknown showcase service/,
    );
  });

  it("domainFor throws on unknown env (defends against ad-hoc EnvName values)", () => {
    // @ts-expect-error — intentionally passing a bad env at runtime.
    expect(() => domainFor("docs", "dev")).toThrow(/Unknown env/);
  });

  it("domainFor scheme guard rejects scheme-included literals but accepts http*-prefixed hosts", () => {
    // The guard is intended to reject `http://...` / `https://...` literals
    // accidentally pasted into the SSOT — NOT to reject any host whose name
    // happens to begin with the letters "http" (e.g. `httpd-...`, `httpbin...`).
    // Discriminator is the scheme separator `://`, not a `startsWith("http")`
    // prefix check.
    const saved = SERVICES.docs.domains.staging;
    try {
      // Regression: malformed `http://`-style literal MUST still throw.
      (SERVICES.docs.domains as { staging: string }).staging =
        "http://docs.staging.copilotkit.ai";
      expect(() => domainFor("docs", "staging")).toThrow(
        /malformed\/missing staging domain/,
      );
      (SERVICES.docs.domains as { staging: string }).staging =
        "https://docs.staging.copilotkit.ai";
      expect(() => domainFor("docs", "staging")).toThrow(
        /malformed\/missing staging domain/,
      );
      // Positive: a hypothetical `httpd-`-prefixed host MUST be accepted.
      (SERVICES.docs.domains as { staging: string }).staging =
        "httpd-staging.up.railway.app";
      expect(domainFor("docs", "staging")).toBe("httpd-staging.up.railway.app");
      (SERVICES.docs.domains as { staging: string }).staging =
        "httpbin.example.com";
      expect(domainFor("docs", "staging")).toBe("httpbin.example.com");
    } finally {
      (SERVICES.docs.domains as { staging: string }).staging = saved;
    }
  });

  it("STAGING_ENV_ID and PRODUCTION_ENV_ID are exported and stable", () => {
    expect(STAGING_ENV_ID).toBe("8edfef02-ea09-4a20-8689-261f21cc2849");
    expect(PRODUCTION_ENV_ID).toBe("b14919f4-6417-429f-848d-c6ae2201e04f");
  });

  it("ProbeConfig type compiles with the documented shape", () => {
    // Compile-time guard: this object must satisfy ProbeConfig.
    const sample: ProbeConfig = {
      staging: true,
      prod: false,
      driver: "shell",
    };
    expect(sample.driver).toBe("shell");
  });
});
