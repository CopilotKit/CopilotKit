import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CI_BUILT_SERVICES,
  ENV_IDS,
  ENV_ID_BY_NAME,
  PRODUCTION_ENV_ID,
  PROJECT_ID,
  SERVICES,
  STAGING_ENV_ID,
  assertClosureValid,
  assertDispatchNamesUnique,
  assertEnvRegistryConsistent,
  assertImageConsumersValid,
  assertServiceAndInstanceIdsUnique,
  computePromoteClosure,
  domainFor,
  envsFor,
  healthcheckPathFor,
  instanceIdFor,
  listServiceNames,
  probeEnabled,
  repoNameFor,
  resolveEnv,
  serviceForDispatchName,
} from "./railway-envs";
import type {
  ClosurePlan,
  EnvironmentConfig,
  ProbeDriver,
} from "./railway-envs";

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

  it("resolveEnv returns canonical env names derived from the registry", () => {
    expect(resolveEnv("prod").env).toBe("prod");
    expect(resolveEnv("production").env).toBe("prod");
    expect(resolveEnv("staging").env).toBe("staging");
  });

  it("resolveEnv resolves a runtime-registered hypothetical env (open-env contract)", () => {
    // The SSOT's documented contract: a new env needs only a registry
    // entry (an ENV_IDS spelling + an ENV_ID_BY_NAME canonical name) —
    // resolveEnv must derive its resolution from the registries, not a
    // hardcoded synonym chain. Register a hypothetical "preview" env
    // (plus a synonym), resolve it, and clean up.
    ENV_IDS.preview = "preview-env-id-000";
    ENV_IDS.pre = "preview-env-id-000"; // synonym
    ENV_ID_BY_NAME.preview = "preview-env-id-000";
    try {
      expect(resolveEnv("preview")).toEqual({
        env: "preview",
        envId: "preview-env-id-000",
      });
      // Synonym + case-fold + trim all route to the canonical name.
      expect(resolveEnv(" PRE ").env).toBe("preview");
    } finally {
      delete ENV_IDS.preview;
      delete ENV_IDS.pre;
      delete ENV_ID_BY_NAME.preview;
    }
  });

  it("resolveEnv fails loud on a synonym whose env-id has no canonical name", () => {
    // A synonym registered in ENV_IDS that points at an env-id missing
    // from ENV_ID_BY_NAME is a mis-wired registry — resolveEnv must throw,
    // not invent a canonical name.
    ENV_IDS.orphan = "orphan-env-id-000";
    try {
      expect(() => resolveEnv("orphan")).toThrow(/no canonical name/);
    } finally {
      delete ENV_IDS.orphan;
    }
  });

  it("resolveEnv rejects inherited Object.prototype keys as env names", () => {
    expect(() => resolveEnv("constructor")).toThrow(/Unknown env/);
    expect(() => resolveEnv("toString")).toThrow(/Unknown env/);
  });

  it("ENV_IDS contains all synonyms", () => {
    expect(ENV_IDS.prod).toBe(PRODUCTION_ENV_ID);
    expect(ENV_IDS.production).toBe(PRODUCTION_ENV_ID);
    expect(ENV_IDS.staging).toBe(STAGING_ENV_ID);
  });

  it("contains exactly 41 services (29 showcase/infra + 12 starter-*)", () => {
    const names = listServiceNames();
    expect(names.length).toBe(41);
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

  it("does NOT contain harness-legacy (fleet-migration bridge retired)", () => {
    // The pool-fleet migration is complete: the control-plane + prod
    // workers cover every probe dimension `harness-legacy` was bridging,
    // so the interim service is dead config and removed from the SSOT.
    const names = listServiceNames();
    expect(names).not.toContain("harness-legacy");
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

  it("every declared healthcheckPath is a non-empty `/`-prefixed string", () => {
    // A wrong healthcheckPath 404s and WEDGES the deploy forever, so the
    // schema guards the shape: when present it MUST be a non-empty path
    // starting with `/`. Absence is legal (live-null → omit / do not assert).
    for (const [name, entry] of Object.entries(SERVICES)) {
      for (const [env, cfg] of Object.entries(entry.environments)) {
        if (cfg.healthcheckPath === undefined) continue;
        expect(
          cfg.healthcheckPath,
          `${name}.environments.${env}.healthcheckPath`,
        ).toMatch(/^\/\S*$/);
      }
    }
  });

  it("healthcheckPathFor returns the tracked value / undefined", () => {
    // Tracked: aimock /health (the repaired incident service).
    expect(healthcheckPathFor("aimock", "prod")).toBe("/health");
    expect(healthcheckPathFor("aimock", "staging")).toBe("/health");
    // Agent integration: /api/health.
    expect(healthcheckPathFor("showcase-ag2", "prod")).toBe("/api/health");
    // Next.js shell: `/`.
    expect(healthcheckPathFor("shell", "prod")).toBe("/");
    // Live-null service: undefined (do not assert).
    expect(healthcheckPathFor("docs", "prod")).toBeUndefined();
    expect(healthcheckPathFor("dashboard", "staging")).toBeUndefined();
    // harness-workers is dual-env: /health in BOTH staging and prod (the prod
    // worker was backfilled into the SSOT so a showcase-harness rebuild bounces
    // it; both envs declare the shared probe path).
    expect(healthcheckPathFor("harness-workers", "staging")).toBe("/health");
    expect(healthcheckPathFor("harness-workers", "prod")).toBe("/health");
    // Unknown service / undeclared env → undefined (never throws).
    expect(healthcheckPathFor("nope", "prod")).toBeUndefined();
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

  it("CI_BUILT_SERVICES contains exactly 39 services (incl. pocketbase + 12 starters) and excludes webhooks", () => {
    // 27 showcase/infra CI-built (incl. the staging-only
    // showcase-strands-typescript) + 12 starter-<slug> (S2 brought them under
    // the gate; they ARE built+pushed by showcase_build.yml's `build-starters`
    // job to ghcr.io/copilotkit/starter-<slug>:latest).
    expect(CI_BUILT_SERVICES.size).toBe(39);
    // pocketbase is now CI-built (showcase_build.yml `pocketbase` slot,
    // gated to showcase/pocketbase/** changes).
    expect(CI_BUILT_SERVICES.has("pocketbase")).toBe(true);
    // webhooks remains out-of-band (released by the showcase-eval-webhook repo).
    expect(CI_BUILT_SERVICES.has("webhooks")).toBe(false);
    // Sample positives.
    expect(CI_BUILT_SERVICES.has("showcase-mastra")).toBe(true);
    expect(CI_BUILT_SERVICES.has("aimock")).toBe(true);
    expect(CI_BUILT_SERVICES.has("dashboard")).toBe(true);
    // S2: starters are now CI-built.
    expect(CI_BUILT_SERVICES.has("starter-adk")).toBe(true);
    expect(CI_BUILT_SERVICES.has("starter-mastra")).toBe(true);
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

  it("repoNameFor throws on unknown service (no silent verbatim echo)", () => {
    expect(() => repoNameFor("nope", "prod")).toThrow(
      /Unknown showcase service/,
    );
  });

  it("repoNameFor throws on an unnormalized env synonym", () => {
    // "production" is a resolveEnv synonym, NOT a registered SSOT env key.
    // Silently echoing the service name back for it is exactly the
    // wrong-GHCR-name class the image-ref gate exists to catch.
    expect(() => repoNameFor("aimock", "production")).toThrow(
      /Unknown env "production".*resolveEnv/,
    );
  });

  it("repoNameFor resolves the per-env repoName override for a dual-env worker", () => {
    // harness-workers is now dual-env (prod backfilled into the SSOT). Both
    // env entries carry an explicit repoName override of "showcase-harness"
    // (it runs the shared showcase-harness image, NOT a "harness-workers"
    // image), so repoNameFor returns that override in BOTH envs rather than
    // echoing the SSOT key. (The throw-on-an-undeclared-env path is covered by
    // the prototype-key env-axis test below and the unknown-service test above.)
    expect(repoNameFor("harness-workers", "prod")).toBe("showcase-harness");
    expect(repoNameFor("harness-workers", "staging")).toBe("showcase-harness");
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
    // Sanity: we expect a populated list (one entry per CI-built service).
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
    //
    // S2: the 12 starter-<slug> services are CI-built by the SEPARATE
    // `build-starters` job, whose matrix uses `"image":"starter-<slug>"`
    // keys (NOT `"dispatch_name":"…"`). Their dispatchName === the SSOT key
    // === the starter matrix `.image` === the workflow_dispatch choice value
    // (`- starter-<slug>`). So the reverse-direction membership set must also
    // include the starter matrix `image` values; otherwise the now-CI-built
    // starters would spuriously fail this check.
    const starterImageRegex = /"image"\s*:\s*"(starter-[^"]+)"/g;
    const starterImages: string[] = [];
    for (const match of yaml.matchAll(starterImageRegex)) {
      starterImages.push(match[1]);
    }
    expect(
      starterImages.length,
      "no starter `image` entries found in showcase_build.yml — the build-starters matrix moved or its key shape changed",
    ).toBeGreaterThanOrEqual(12);
    const yamlSet = new Set([...dispatchNames, ...starterImages]);
    for (const name of CI_BUILT_SERVICES) {
      const entry = SERVICES[name];
      expect(
        entry.dispatchName,
        `CI-built service "${name}" has no dispatchName in SSOT`,
      ).toBeDefined();
      expect(
        yamlSet.has(entry.dispatchName as string),
        `CI-built service "${name}" (dispatchName="${entry.dispatchName}") has no matching entry in showcase_build.yml (ALL_SERVICES dispatch_name or build-starters image)`,
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
    // The ALL_SERVICES matrix MUST include a webhooks entry. Same
    // whitespace tolerance as the extraction regex in the bidirectional
    // dispatch_name test above, so a reformat can't split the two.
    expect(yml).toMatch(/"dispatch_name"\s*:\s*"webhooks"/);
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

  it("throws when a dispatchName equals a DIFFERENT entry's SSOT key", () => {
    // resolveTargetServices checks SSOT keys BEFORE dispatch_names, so a
    // dispatchName shadowed by another entry's key would silently misroute
    // CI redeploys to that other entry.
    const synthetic: Record<string, { dispatchName?: string }> = {
      dashboard: { dispatchName: "shell-dashboard" },
      rogue: { dispatchName: "dashboard" },
    };
    expect(() => assertDispatchNamesUnique(synthetic)).toThrow(
      /dispatchName "dashboard".*"rogue".*DIFFERENT entry's SSOT key/i,
    );
  });

  it("allows a dispatchName equal to its OWN SSOT key (self-match)", () => {
    // shell/webhooks-shaped entries: both lookup paths land on the same
    // entry, so a self-match cannot misroute.
    const synthetic: Record<string, { dispatchName?: string }> = {
      shell: { dispatchName: "shell" },
      webhooks: { dispatchName: "webhooks" },
    };
    expect(() => assertDispatchNamesUnique(synthetic)).not.toThrow();
  });

  it("does not treat an inherited Object.prototype key as a colliding SSOT key", () => {
    // `Object.hasOwn` (not a bare truthiness lookup) must back the
    // cross-key check, or dispatchName "toString" would false-positive.
    const synthetic: Record<string, { dispatchName?: string }> = {
      weird: { dispatchName: "toString" },
    };
    expect(() => assertDispatchNamesUnique(synthetic)).not.toThrow();
  });
});

describe("imageOf consumer invariant", () => {
  it("the production SSOT's imageOf entries are all valid", () => {
    // Calls the invariant against the real exported SERVICES map; it MUST
    // pass on a healthy tree (harness-workers → harness is the one
    // consumer today).
    expect(() => assertImageConsumersValid()).not.toThrow();
  });

  it("throws on an imageOf pointing at a nonexistent SSOT key", () => {
    const synthetic = {
      worker: { ciBuilt: false, imageOf: "no-such-service" },
    };
    expect(() => assertImageConsumersValid(synthetic)).toThrow(
      /imageOf "no-such-service".*worker.*not an SSOT key/i,
    );
  });

  it("throws on an imageOf pointing at a non-ciBuilt service", () => {
    // webhooks-shaped target: a real SSOT entry that is NOT built by
    // showcase_build.yml. Consuming its image cannot put the consumer in
    // the CI redeploy scope, so the SSOT must reject the wiring loudly.
    const synthetic = {
      "out-of-band": { ciBuilt: false },
      worker: { ciBuilt: false, imageOf: "out-of-band" },
    };
    expect(() => assertImageConsumersValid(synthetic)).toThrow(
      /imageOf "out-of-band".*worker.*not ciBuilt/i,
    );
  });

  it("throws when a ciBuilt service itself declares imageOf", () => {
    // A build slot IS its own image producer — imageOf on it is a
    // modeling contradiction (and would imply consumer-of-consumer
    // chains, which the redeploy expansion deliberately does not do).
    const synthetic = {
      builder: { ciBuilt: true },
      "also-built": { ciBuilt: true, imageOf: "builder" },
    };
    expect(() => assertImageConsumersValid(synthetic)).toThrow(
      /also-built.*ciBuilt.*imageOf/i,
    );
  });

  it("ignores entries without imageOf", () => {
    const synthetic = {
      builder: { ciBuilt: true },
      "out-of-band": { ciBuilt: false },
    };
    expect(() => assertImageConsumersValid(synthetic)).not.toThrow();
  });

  it("throws when a consumer declares an env its imageOf producer never builds for", () => {
    // A consumer env outside the producer's env set would run an image
    // that no CI build ever refreshes for that env — exactly the
    // stale-image class this invariant exists to prevent. The message
    // must name the offending env.
    const synthetic = {
      producer: { ciBuilt: true, environments: { staging: {} } },
      worker: {
        ciBuilt: false,
        imageOf: "producer",
        environments: { staging: {}, prod: {} },
      },
    };
    expect(() => assertImageConsumersValid(synthetic)).toThrow(
      /worker.*"prod".*producer/i,
    );
  });

  it("throws when an imageOf consumer declares ZERO environments", () => {
    // An empty (or absent) environments map passes the env-subset check
    // vacuously, but expandImageConsumers filters on `environments[env]` —
    // such a consumer would never be redeployed in ANY env. Must fail loud.
    const emptyEnvs = {
      producer: { ciBuilt: true, environments: { staging: {} } },
      worker: { ciBuilt: false, imageOf: "producer", environments: {} },
    };
    expect(() => assertImageConsumersValid(emptyEnvs)).toThrow(
      /worker.*ZERO environments/i,
    );
    const absentEnvs = {
      producer: { ciBuilt: true, environments: { staging: {} } },
      worker: { ciBuilt: false, imageOf: "producer" },
    };
    expect(() => assertImageConsumersValid(absentEnvs)).toThrow(
      /worker.*ZERO environments/i,
    );
  });

  it("treats inherited Object.prototype keys as dangling imageOf targets", () => {
    // `services[target]` with target "toString" resolves to the inherited
    // Object.prototype method — a truthy non-entry. The assert must use an
    // own-property lookup so this reports the DANGLING-target message, not
    // a bogus "not ciBuilt" complaint about Function.prototype.toString.
    const synthetic = {
      worker: { ciBuilt: false, imageOf: "toString" },
    };
    expect(() => assertImageConsumersValid(synthetic)).toThrow(
      /imageOf "toString".*worker.*not an SSOT key/i,
    );
  });
});

describe("accessor prototype-key hardening (uniform own-property semantics)", () => {
  // The class-killer sweep: every exported accessor must use own-property
  // semantics on BOTH axes (service name, env name). Inherited
  // Object.prototype keys must produce the curated error (or the accessor's
  // documented contract-return) — never a raw TypeError, never a silent
  // undefined, never a spurious `true`.
  const protoKeys = ["constructor", "toString", "hasOwnProperty"] as const;

  it("throwing accessors throw the curated unknown-service error for prototype keys on the service axis", () => {
    for (const key of protoKeys) {
      expect(() => envsFor(key), `envsFor("${key}")`).toThrow(
        /Unknown showcase service/,
      );
      expect(
        () => instanceIdFor(key, "prod"),
        `instanceIdFor("${key}")`,
      ).toThrow(/Unknown showcase service/);
      expect(() => domainFor(key, "prod"), `domainFor("${key}")`).toThrow(
        /Unknown showcase service/,
      );
      expect(() => repoNameFor(key, "prod"), `repoNameFor("${key}")`).toThrow(
        /Unknown showcase service/,
      );
    }
  });

  it("instanceIdFor/domainFor throw the curated no-such-environment error for prototype keys on the env axis", () => {
    for (const key of protoKeys) {
      expect(
        () => instanceIdFor("docs", key),
        `instanceIdFor("docs", "${key}")`,
      ).toThrow(new RegExp(`has no "${key}" environment`));
      expect(
        () => domainFor("docs", key),
        `domainFor("docs", "${key}")`,
      ).toThrow(new RegExp(`has no "${key}" environment`));
    }
  });

  it("repoNameFor rejects prototype keys on the env axis via the registry check", () => {
    // repoNameFor additionally requires a normalized registered env key, so
    // its curated error for a prototype env is the Unknown-env message.
    for (const key of protoKeys) {
      expect(
        () => repoNameFor("docs", key),
        `repoNameFor("docs", "${key}")`,
      ).toThrow(/Unknown env/);
    }
  });

  it("probeEnabled contract-returns false (never throws, never true) for prototype keys on either axis", () => {
    for (const key of protoKeys) {
      expect(probeEnabled(key, "prod"), `probeEnabled("${key}", "prod")`).toBe(
        false,
      );
      expect(probeEnabled("docs", key), `probeEnabled("docs", "${key}")`).toBe(
        false,
      );
    }
  });

  it("probeEnabled contract-returns false for unknown service and undeclared env", () => {
    expect(probeEnabled("nope", "prod")).toBe(false);
    expect(probeEnabled("docs", "dev")).toBe(false);
    expect(probeEnabled("harness-workers", "prod")).toBe(false);
  });
});

describe("env-registry consistency invariant", () => {
  it("the production SSOT passes assertEnvRegistryConsistent", () => {
    expect(() => assertEnvRegistryConsistent()).not.toThrow();
  });

  it("throws when a service declares an env key missing from ENV_ID_BY_NAME", () => {
    const services = { svc: { environments: { preview: {} } } };
    expect(() =>
      assertEnvRegistryConsistent(services, { prod: "id-1" }, { prod: "id-1" }),
    ).toThrow(/svc.*"preview".*ENV_ID_BY_NAME/i);
  });

  it("throws when two ENV_ID_BY_NAME canonical names share an env-id", () => {
    // resolveEnv picks the FIRST canonical name carrying an env-id — a
    // duplicated id makes the second name silently unreachable.
    const byName = { prod: "id-1", mirror: "id-1" };
    const ids = { prod: "id-1", mirror: "id-1" };
    expect(() => assertEnvRegistryConsistent({}, byName, ids)).toThrow(
      /duplicate env-id "id-1".*prod.*mirror/i,
    );
  });

  it("throws when a canonical env name has no ENV_IDS spelling", () => {
    // A canonical name with no spelling can never be produced by
    // resolveEnv — it is a registered env that no operator can name.
    const byName = { prod: "id-1", ghost: "id-2" };
    const ids = { prod: "id-1" };
    expect(() => assertEnvRegistryConsistent({}, byName, ids)).toThrow(
      /"ghost".*no ENV_IDS spelling/i,
    );
  });

  it("throws when a key in BOTH registries carries different env-ids (ENV_IDS.prod drifted to the staging id)", () => {
    // The empirical gap this clause closes: with ENV_IDS.prod pointing at
    // the STAGING env-id (while "production" still carries the real prod
    // id), every other clause passes — ids are unique, every canonical
    // name has a spelling, no orphans — yet resolveEnv("prod") silently
    // returns { env: "staging" }. A redeploy typed as "prod" hits staging.
    const byName = { prod: "prod-id", staging: "staging-id" };
    const ids = {
      prod: "staging-id", // drifted!
      production: "prod-id",
      staging: "staging-id",
    };
    expect(() => assertEnvRegistryConsistent({}, byName, ids)).toThrow(
      /cross-wired.*"prod"/i,
    );
  });

  it("throws on an orphan ENV_IDS spelling (env-id carried by no canonical name)", () => {
    // Previously only caught lazily inside resolveEnv, at call time, for
    // the one spelling an operator happened to type. The invariant makes
    // the mis-wire loud at module load for EVERY orphan spelling.
    const byName = { prod: "id-1" };
    const ids = { prod: "id-1", legacy: "id-9" };
    expect(() => assertEnvRegistryConsistent({}, byName, ids)).toThrow(
      /orphan.*"legacy".*"id-9"/i,
    );
  });

  it("throws on a registry key that is not trim().toLowerCase()-normalized (registered but unreachable)", () => {
    // resolveEnv lowercases its input before the own-key lookup, so a
    // non-lowercase spelling can never match — it is registered noise.
    const byName = { prod: "id-1", Preview: "id-2" };
    const ids = { prod: "id-1", preview: "id-2", Production: "id-1" };
    const run = () => assertEnvRegistryConsistent({}, byName, ids);
    expect(run).toThrow(/ENV_ID_BY_NAME key "Preview"/);
    expect(run).toThrow(/ENV_IDS key "Production"/);
  });

  it("throws on a registry key that is an Object.prototype property name (both registries)", () => {
    // A prototype-named env ("constructor", "toString", …) defeats every
    // own-property lookup discipline in this file — reject it outright.
    const byName = { prod: "id-1", constructor: "id-2" };
    const ids = { prod: "id-1", constructor: "id-2" };
    const run = () => assertEnvRegistryConsistent({}, byName, ids);
    expect(run).toThrow(/ENV_IDS key "constructor".*Object\.prototype/);
    expect(run).toThrow(/ENV_ID_BY_NAME key "constructor".*Object\.prototype/);
  });
});

describe("service/instance id uniqueness invariant", () => {
  it("the production SSOT passes assertServiceAndInstanceIdsUnique", () => {
    expect(() => assertServiceAndInstanceIdsUnique()).not.toThrow();
  });

  it("throws when two services share a serviceId", () => {
    const services = {
      a: { serviceId: "dup-1", environments: { prod: { instanceId: "i-1" } } },
      b: { serviceId: "dup-1", environments: { prod: { instanceId: "i-2" } } },
    };
    expect(() => assertServiceAndInstanceIdsUnique(services)).toThrow(
      /duplicate serviceId "dup-1".*a.*b/i,
    );
  });

  it("throws when two env configs share an instanceId (globally, across services)", () => {
    const services = {
      a: { serviceId: "s-1", environments: { prod: { instanceId: "i-dup" } } },
      b: {
        serviceId: "s-2",
        environments: { staging: { instanceId: "i-dup" } },
      },
    };
    expect(() => assertServiceAndInstanceIdsUnique(services)).toThrow(
      /duplicate instanceId "i-dup".*a\.prod.*b\.staging/i,
    );
  });
});

describe("railway-envs SSOT — domains + probe", () => {
  it("every declared env exposes a no-scheme domain (where a domain is set)", () => {
    for (const [name, entry] of Object.entries(SERVICES)) {
      expect(entry.environments, `${name}.environments missing`).toBeDefined();
      for (const [env, cfg] of Object.entries(entry.environments)) {
        // Domainless workers (probe disabled) legitimately omit `domain`.
        if (cfg.domain === undefined) continue;
        // Charset alone already excludes schemes (":" and "/" are rejected);
        // domainFor's `://` discriminator has its own dedicated test below
        // ("domainFor scheme guard rejects scheme-included literals but
        // accepts http*-prefixed hosts") — that is the authoritative scheme
        // coverage.
        expect(cfg.domain, `${name}.environments.${env}.domain`).toMatch(
          /^[A-Za-z0-9.-]+$/,
        );
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

  it("confirmed prod domains match bin/railway's EXPECTED_DOMAINS", () => {
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
      "starter",
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
    // Dual-env services declare both; harness-workers is now dual-env too
    // (the prod worker was backfilled into the SSOT).
    expect(envsFor("aimock")).toEqual(["prod", "staging"]);
    expect(envsFor("harness-workers")).toEqual(["prod", "staging"]);
  });

  it("harness-workers is a dual-env, domainless, probe-disabled worker", () => {
    // The pool-fleet worker now runs in BOTH staging and prod: the prod worker
    // was backfilled into the SSOT (real serviceInstance ID 7c48ee43-…) so an
    // env-aware imageOf rebuild of showcase-harness bounces the prod worker too
    // (it used to be staging-only, which silently skipped the prod worker on a
    // rebuild and left it on a stale image). Pin every facet:
    const worker = SERVICES["harness-workers"];
    // Dual-env: both envs declared (no placeholder — each carries a real
    // serviceInstance ID).
    expect(worker.environments.prod).toBeDefined();
    expect(worker.environments.staging).toBeDefined();
    // Domainless in BOTH envs: the worker is a queue consumer, not
    // HTTP-exposed, so each env omits a public host entirely and domainFor
    // MUST throw rather than return a borrowed control-plane host.
    expect(worker.environments.prod.domain).toBeUndefined();
    expect(worker.environments.staging.domain).toBeUndefined();
    expect(() => domainFor("harness-workers", "prod")).toThrow(
      /malformed\/missing prod domain/,
    );
    expect(() => domainFor("harness-workers", "staging")).toThrow(
      /malformed\/missing staging domain/,
    );
    // Probe disabled in both envs (covered by the control-plane harness probe +
    // the Railway-internal healthcheck).
    expect(probeEnabled("harness-workers", "prod")).toBe(false);
    expect(probeEnabled("harness-workers", "staging")).toBe(false);
    // Runs the shared showcase-harness image; not separately CI-built. As a
    // fully-modeled dual-env service it is now gateValidated (gateIgnore is
    // dropped — both gate directions validate it). The image consumption is
    // modeled explicitly via imageOf so a rebuilt showcase-harness:latest
    // redeploys the worker alongside the scheduler in EVERY env it declares.
    expect(worker.environments.prod.repoName).toBe("showcase-harness");
    expect(worker.environments.staging.repoName).toBe("showcase-harness");
    expect(worker.imageOf).toBe("harness");
    expect(worker.ciBuilt).toBe(false);
    expect(worker.gateValidated).toBe(true);
    expect(worker.gateIgnore).toBeUndefined();
    expect(worker.serviceId).toBe("c2aa8a0b-350e-4b76-8541-3012dfac41d0");
    expect(worker.environments.prod.instanceId).toBe(
      "7c48ee43-6df4-457b-b977-10f1f1ac1680",
    );
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
    expect(() => domainFor("docs", "dev")).toThrow(/has no "dev" environment/);
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

describe("promote-tier SSOT fields", () => {
  it("tags the tier-0 infra services with promoteTier 0", () => {
    for (const key of ["aimock", "pocketbase", "webhooks"]) {
      expect(SERVICES[key].promoteTier).toBe(0);
    }
  });

  it("tags the tier-1 verification services with promoteTier 1", () => {
    for (const key of ["harness", "harness-workers", "dashboard"]) {
      expect(SERVICES[key].promoteTier).toBe(1);
    }
  });

  it("leaves integrations + shells at the default tier 2 (omitted)", () => {
    // Default-2-when-omitted contract: integrations and shells carry no
    // explicit promoteTier.
    for (const key of [
      "showcase-langgraph-python",
      "showcase-mastra",
      "shell",
      "docs",
      "dojo",
    ]) {
      expect(SERVICES[key].promoteTier).toBeUndefined();
    }
  });

  it("declares runtimeDeps: every agent service needs a current aimock", () => {
    for (const [key, entry] of Object.entries(SERVICES)) {
      if (entry.probeDriver !== "agent") continue;
      expect(entry.runtimeDeps).toContain("aimock");
    }
  });

  it("declares the dashboard's runtimeDeps on pocketbase + harness", () => {
    expect(SERVICES.dashboard.runtimeDeps).toEqual(
      expect.arrayContaining(["pocketbase", "harness"]),
    );
  });

  it("declares serviceRefs from each agent at aimock (OPENAI_BASE_URL)", () => {
    const lgp = SERVICES["showcase-langgraph-python"];
    expect(lgp.serviceRefs).toEqual(
      expect.arrayContaining([{ key: "OPENAI_BASE_URL", target: "aimock" }]),
    );
  });

  it("every runtimeDeps / serviceRefs target is an existing SSOT key", () => {
    for (const entry of Object.values(SERVICES)) {
      for (const dep of entry.runtimeDeps ?? []) {
        expect(Object.hasOwn(SERVICES, dep)).toBe(true);
      }
      for (const ref of entry.serviceRefs ?? []) {
        expect(Object.hasOwn(SERVICES, ref.target)).toBe(true);
      }
    }
  });
});

describe("computePromoteClosure", () => {
  it("returns aimock(t0) + harness/workers/dashboard(t1) + langgraph-python(t2) in tier order", () => {
    const plan: ClosurePlan = computePromoteClosure(["langgraph-python"]);
    const names = plan.services.map((s) => s.name);
    // Tier order: 0 before 1 before 2.
    const tiers = plan.services.map((s) => s.tier);
    const sorted = [...tiers].sort((a, b) => a - b);
    expect(tiers).toEqual(sorted);

    // Tier-0 runtime dep (aimock) pulled in for an agent service.
    expect(names).toContain("aimock");
    expect(plan.services.find((s) => s.name === "aimock")?.tier).toBe(0);

    // Tier-1 verification set ALWAYS included.
    expect(names).toContain("harness");
    expect(names).toContain("dashboard");
    for (const t1 of ["harness", "dashboard"]) {
      expect(plan.services.find((s) => s.name === t1)?.tier).toBe(1);
    }

    // The requested integration (resolved from its dispatch_name) at tier 2.
    expect(names).toContain("showcase-langgraph-python");
    expect(
      plan.services.find((s) => s.name === "showcase-langgraph-python")?.tier,
    ).toBe(2);

    // aimock (t0) precedes harness (t1) precedes the integration (t2).
    expect(names.indexOf("aimock")).toBeLessThan(names.indexOf("harness"));
    expect(names.indexOf("harness")).toBeLessThan(
      names.indexOf("showcase-langgraph-python"),
    );
  });

  it("resolves an SSOT key directly as well as a dispatch_name", () => {
    const viaKey = computePromoteClosure(["showcase-langgraph-python"]);
    const viaDispatch = computePromoteClosure(["langgraph-python"]);
    expect(viaKey.services.map((s) => s.name).sort()).toEqual(
      viaDispatch.services.map((s) => s.name).sort(),
    );
  });

  it("always includes the full Tier-1 verification set even for a tier-0-only request", () => {
    const plan = computePromoteClosure(["pocketbase"]);
    const names = plan.services.map((s) => s.name);
    // harness-workers is now prod-promotable Tier-1 (the prod worker was
    // backfilled into the SSOT), so it joins the always-included Tier-1 set
    // alongside harness + dashboard — no longer filtered out.
    expect(names).toEqual(
      expect.arrayContaining(["harness", "harness-workers", "dashboard"]),
    );
    // harness + dashboard + the dual-env worker are prod-promotable Tier-1:
    expect(names).toContain("harness");
    expect(names).toContain("harness-workers");
    expect(names).toContain("dashboard");
  });

  it("promotes the dual-env worker (harness-workers) at Tier-1, never skipping it", () => {
    const plan = computePromoteClosure(["langgraph-python"]);
    const promotableNames = plan.services.map((s) => s.name);
    // harness-workers now declares a `prod` env (backfilled into the SSOT) and
    // is promoteTier:1, so it is PROMOTED alongside the harness control-plane
    // rather than recorded skipped-with-reason.
    expect(promotableNames).toContain("harness-workers");
    expect(plan.services.find((s) => s.name === "harness-workers")?.tier).toBe(
      1,
    );
    // ...and it is NOT in the skipped list (it is no longer prod-less).
    const skipped = plan.skipped.find((s) => s.name === "harness-workers");
    expect(skipped).toBeUndefined();
  });

  it("throws on an unknown requested service (fail loud)", () => {
    expect(() => computePromoteClosure(["does-not-exist"])).toThrow(
      /unknown|not an SSOT key/i,
    );
  });

  it("is pure — repeated calls return equal plans and do not mutate SERVICES", () => {
    const before = JSON.stringify(SERVICES);
    const a = computePromoteClosure(["langgraph-python"]);
    const b = computePromoteClosure(["langgraph-python"]);
    expect(a).toEqual(b);
    expect(JSON.stringify(SERVICES)).toBe(before);
  });

  // --- Standalone services (no deps, never gated) -------------------------
  it("a standalone-only request (docs) promotes ONLY itself — no Tier-1 control plane", () => {
    const plan = computePromoteClosure(["docs"]);
    const names = plan.services.map((s) => s.name);
    // The whole point: requesting docs must NOT drag in harness/dashboard.
    expect(names).toEqual(["docs"]);
    expect(names).not.toContain("harness");
    expect(names).not.toContain("dashboard");
    expect(plan.services.find((s) => s.name === "docs")?.standalone).toBe(true);
  });

  it("resolves the standalone leaf via dispatch_name (shell-docs) too", () => {
    const plan = computePromoteClosure(["shell-docs"]);
    expect(plan.services.map((s) => s.name)).toEqual(["docs"]);
  });

  it("the full-fleet (all) closure marks docs standalone AND still pulls Tier-1 for the rest", () => {
    const plan = computePromoteClosure(Object.keys(SERVICES));
    expect(plan.services.find((s) => s.name === "docs")?.standalone).toBe(true);
    // The non-standalone fleet still gets the Tier-1 control plane.
    expect(plan.services.map((s) => s.name)).toContain("harness");
  });

  it("a mixed request (standalone + normal) still pulls in Tier-1", () => {
    const plan = computePromoteClosure(["docs", "langgraph-python"]);
    const names = plan.services.map((s) => s.name);
    expect(names).toContain("harness"); // forced by the non-standalone member
    expect(names).toContain("docs");
    expect(plan.services.find((s) => s.name === "docs")?.standalone).toBe(true);
  });
});

describe("starter-* fleet SSOT entries (S1: promote-closure inclusion)", () => {
  // The 12 starter-<slug> services GHCR-named ghcr.io/copilotkit/starter-<slug>.
  // Folded into the cluster-promote SSOT at tier 2 so they receive the same
  // dependency-/env-/verification-complete + pinned-prod treatment as the
  // showcase-* demos. The Railway service name (and SSOT key) is the RAW
  // starter slug prefixed with `starter-` — the keys of STARTER_TO_COLUMN.
  const STARTER_KEYS = [
    "starter-adk",
    "starter-agno",
    "starter-crewai-crews",
    "starter-langgraph-fastapi",
    "starter-langgraph-js",
    "starter-langgraph-python",
    "starter-llamaindex",
    "starter-mastra",
    "starter-ms-agent-framework-dotnet",
    "starter-ms-agent-framework-python",
    "starter-pydantic-ai",
    "starter-strands-python",
  ] as const;

  it("registers all 12 starter-* services in the SSOT", () => {
    for (const key of STARTER_KEYS) {
      expect(Object.hasOwn(SERVICES, key), `${key} missing from SERVICES`).toBe(
        true,
      );
    }
  });

  it("every starter carries promoteTier 2, runtimeDeps [aimock] + OPENAI_BASE_URL serviceRef", () => {
    for (const key of STARTER_KEYS) {
      const entry = SERVICES[key];
      expect(entry.promoteTier, `${key}.promoteTier`).toBe(2);
      expect(entry.runtimeDeps, `${key}.runtimeDeps`).toEqual(["aimock"]);
      expect(entry.serviceRefs, `${key}.serviceRefs`).toEqual([
        { key: "OPENAI_BASE_URL", target: "aimock" },
      ]);
    }
  });

  it("every starter is fully gate-managed: ciBuilt, gateValidated, no gateIgnore, dispatchName === key, probeDriver 'starter'", () => {
    // S2 reverses the S1 fence: starters are now treated exactly like a
    // showcase-* agent. They ARE built+pushed by showcase_build.yml's
    // `build-starters` job (ghcr.io/copilotkit/starter-<slug>:latest), so
    // ciBuilt:true; the image-ref gate validates their canonical shape
    // (prod @sha256, staging :latest) in both drift directions, so
    // gateValidated:true and NO gateIgnore. dispatchName === the SSOT key
    // (the starter workflow_dispatch choice value is the bare starter-<slug>;
    // assertDispatchNamesUnique permits a dispatchName equal to its own key).
    // probeDriver "starter" is the S3 contract: the equivalence gate routes
    // these to the harness starter_smoke axis.
    for (const key of STARTER_KEYS) {
      const entry = SERVICES[key];
      expect(entry.ciBuilt, `${key}.ciBuilt`).toBe(true);
      expect(
        entry.gateIgnore === undefined || entry.gateIgnore === false,
        `${key}.gateIgnore`,
      ).toBe(true);
      expect(entry.gateValidated, `${key}.gateValidated`).toBe(true);
      expect(entry.dispatchName, `${key}.dispatchName`).toBe(key);
      expect(entry.probeDriver, `${key}.probeDriver`).toBe("starter");
    }
  });

  it("no starter carries a repoName override (service name === GHCR repo name)", () => {
    // The Railway service name (starter-<slug>) already equals the GHCR repo
    // name, so the gate's default ghcr.io/copilotkit/<serviceName> resolves
    // correctly with no per-env override — mirroring how showcase-* agents
    // (whose names match their GHCR repos) carry no repoName.
    for (const key of STARTER_KEYS) {
      const entry = SERVICES[key];
      expect(entry.environments.prod.repoName, `${key} prod repoName`).toBe(
        undefined,
      );
      expect(
        entry.environments.staging.repoName,
        `${key} staging repoName`,
      ).toBe(undefined);
    }
  });

  it("every starter exists in BOTH envs with prod AND staging probe enabled (always-on)", () => {
    for (const key of STARTER_KEYS) {
      const entry = SERVICES[key];
      expect(Object.keys(entry.environments).sort()).toEqual([
        "prod",
        "staging",
      ]);
      // Starters are always-on + staging-probed like every other managed
      // showcase service: both envs are probed by the verify-deploy baseline
      // driver (resolve-verify-matrix filters on probe.staging===true, so a
      // probed starter now enters the staging matrix). The starter-smoke axis
      // ALSO covers them — orthogonal to the baseline liveness probe here.
      expect(probeEnabled(key, "prod"), `${key} prod probe`).toBe(true);
      expect(probeEnabled(key, "staging"), `${key} staging probe`).toBe(true);
    }
  });

  it("the full-fleet promote closure includes all 12 starters at tier 2", () => {
    // `all` is not itself an SSOT key/dispatchName; the fleet closure is
    // computed over every SSOT key — mirroring emit-railway-envs-json.ts,
    // which builds the top-level `closure` as computePromoteClosure(keys).
    const fleet = computePromoteClosure(Object.keys(SERVICES));
    const tier2 = new Set(
      fleet.services.filter((s) => s.tier === 2).map((s) => s.name),
    );
    for (const key of STARTER_KEYS) {
      expect(
        tier2.has(key),
        `${key} should be tier-2 in the fleet closure`,
      ).toBe(true);
    }
  });
});

describe("assertClosureValid", () => {
  it("passes for the real SSOT (a normal closure with a full Tier-1 set)", () => {
    expect(() => assertClosureValid(["langgraph-python"])).not.toThrow();
  });

  it("throws when the SSOT carries no Tier-1 verification services", () => {
    const noTier1 = {
      aimock: { promoteTier: 0, environments: { prod: {}, staging: {} } },
      "showcase-x": {
        environments: { prod: {}, staging: {} },
        runtimeDeps: ["aimock"],
      },
    } as unknown as typeof SERVICES;
    expect(() => assertClosureValid(["showcase-x"], noTier1)).toThrow(
      /tier-1|tier 1/i,
    );
  });

  it("throws when a member's runtimeDeps names a missing SSOT key", () => {
    const danglingDep = {
      aimock: { promoteTier: 0, environments: { prod: {}, staging: {} } },
      harness: { promoteTier: 1, environments: { prod: {}, staging: {} } },
      dashboard: { promoteTier: 1, environments: { prod: {}, staging: {} } },
      "showcase-x": {
        environments: { prod: {}, staging: {} },
        runtimeDeps: ["ghost"],
      },
    } as unknown as typeof SERVICES;
    expect(() => assertClosureValid(["showcase-x"], danglingDep)).toThrow(
      /ghost|not an SSOT key|missing/i,
    );
  });

  it("throws when the computed closure has no promotable services", () => {
    // A Tier-1 service exists (so the missing-Tier-1 clause passes), but it
    // is the ONLY entry and it has no prod env → every closure member is
    // skipped-with-reason and `services` is empty. Refuse to promote nothing.
    const allProdless = {
      harness: { promoteTier: 1, environments: { staging: {} } },
    } as unknown as typeof SERVICES;
    expect(() => assertClosureValid(["harness"], allProdless)).toThrow(
      /empty|promote nothing/i,
    );
  });
});

describe("autoUpdates deploy-consolidation policy (per-env, staging-first)", () => {
  // Railway `source.autoUpdates.type = "minor"` is the ENABLED form (Railway
  // watches the GHCR registry and auto-redeploys on a new push); the SSOT
  // target is "disabled" so the ONLY deploy path is the CI-explicit redeploy.
  // autoUpdates is now PER-ENV to support a staging-first rollout: STAGING is
  // enforced "disabled" (its live config is being flipped to disabled), while
  // PROD is "unmanaged" — NOT yet under drift-gate management (its live
  // autoUpdates are heterogeneous and must be left untouched until a later
  // migration). The sibling drift gate ENFORCES the concrete-"disabled" envs
  // and SKIPS the "unmanaged" ones.
  it("every service declares staging 'disabled' and prod 'unmanaged'", () => {
    for (const [name, entry] of Object.entries(SERVICES)) {
      const au = (entry as { autoUpdates?: Record<string, string> })
        .autoUpdates;
      expect(
        au?.staging,
        `${name}.autoUpdates.staging must be "disabled" (staging is under drift-gate management; CI-explicit redeploy only)`,
      ).toBe("disabled");
      expect(
        au?.prod,
        `${name}.autoUpdates.prod must be "unmanaged" (prod not yet migrated; drift gate skips it)`,
      ).toBe("unmanaged");
    }
  });

  it("the generated JSON carries per-env autoUpdates (staging disabled, prod unmanaged)", () => {
    const generated = JSON.parse(
      readFileSync(resolve(__dirname, "./railway-envs.generated.json"), "utf8"),
    ) as {
      services: Array<{
        name: string;
        autoUpdates?: { staging?: string; prod?: string };
      }>;
    };
    expect(generated.services.length).toBeGreaterThan(0);
    for (const svc of generated.services) {
      expect(
        svc.autoUpdates?.staging,
        `generated ${svc.name}.autoUpdates.staging must be "disabled"`,
      ).toBe("disabled");
      expect(
        svc.autoUpdates?.prod,
        `generated ${svc.name}.autoUpdates.prod must be "unmanaged"`,
      ).toBe("unmanaged");
    }
  });
});
