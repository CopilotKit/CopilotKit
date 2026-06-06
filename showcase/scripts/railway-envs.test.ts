import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CI_BUILT_SERVICES,
  ENV_IDS,
  PRODUCTION_ENV_ID,
  PROJECT_ID,
  SERVICES,
  STAGING_ENV_ID,
  assertDispatchNamesUnique,
  domainFor,
  envsFor,
  instanceIdFor,
  listServiceNames,
  probeEnabled,
  repoNameFor,
  resolveEnv,
  serviceForDispatchName,
} from "./railway-envs";
import type { EnvironmentConfig, ProbeDriver } from "./railway-envs";

// Compile-time guard: ensure the EnvironmentConfig type alias is referenced
// so this import is not removed by an over-eager organizer. The runtime body
// of this assignment is unused; it exists solely to anchor the type.
const _envConfigTypeAnchor: EnvironmentConfig | undefined = undefined;
void _envConfigTypeAnchor;

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

  it("contains exactly 29 services", () => {
    const names = listServiceNames();
    expect(names.length).toBe(29);
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

  it("every service has a non-empty serviceId and per-env instance UUIDs", () => {
    const uuid = /^[0-9a-f-]{36}$/;
    for (const [name, entry] of Object.entries(SERVICES)) {
      expect(entry.serviceId, `${name}.serviceId`).toMatch(uuid);
      // Each declared env carries a UUID instanceId. Services that exist in
      // only one env (e.g. the staging-only worker) declare only that env.
      for (const [env, cfg] of Object.entries(entry.environments)) {
        expect(
          cfg.instanceId,
          `${name}.environments.${env}.instanceId`,
        ).toMatch(uuid);
      }
    }
  });

  it("instance IDs differ across a service's envs", () => {
    for (const [name, entry] of Object.entries(SERVICES)) {
      const ids = Object.values(entry.environments).map((c) => c.instanceId);
      expect(
        new Set(ids).size,
        `${name}: instanceIds collided across envs`,
      ).toBe(ids.length);
    }
  });

  it("aimock has the showcase-aimock wrapper override in BOTH envs (permanent)", () => {
    // Both prod and staging run the `showcase-aimock` wrapper image — the
    // wrapper bakes showcase fixtures into base aimock and is the permanent
    // image for the aimock showcase service. Prod is digest-pinned; staging
    // floats :latest.
    expect(SERVICES.aimock.environments.prod.repoName).toBe("showcase-aimock");
    expect(SERVICES.aimock.environments.staging.repoName).toBe(
      "showcase-aimock",
    );
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

  it("CI_BUILT_SERVICES contains exactly 26 services (incl. pocketbase) and excludes webhooks", () => {
    expect(CI_BUILT_SERVICES.size).toBe(26);
    // pocketbase is now CI-built (showcase_build.yml `pocketbase` slot,
    // gated to showcase/pocketbase/** changes).
    expect(CI_BUILT_SERVICES.has("pocketbase")).toBe(true);
    // webhooks remains out-of-band (released by the showcase-eval-webhook repo).
    expect(CI_BUILT_SERVICES.has("webhooks")).toBe(false);
    // Sample positives.
    expect(CI_BUILT_SERVICES.has("showcase-mastra")).toBe(true);
    expect(CI_BUILT_SERVICES.has("aimock")).toBe(true);
    expect(CI_BUILT_SERVICES.has("dashboard")).toBe(true);
  });

  it("pocketbase and webhooks have per-env GHCR repo-name overrides", () => {
    expect(SERVICES.pocketbase.environments.prod.repoName).toBe(
      "showcase-pocketbase",
    );
    expect(SERVICES.pocketbase.environments.staging.repoName).toBe(
      "showcase-pocketbase",
    );
    expect(SERVICES.webhooks.environments.prod.repoName).toBe(
      "showcase-eval-webhook",
    );
    expect(SERVICES.webhooks.environments.staging.repoName).toBe(
      "showcase-eval-webhook",
    );
  });

  it("pocketbase is ciBuilt=true with a dispatchName; webhooks stays ciBuilt=false; both gateValidated=true", () => {
    expect(SERVICES.pocketbase.ciBuilt).toBe(true);
    expect(SERVICES.pocketbase.gateValidated).toBe(true);
    expect(SERVICES.pocketbase.dispatchName).toBe("showcase-pocketbase");
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
    // forgot matrix slot." pocketbase IS now CI-built (its
    // "showcase-pocketbase" slot is gated to showcase/pocketbase/**) and
    // so is included here; only webhooks remains non-CI-built (released by
    // the showcase-eval-webhook repo) and thus excluded from this check.
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
    expect(SERVICES.webhooks.environments.staging.probe).toBe(true);
    expect(SERVICES.webhooks.dispatchName).toBe("webhooks");
    // Pin the workflow's SSOT-driven contract so a future regression
    // back to a hardcoded matrix is caught. The matrix-building logic
    // was extracted out of inline bash into
    // showcase/scripts/resolve-verify-matrix.ts (the prior inline
    // bash+jq produced two confirmed bugs across CR rounds, so the
    // contract now lives in a pure, unit-tested TS module). The deploy
    // workflow MUST invoke that script — that is the SSOT-consumption
    // hand-off. The script itself MUST read
    // `railway-envs.generated.json` and filter on `probe.staging===true`
    // — that is the SSOT-consumption mechanism. Pinning both halves
    // catches the two regression shapes that matter: (a) deploy.yml
    // silently dropping the script call (back to a hardcoded matrix
    // or inline jq) and (b) the script being kept but the SSOT/probe
    // contract being weakened inside it.
    const yml = readFileSync(
      resolve(__dirname, "../../.github/workflows/showcase_deploy.yml"),
      "utf-8",
    );
    expect(
      yml,
      "showcase_deploy.yml must invoke resolve-verify-matrix.ts to build the verify matrix from the SSOT",
    ).toMatch(/resolve-verify-matrix\.ts/);

    const resolver = readFileSync(
      resolve(__dirname, "./resolve-verify-matrix.ts"),
      "utf-8",
    );
    expect(
      resolver,
      "resolve-verify-matrix.ts must consume railway-envs.generated.json (the SSOT JSON)",
    ).toMatch(/railway-envs\.generated\.json/);
    expect(
      resolver,
      "resolve-verify-matrix.ts must select probe-eligible services on probe.staging===true",
    ).toMatch(/probe\.staging\s*===\s*true/);
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
  it("every declared env exposes a no-scheme domain (where a domain is set)", () => {
    for (const [name, entry] of Object.entries(SERVICES)) {
      expect(entry.environments, `${name}.environments missing`).toBeDefined();
      for (const [env, cfg] of Object.entries(entry.environments)) {
        // Domainless workers (probe disabled) legitimately omit `domain`.
        if (cfg.domain === undefined) continue;
        expect(cfg.domain, `${name}.environments.${env}.domain`).toMatch(
          /^[A-Za-z0-9.-]+$/,
        );
        expect(
          cfg.domain.startsWith("http"),
          `${name}.${env}: domain must not include scheme`,
        ).toBe(false);
      }
    }
  });

  it("confirmed staging domains match the documented values", () => {
    expect(SERVICES.pocketbase.environments.staging.domain).toBe(
      "pocketbase-staging-eec0.up.railway.app",
    );
    expect(SERVICES.harness.environments.staging.domain).toBe(
      "harness-staging-2ee4.up.railway.app",
    );
    expect(SERVICES.shell.environments.staging.domain).toBe(
      "showcase.staging.copilotkit.ai",
    );
    expect(SERVICES.docs.environments.staging.domain).toBe(
      "docs.staging.copilotkit.ai",
    );
    expect(SERVICES.dashboard.environments.staging.domain).toBe(
      "dashboard.showcase.staging.copilotkit.ai",
    );
  });

  it("confirmed prod domains match the bin/railway:73-88 EXPECTED_DOMAINS", () => {
    expect(SERVICES.shell.environments.prod.domain).toBe(
      "showcase.copilotkit.ai",
    );
    expect(SERVICES.dashboard.environments.prod.domain).toBe(
      "dashboard.showcase.copilotkit.ai",
    );
    expect(SERVICES.dojo.environments.prod.domain).toBe(
      "dojo.showcase.copilotkit.ai",
    );
    expect(SERVICES.docs.environments.prod.domain).toBe("docs.copilotkit.ai");
    expect(SERVICES.webhooks.environments.prod.domain).toBe(
      "hooks.showcase.copilotkit.ai",
    );
  });

  it("every service exposes a valid probeDriver and per-env probe flags", () => {
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
      // probeDriver is hoisted to the entry (env-independent).
      expect(validDrivers, `${name}.probeDriver`).toContain(entry.probeDriver);
      // probeEnabled returns a boolean for every declared env.
      for (const env of Object.keys(entry.environments)) {
        expect(typeof probeEnabled(name, env)).toBe("boolean");
      }
    }
  });

  it("aimock probes BOTH envs by default (the carve-out is digest-only, not probe-skip)", () => {
    // The aimock-prod carve-out only freezes the digest; the prod probe
    // still runs against whatever is pinned. Spec §3 / §11.
    expect(probeEnabled("aimock", "prod")).toBe(true);
    expect(probeEnabled("aimock", "staging")).toBe(true);
  });

  it("envsFor lists exactly the envs a service declares", () => {
    // Dual-env services declare both; the staging-only worker declares one.
    expect(envsFor("aimock")).toEqual(["prod", "staging"]);
    expect(envsFor("harness-workers")).toEqual(["staging"]);
    expect(envsFor("harness-legacy")).toEqual(["prod", "staging"]);
  });

  it("harness-workers is a staging-only, domainless, probe-disabled worker", () => {
    // The pool-fleet worker is the canonical single-env / domainless shape
    // the env-map schema enables (the old schema forced a placeholder prod
    // instanceId + a borrowed control-plane domain). Pin every facet:
    const worker = SERVICES["harness-workers"];
    // Staging-only: no prod env at all (no placeholder).
    expect(worker.environments.prod).toBeUndefined();
    expect(worker.environments.staging).toBeDefined();
    // Domainless: the staging env omits a public host entirely (it is a
    // queue consumer, not HTTP-exposed). domainFor MUST throw rather than
    // return a borrowed host.
    expect(worker.environments.staging.domain).toBeUndefined();
    expect(() => domainFor("harness-workers", "staging")).toThrow(
      /malformed\/missing staging domain/,
    );
    // Probe disabled (covered by the control-plane harness probe + the
    // Railway-internal healthcheck).
    expect(probeEnabled("harness-workers", "staging")).toBe(false);
    // Runs the shared showcase-harness image; not separately CI-built; kept
    // out of both gate directions via gateIgnore.
    expect(worker.environments.staging.repoName).toBe("showcase-harness");
    expect(worker.ciBuilt).toBe(false);
    expect(worker.gateIgnore).toBe(true);
    expect(worker.serviceId).toBe("c2aa8a0b-350e-4b76-8541-3012dfac41d0");
    expect(worker.environments.staging.instanceId).toBe(
      "362c1e37-5f40-45f2-ac7b-0e5adac565f8",
    );
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
    expect(() => domainFor("nope", "prod")).toThrow(/Unknown showcase service/);
  });

  it("domainFor throws on an env the service does not declare", () => {
    // EnvName is now an OPEN string, so a never-declared env name like "dev"
    // is no longer a type error — it resolves to "no such environment" at
    // runtime (the service simply has no `dev` key in `environments`). This
    // is the env-map analogue of the old closed-union "Unknown env" guard.
    expect(() => domainFor("docs", "dev")).toThrow(
      /has no "dev" environment/,
    );
  });

  it("domainFor scheme guard rejects scheme-included literals but accepts http*-prefixed hosts", () => {
    // The guard is intended to reject `http://...` / `https://...` literals
    // accidentally pasted into the SSOT — NOT to reject any host whose name
    // happens to begin with the letters "http" (e.g. `httpd-...`, `httpbin...`).
    // Discriminator is the scheme separator `://`, not a `startsWith("http")`
    // prefix check.
    const stagingCfg = SERVICES.docs.environments.staging;
    const saved = stagingCfg.domain;
    try {
      // Regression: malformed `http://`-style literal MUST still throw.
      stagingCfg.domain = "http://docs.staging.copilotkit.ai";
      expect(() => domainFor("docs", "staging")).toThrow(
        /malformed\/missing staging domain/,
      );
      stagingCfg.domain = "https://docs.staging.copilotkit.ai";
      expect(() => domainFor("docs", "staging")).toThrow(
        /malformed\/missing staging domain/,
      );
      // Positive: a hypothetical `httpd-`-prefixed host MUST be accepted.
      stagingCfg.domain = "httpd-staging.up.railway.app";
      expect(domainFor("docs", "staging")).toBe("httpd-staging.up.railway.app");
      stagingCfg.domain = "httpbin.example.com";
      expect(domainFor("docs", "staging")).toBe("httpbin.example.com");
    } finally {
      stagingCfg.domain = saved;
    }
  });

  it("STAGING_ENV_ID and PRODUCTION_ENV_ID are exported and stable", () => {
    expect(STAGING_ENV_ID).toBe("8edfef02-ea09-4a20-8689-261f21cc2849");
    expect(PRODUCTION_ENV_ID).toBe("b14919f4-6417-429f-848d-c6ae2201e04f");
  });

  it("EnvironmentConfig type compiles with the documented shape", () => {
    // Compile-time guard: this object must satisfy EnvironmentConfig.
    const sample: EnvironmentConfig = {
      instanceId: "00000000-0000-0000-0000-000000000000",
      domain: "example.up.railway.app",
      probe: false,
      repoName: "showcase-example",
    };
    expect(sample.probe).toBe(false);
  });
});
