import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findMissingServices,
  runRailwayImageGate,
  validateImage,
} from "./verify-railway-image-refs";
import {
  SERVICES,
  PROJECT_ID,
  PRODUCTION_ENV_ID,
  ENV_ID_BY_NAME,
  repoNameFor,
} from "./railway-envs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  RunRecord,
  RailwayLifecyclePolicy,
} from "../harness/src/shared/railway-lifecycle";
import type { ProjectServicesWithInstances } from "./verify-railway-image-refs";

const ALL_GATE_VALIDATED = Object.entries(SERVICES)
  .filter(([, e]) => e.gateValidated)
  .map(([name]) => name);

describe("validateImage — production env", () => {
  it("accepts a digest-pinned ghcr ref matching the service name", () => {
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-mastra@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-mastra" },
    );
    expect(v).toBeNull();
  });

  it("rejects :latest in prod", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-mastra:latest", {
      env: "prod",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/digest/i);
  });

  it("rejects a digest with the wrong repo name in prod", () => {
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-ag2@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-mastra" },
    );
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/repo name/i);
  });

  it("rejects a non-ghcr ref in prod", () => {
    const v = validateImage(
      "docker.io/library/nginx@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-mastra" },
    );
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/canonical shape/i);
  });

  it("rejects an unset image in prod", () => {
    const v = validateImage(null, { env: "prod", repoName: "showcase-mastra" });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/no image/i);
  });

  it("honors the showcase-aimock wrapper override in prod", () => {
    // Aimock prod is digest-pinned to the WRAPPER repo `showcase-aimock`
    // (the fixture-baking wrapper is the permanent, canonical aimock
    // showcase image in BOTH envs). The SSOT expresses this via
    // repoNameOverride.prod = "showcase-aimock".
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-aimock@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-aimock" },
    );
    expect(v).toBeNull();
  });

  it("rejects the unwrapped aimock repo in prod (wrapper is the canonical image)", () => {
    // Inverse of the above: a digest pin against the unwrapped
    // `aimock` repo in prod must be flagged as a repo-name mismatch,
    // because the canonical aimock showcase image is the wrapper.
    const v = validateImage(
      "ghcr.io/copilotkit/aimock@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-aimock" },
    );
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/repo name/i);
  });
});

describe("validateImage — staging env", () => {
  it("accepts :latest in staging", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-mastra:latest", {
      env: "staging",
      repoName: "showcase-mastra",
    });
    expect(v).toBeNull();
  });

  it("rejects a digest in staging", () => {
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-mastra@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "staging", repoName: "showcase-mastra" },
    );
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/:latest/);
  });

  it("rejects :latest with wrong repo name in staging", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-ag2:latest", {
      env: "staging",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/repo name/i);
  });

  it("rejects a non-ghcr ref in staging", () => {
    const v = validateImage("docker.io/library/nginx:latest", {
      env: "staging",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/not on ghcr\.io\/copilotkit/i);
  });

  it("honors the showcase-aimock wrapper override in staging too", () => {
    // The aimock entry has the `showcase-aimock` wrapper override in BOTH
    // envs (the fixture-baking wrapper is the permanent, canonical aimock
    // showcase image — no migration narrative). Staging floats :latest
    // on the wrapper repo and must validate cleanly; the bare unwrapped
    // `aimock:latest` ref must be rejected as a repo-name mismatch.
    const ok = validateImage("ghcr.io/copilotkit/showcase-aimock:latest", {
      env: "staging",
      repoName: "showcase-aimock",
    });
    expect(ok).toBeNull();

    const bad = validateImage("ghcr.io/copilotkit/aimock:latest", {
      env: "staging",
      repoName: "showcase-aimock",
    });
    expect(bad).not.toBeNull();
    expect(bad!.reason).toMatch(/repo name/i);
  });
});

describe("validateImage — pocketbase (first-party, non-CI-built)", () => {
  // pocketbase Railway service → ghcr.io/copilotkit/showcase-pocketbase
  // override applies in BOTH envs.

  it("accepts the prod digest pin", () => {
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-pocketbase@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-pocketbase" },
    );
    expect(v).toBeNull();
  });

  it("accepts the staging :latest tag", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-pocketbase:latest", {
      env: "staging",
      repoName: "showcase-pocketbase",
    });
    expect(v).toBeNull();
  });

  it("rejects :latest in prod", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-pocketbase:latest", {
      env: "prod",
      repoName: "showcase-pocketbase",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/digest/i);
  });
});

describe("validateImage — webhooks (first-party, non-CI-built)", () => {
  // webhooks Railway service → ghcr.io/copilotkit/showcase-eval-webhook
  // override applies in BOTH envs.

  it("accepts the prod digest pin", () => {
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-eval-webhook@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-eval-webhook" },
    );
    expect(v).toBeNull();
  });

  it("accepts the staging :latest tag", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-eval-webhook:latest", {
      env: "staging",
      repoName: "showcase-eval-webhook",
    });
    expect(v).toBeNull();
  });

  it("rejects :latest in prod", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-eval-webhook:latest", {
      env: "prod",
      repoName: "showcase-eval-webhook",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/digest/i);
  });
});

describe("validateImage — generic non-canonical prod tags", () => {
  // Per nit #5: a prod ref that is neither `:latest` nor `@sha256:<hex>`
  // — e.g. a mutable arch-tag like `:latest-arm64` or a git-SHA tag like
  // `:abc123` — must hit the "not canonical prod shape" branch (NOT the
  // `:latest` branch).

  it("rejects a prod ref tagged with a non-latest arch suffix", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-mastra:latest-arm64", {
      env: "prod",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/canonical prod shape/i);
    expect(v!.reason).not.toMatch(/^prod must be pinned to/);
  });

  it("rejects a prod ref tagged with a short git SHA", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-mastra:abc123", {
      env: "prod",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/canonical prod shape/i);
  });
});

describe("findMissingServices — coverage assertion", () => {
  // The gate must fail loudly when a gateValidated SSOT service is
  // missing from the Railway response. Today the main() loop silently
  // skips missing services because it only iterates what Railway returns.

  it("returns [] when every gateValidated service is present", () => {
    const present = new Set(ALL_GATE_VALIDATED);
    expect(findMissingServices("prod", present)).toEqual([]);
    expect(findMissingServices("staging", present)).toEqual([]);
  });

  it("returns the omitted gateValidated service name when one is missing", () => {
    const omitted = "showcase-mastra";
    const present = new Set(ALL_GATE_VALIDATED.filter((n) => n !== omitted));
    expect(findMissingServices("prod", present)).toEqual([omitted]);
    expect(findMissingServices("staging", present)).toEqual([omitted]);
  });

  it("returns multiple omitted names sorted, in either env", () => {
    const omitted = ["showcase-mastra", "showcase-ag2", "pocketbase"];
    const present = new Set(
      ALL_GATE_VALIDATED.filter((n) => !omitted.includes(n)),
    );
    const expected = [...omitted].sort();
    expect(findMissingServices("prod", present)).toEqual(expected);
    expect(findMissingServices("staging", present)).toEqual(expected);
  });

  it("does NOT require non-gateValidated SSOT entries (no false positives)", () => {
    // dashboard/docs/dojo/harness/shell are SSOT entries but
    // gateValidated:false — they must not be reported missing.
    const present = new Set(ALL_GATE_VALIDATED);
    const missing = findMissingServices("prod", present);
    for (const nonGV of ["dashboard", "docs", "dojo", "harness", "shell"]) {
      expect(missing).not.toContain(nonGV);
    }
  });

  it("ignores unknown service names in the present set", () => {
    // A Railway-side service unknown to SSOT must not affect coverage.
    const present = new Set([...ALL_GATE_VALIDATED, "some-future-service"]);
    expect(findMissingServices("prod", present)).toEqual([]);
  });
});

describe("validateImage — clearer staging violation messages (bucket b)", () => {
  it("non-ghcr staging image identifies the wrong registry/repo", () => {
    const v = validateImage("docker.io/library/nginx:latest", {
      env: "staging",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/not on ghcr\.io\/copilotkit/i);
    expect(v!.reason).toContain("docker.io/library/nginx:latest");
  });

  it("staging digest pin says staging must float on :latest", () => {
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-mastra@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "staging", repoName: "showcase-mastra" },
    );
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/staging must float on :latest/i);
    expect(v!.reason).toMatch(/@sha256:/);
  });

  it("staging ghcr ref that is not :latest says so explicitly", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-mastra:abc123", {
      env: "staging",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/not the `:latest`/i);
  });
});

describe("validateImage — empty-string image rendering (bucket b)", () => {
  it("treats empty-string image as unset (no image)", () => {
    const v = validateImage("", { env: "prod", repoName: "showcase-mastra" });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/no image/i);
    // Normalized so the reporter renders `<unset>`, not a blank line.
    expect(v!.image).toBeNull();
  });
});

const NOW = new Date("2026-10-08T12:15:00Z");
const PIN = `ghcr.io/copilotkit/intelligence/api@sha256:${"a".repeat(64)}`;
const OTHER_PIN = `docker.io/library/redis@sha256:${"b".repeat(64)}`;
const POLICY: RailwayLifecyclePolicy = {
  projectId: PROJECT_ID,
  forbiddenEnvironmentIds: [PRODUCTION_ENV_ID],
  permanentServices: Object.entries(SERVICES).map(([name, entry]) => ({
    name,
    serviceId: entry.serviceId,
  })),
  approvedImages: [PIN, OTHER_PIN],
};

/** A full project response with every required permanent instance. */
function permanentInventory(): ProjectServicesWithInstances {
  return {
    project: {
      services: {
        edges: Object.entries(SERVICES)
          .filter(([, entry]) => entry.gateValidated)
          .map(([name, entry]) => ({
            node: {
              id: entry.serviceId,
              name,
              serviceInstances: {
                edges: Object.keys(entry.environments).map((env) => ({
                  node: {
                    environmentId: ENV_ID_BY_NAME[env],
                    source: {
                      image: `ghcr.io/copilotkit/${repoNameFor(name, env)}${env === "staging" ? ":latest" : `@sha256:${"a".repeat(64)}`}`,
                    },
                  },
                })),
              },
            },
          })),
      },
    },
  };
}

/** Fictitious exact provider ownership, never a live resource. */
function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "fixture-run",
    projectId: PROJECT_ID,
    environmentId: "fixture-env",
    startedAt: "2026-10-08T12:00:00Z",
    expiresAt: "2026-10-08T13:00:00Z",
    phase: "ready",
    services: [
      {
        name: "showcase-disposable-api",
        serviceId: "fixture-api",
        expectedImage: PIN,
      },
    ],
    resources: [],
    ...overrides,
  };
}

/** Add a provider service, retaining its exact ID and all environment instances. */
function addService(
  data: ProjectServicesWithInstances,
  name = "showcase-disposable-api",
  id = "fixture-api",
  environments = ["fixture-env"],
  image: string | null = PIN,
): void {
  data.project!.services.edges.push({
    node: {
      name,
      id,
      serviceInstances: {
        edges: environments.map((environmentId) => ({
          node: { environmentId, source: { image } },
        })),
      },
    },
  });
}

/** Publish a local atomic-snapshot fixture and drive the same runner as main. */
async function withRecords(
  data: ProjectServicesWithInstances,
  runs: RunRecord[],
  now = NOW,
) {
  const dir = await mkdtemp(join(tmpdir(), "image-gate-"));
  try {
    const recordsFile = join(dir, "records.json");
    await writeFile(recordsFile, JSON.stringify({ schemaVersion: 1, runs }));
    return await runRailwayImageGate({
      data,
      recordsFile,
      now,
      policy: POLICY,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("image gate runner lifecycle orchestration", () => {
  it("keeps no-run permanent checks and optional Intelligence absence unchanged", async () => {
    const result = await withRecords(permanentInventory(), []);
    expect(result.summary.shouldFail).toBe(false);
    expect(result.missingByEnv).toEqual({ prod: [], staging: [] });
  });

  it("unset evidence preserves permanent behavior but grants no disposable exemption", async () => {
    const data = permanentInventory();
    expect(
      (await runRailwayImageGate({ data, now: NOW })).summary.shouldFail,
    ).toBe(false);
    addService(data);
    const result = await runRailwayImageGate({ data, now: NOW });
    expect(result.untracked).toEqual(["showcase-disposable-api"]);
    expect(result.summary.shouldFail).toBe(true);
  });

  it("the committed empty approval list refuses a record that approves its own pin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "image-gate-empty-policy-"));
    try {
      const recordsFile = join(dir, "records.json");
      await writeFile(
        recordsFile,
        JSON.stringify({ schemaVersion: 1, runs: [runRecord()] }),
      );
      const data = permanentInventory();
      addService(data);
      const result = await runRailwayImageGate({ data, recordsFile, now: NOW });
      expect(result.lifecycle.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "unapproved-image" }),
        ]),
      );
      expect(result.lifecycle.excludedServices).toEqual([]);
      expect(result.summary.shouldFail).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignored permanent instances keep their independent image policy", async () => {
    const data = permanentInventory();
    const name = "showcase-intelligence-api";
    addService(
      data,
      name,
      SERVICES[name].serviceId,
      [ENV_ID_BY_NAME.staging],
      OTHER_PIN,
    );
    const result = await withRecords(data, []);
    expect(result.summary.shouldFail).toBe(false);
    expect(result.skipped).toBe(1);
  });

  it("still fails a required permanent service missing in one environment", async () => {
    const data = permanentInventory();
    data.project!.services.edges.find(
      ({ node }) => node.name === "showcase-mastra",
    )!.node.serviceInstances.edges = [];
    const result = await withRecords(data, [
      runRecord({ phase: "setup", services: [] }),
    ]);
    expect(result.missingByEnv.staging).toContain("showcase-mastra");
    expect(result.summary.shouldFail).toBe(true);
  });

  it.each(["setup", "ready", "teardown"] as const)(
    "accepts exact owned %s instances without permanent image-shape checks",
    async (phase) => {
      const data = permanentInventory();
      addService(data);
      const result = await withRecords(data, [runRecord({ phase })]);
      expect(result.untracked).toEqual([]);
      expect(result.summary.shouldFail).toBe(false);
      expect(result.lifecycle.excludedServices).toEqual([
        {
          projectId: PROJECT_ID,
          environmentId: "fixture-env",
          serviceId: "fixture-api",
        },
      ]);
    },
  );

  it("accepts partial setup and teardown absence", async () => {
    for (const phase of ["setup", "teardown"] as const) {
      expect(
        (await withRecords(permanentInventory(), [runRecord({ phase })]))
          .summary.shouldFail,
      ).toBe(false);
    }
  });

  it("rejects a different approved pin while retaining ownership exclusion", async () => {
    const data = permanentInventory();
    addService(data, undefined, undefined, undefined, OTHER_PIN);
    const result = await withRecords(data, [runRecord()]);
    expect(result.lifecycle.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "image-mismatch" }),
      ]),
    );
    expect(result.summary.shouldFail).toBe(true);
    expect(result.lifecycle.excludedServices).toHaveLength(1);
  });

  it("reports ready disappearance from a fully queried recorded environment", async () => {
    const result = await withRecords(permanentInventory(), [runRecord()]);
    expect(result.lifecycle.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ready-service-missing" }),
      ]),
    );
    expect(result.summary.shouldFail).toBe(true);
  });

  it("reports expired leftovers", async () => {
    const data = permanentInventory();
    addService(data);
    const result = await withRecords(
      data,
      [runRecord()],
      new Date("2026-10-08T13:01:00Z"),
    );
    expect(result.lifecycle.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "leftover-service" }),
      ]),
    );
    expect(result.summary.shouldFail).toBe(true);
  });

  it("rejects same-prefix unrecorded resources and replacement IDs", async () => {
    const data = permanentInventory();
    addService(data, undefined, "replacement-id");
    addService(data, "showcase-disposable-unrecorded", "unrecorded-id");
    const result = await withRecords(data, [runRecord()]);
    expect(result.untracked).toEqual([
      "showcase-disposable-api",
      "showcase-disposable-unrecorded",
    ]);
    expect(result.lifecycle.excludedServices).toEqual([]);
  });

  it("does not exempt the owned ID in an additional environment or its unknown neighbor", async () => {
    const data = permanentInventory();
    addService(data, undefined, undefined, [
      "fixture-env",
      ENV_ID_BY_NAME.staging,
    ]);
    addService(data, "unknown-neighbor", "neighbor");
    const result = await withRecords(data, [runRecord()]);
    expect(result.lifecycle.excludedServices).toHaveLength(1);
    expect(result.untracked).toEqual([
      "showcase-disposable-api",
      "unknown-neighbor",
    ]);
    expect(result.summary.shouldFail).toBe(true);
  });

  it("keeps unknown project services visible when they have zero instances", async () => {
    const data = permanentInventory();
    addService(data, "no-instances", "empty", []);
    const result = await withRecords(data, []);
    expect(result.untracked).toEqual(["no-instances"]);
    expect(result.summary.shouldFail).toBe(true);
  });

  it("does not infer environment ownership for a recorded project service with zero instances", async () => {
    const data = permanentInventory();
    addService(data, undefined, undefined, []);
    const result = await withRecords(data, [runRecord({ phase: "setup" })]);
    expect(result.untracked).toEqual(["showcase-disposable-api"]);
    expect(result.summary.shouldFail).toBe(true);
  });

  it("rejects permanent name replacement even with a canonical image", async () => {
    const data = permanentInventory();
    data.project!.services.edges.find(
      ({ node }) => node.name === "showcase-mastra",
    )!.node.id = "replacement";
    const result = await withRecords(data, []);
    expect(result.summary.shouldFail).toBe(true);
    expect(result.untracked).toContain("showcase-mastra");
    expect(result.missingByEnv.staging).toContain("showcase-mastra");
  });

  it("preserves the starter carveout except for mismatched disposable claims", async () => {
    const data = permanentInventory();
    addService(data, "starter-future", "replacement");
    const ordinary = await withRecords(data, [
      runRecord({ environmentId: "other-env", phase: "setup", services: [] }),
    ]);
    expect(ordinary.summary.shouldFail).toBe(false);
    expect(ordinary.untracked).toEqual([]);
    expect(ordinary.lifecycle.failures).toEqual([]);
    const result = await withRecords(data, [
      runRecord({
        services: [
          { name: "starter-future", serviceId: "recorded", expectedImage: PIN },
        ],
      }),
    ]);
    expect(result.summary.shouldFail).toBe(true);
    expect(result.untracked).toContain("starter-future");
    expect(result.lifecycle.failures).toContainEqual(
      expect.objectContaining({
        code: "ready-service-missing",
        serviceId: "recorded",
      }),
    );
    expect(result.missingByEnv).toEqual({ prod: [], staging: [] });
  });

  it.each([null, PIN])(
    "rejects an unclaimed recorded-environment starter with image %s even when its ordinary instance is tolerated",
    async (image) => {
      const data = permanentInventory();
      const name = "starter-unrecorded";
      const serviceId = "unrecorded-id";
      addService(
        data,
        name,
        serviceId,
        [ENV_ID_BY_NAME.staging, "fixture-env"],
        image,
      );
      const result = await withRecords(data, [
        runRecord({ phase: "setup", services: [], resources: [] }),
      ]);

      expect.soft(result.summary.shouldFail).toBe(true);
      expect.soft(result.untracked).toEqual([name]);
      expect.soft(result.lifecycle.failures).toEqual([
        expect.objectContaining({
          code: "unknown-service",
          serviceId,
          environmentId: "fixture-env",
        }),
      ]);
      expect(result.missingByEnv).toEqual({ prod: [], staging: [] });
      expect(result.lifecycle.excludedServices).toEqual([]);
    },
  );

  it("excludes an exactly recorded valid disposable starter", async () => {
    const data = permanentInventory();
    const name = "starter-owned";
    addService(data, name);
    const result = await withRecords(data, [
      runRecord({
        services: [{ name, serviceId: "fixture-api", expectedImage: PIN }],
      }),
    ]);

    expect(result.summary.shouldFail).toBe(false);
    expect(result.untracked).toEqual([]);
    expect(result.lifecycle.failures).toEqual([]);
    expect(result.lifecycle.excludedServices).toEqual([
      {
        projectId: PROJECT_ID,
        environmentId: "fixture-env",
        serviceId: "fixture-api",
      },
    ]);
  });

  it("rejects a permanent service ID renamed into the starter carveout", async () => {
    const data = permanentInventory();
    const name = "starter-renamed-intelligence-api";
    const serviceId = SERVICES["showcase-intelligence-api"].serviceId;
    addService(data, name, serviceId, [ENV_ID_BY_NAME.staging], OTHER_PIN);

    const result = await withRecords(data, []);

    expect(result.summary.shouldFail).toBe(true);
    expect(result.untracked).toContain(name);
    expect(result.lifecycle.failures).toContainEqual(
      expect.objectContaining({
        code: "unknown-service",
        serviceId,
        environmentId: ENV_ID_BY_NAME.staging,
      }),
    );
    expect(result.missingByEnv).toEqual({ prod: [], staging: [] });
  });

  it("configured evidence read failure fails even when all permanent services pass", async () => {
    const result = await runRailwayImageGate({
      data: permanentInventory(),
      recordsFile: "/nonexistent/pni-607-records.json",
      now: NOW,
      policy: POLICY,
    });
    expect(result.summary.shouldFail).toBe(true);
    expect(result.lifecycle.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "records-unreadable" }),
      ]),
    );
  });

  it("rejects contradictory permanent flags at runner entry", async () => {
    const entry = SERVICES["showcase-mastra"];
    try {
      entry.gateIgnore = true;
      await expect(
        runRailwayImageGate({ data: permanentInventory() }),
      ).rejects.toThrow(/gateValidated.*gateIgnore/);
    } finally {
      delete entry.gateIgnore;
    }
  });
});

describe("image gate CLI offline wiring", () => {
  it("prints unavailable evidence diagnostics from the actual main runner", async () => {
    const dir = await mkdtemp(join(tmpdir(), "image-gate-cli-"));
    try {
      const preload = join(dir, "preload.mjs");
      await writeFile(
        preload,
        `globalThis.fetch = async () => ({ ok: true, json: async () => (${JSON.stringify({ data: permanentInventory() })}) });`,
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        RAILWAY_TOKEN: "fixture-token",
      };
      delete env.SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE;
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "--import",
          preload,
          fileURLToPath(
            new URL("./verify-railway-image-refs.ts", import.meta.url),
          ),
        ],
        { env },
      );
      expect(result.stdout).toContain("[lifecycle:evidence-unavailable]");
      expect(result.stdout).toContain("env-scoped instances verified");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads configured records from the environment and refuses unreadable evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "image-gate-cli-"));
    try {
      const preload = join(dir, "preload.mjs");
      await writeFile(
        preload,
        `globalThis.fetch = async () => ({ ok: true, json: async () => (${JSON.stringify({ data: permanentInventory() })}) });`,
      );
      await expect(
        promisify(execFile)(
          process.execPath,
          [
            "--import",
            "tsx",
            "--import",
            preload,
            fileURLToPath(
              new URL("./verify-railway-image-refs.ts", import.meta.url),
            ),
          ],
          {
            env: {
              ...process.env,
              RAILWAY_TOKEN: "fixture-token",
              SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE: join(dir, "missing.json"),
            },
          },
        ),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("records-unreadable"),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
