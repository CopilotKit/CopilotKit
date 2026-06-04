/**
 * Tests for the starter-fleet Railway provisioner
 * (`provision-starter-fleet.ts`).
 *
 * Style note (mirrors redeploy-env / verify-railway-image-refs tests): the
 * Railway GraphQL API is the only impure surface, and it is dependency-
 * injected as a `RailwayGqlFn`. We exercise the pure derivation/credential
 * helpers and the idempotent provisioning core against a recording mock —
 * no live Railway calls, no `fetch` stubbing. Railway is an external
 * boundary, so a plain recording mock is appropriate (aimock is only for
 * LLM calls).
 */

import { describe, it, expect, vi } from "vitest";
import {
  deriveStarterTargets,
  fetchExistingServices,
  provisionStarterFleet,
  resolveRegistryCredentials,
  STARTER_FLEET_PREFIX,
  STARTER_HEALTHCHECK_PATH,
  STARTER_REGION,
} from "../provision-starter-fleet";
import type { RailwayGqlFn, StarterTarget } from "../provision-starter-fleet";
import { STARTER_TO_COLUMN } from "../../harness/src/probes/helpers/starter-mapping";
import { STAGING_ENV_ID, PRODUCTION_ENV_ID } from "../railway-envs";

const PROJECT = "proj-test-id";

// ── Target derivation ───────────────────────────────────────────────────

describe("deriveStarterTargets", () => {
  it("derives exactly the 12 starters from the STARTER_TO_COLUMN SSOT", () => {
    const targets = deriveStarterTargets();
    expect(targets).toHaveLength(12);
    expect(targets.length).toBe(Object.keys(STARTER_TO_COLUMN).length);
  });

  it("uses the RAW starter slug for service name + image (NOT the remapped column slug)", () => {
    const targets = deriveStarterTargets();
    const byName = new Map(targets.map((t) => [t.serviceName, t]));

    // adk -> column "google-adk", but the service/image use raw "adk".
    const adk = byName.get("starter-adk");
    expect(adk, "starter-adk must be present").toBeDefined();
    expect(adk!.image).toBe("ghcr.io/copilotkit/starter-adk:latest");
    // The remapped column slug must NOT leak into the service name.
    expect(byName.has("starter-google-adk")).toBe(false);

    // langgraph-js -> column "langgraph-typescript"; raw slug wins.
    const lgjs = byName.get("starter-langgraph-js");
    expect(lgjs, "starter-langgraph-js must be present").toBeDefined();
    expect(lgjs!.image).toBe("ghcr.io/copilotkit/starter-langgraph-js:latest");
    expect(byName.has("starter-langgraph-typescript")).toBe(false);
  });

  it("derives the full expected name + image set for all 12", () => {
    const targets = deriveStarterTargets();
    const names = targets.map((t) => t.serviceName).sort();
    expect(names).toEqual(
      [
        "adk",
        "agno",
        "crewai-crews",
        "langgraph-fastapi",
        "langgraph-js",
        "langgraph-python",
        "llamaindex",
        "mastra",
        "ms-agent-framework-dotnet",
        "ms-agent-framework-python",
        "pydantic-ai",
        "strands-python",
      ]
        .map((s) => `${STARTER_FLEET_PREFIX}${s}`)
        .sort(),
    );
    for (const t of targets) {
      expect(t.image).toBe(`ghcr.io/copilotkit/${t.serviceName}:latest`);
    }
  });

  it("derives from an injected mapping (pure)", () => {
    const targets = deriveStarterTargets({ foo: "bar", baz: "qux" });
    expect(targets.map((t) => t.serviceName)).toEqual([
      "starter-baz",
      "starter-foo",
    ]);
  });
});

// ── Registry credentials ────────────────────────────────────────────────

describe("resolveRegistryCredentials", () => {
  it("returns undefined when GITHUB_TOKEN is unset", () => {
    expect(resolveRegistryCredentials({})).toBeUndefined();
  });

  it("uses GHCR_USERNAME (preferred) as the username", () => {
    expect(
      resolveRegistryCredentials({
        GITHUB_TOKEN: "ghp_x",
        GHCR_USERNAME: "ck-bot",
        GITHUB_ACTOR: "some-actor",
      }),
    ).toEqual({ username: "ck-bot", password: "ghp_x" });
  });

  it("falls back to GITHUB_ACTOR when GHCR_USERNAME is unset", () => {
    expect(
      resolveRegistryCredentials({
        GITHUB_TOKEN: "ghp_x",
        GITHUB_ACTOR: "ci-actor",
      }),
    ).toEqual({ username: "ci-actor", password: "ghp_x" });
  });

  it("throws (fail loud) when a token is present but no username is available", () => {
    expect(() => resolveRegistryCredentials({ GITHUB_TOKEN: "ghp_x" })).toThrow(
      /no GHCR username/i,
    );
  });
});

// ── Recording GraphQL mock ──────────────────────────────────────────────

interface Call {
  query: string;
  variables: Record<string, unknown>;
}

/**
 * Build a recording RailwayGqlFn. `projectServices` is the existing-services
 * response (defaults to an empty project). serviceCreate returns a synthetic
 * id derived from the requested name; serviceDomainCreate returns a synthetic
 * domain. All calls are recorded for assertion.
 */
function makeMockGql(
  projectServices: Array<{
    id: string;
    name: string;
    stagingDomain?: string;
  }> = [],
): { gql: RailwayGqlFn; calls: Call[] } {
  const calls: Call[] = [];
  let createSeq = 0;

  const gql: RailwayGqlFn = vi.fn(
    async <T = unknown>(
      query: string,
      variables: Record<string, unknown> = {},
    ): Promise<T> => {
      calls.push({ query, variables });

      if (query.includes("project(id:")) {
        return {
          project: {
            services: {
              edges: projectServices.map((s) => ({
                node: {
                  id: s.id,
                  name: s.name,
                  serviceInstances: {
                    edges: [
                      {
                        node: {
                          environmentId: STAGING_ENV_ID,
                          domains: {
                            serviceDomains: s.stagingDomain
                              ? [{ domain: s.stagingDomain }]
                              : [],
                          },
                        },
                      },
                    ],
                  },
                },
              })),
            },
          },
        } as T;
      }

      if (query.includes("serviceCreate(")) {
        const input = variables.input as { name: string };
        createSeq += 1;
        return {
          serviceCreate: { id: `new-svc-${createSeq}`, name: input.name },
        } as T;
      }

      if (query.includes("serviceInstanceUpdate(")) {
        return { serviceInstanceUpdate: true } as T;
      }

      if (query.includes("serviceDomainCreate(")) {
        const input = variables.input as { serviceId: string };
        return {
          serviceDomainCreate: {
            domain: `${input.serviceId}.up.railway.app`,
          },
        } as T;
      }

      throw new Error(`unexpected query in mock:\n${query}`);
    },
  ) as RailwayGqlFn;

  return { gql, calls };
}

const TWO_TARGETS: StarterTarget[] = [
  {
    slug: "mastra",
    serviceName: "starter-mastra",
    image: "ghcr.io/copilotkit/starter-mastra:latest",
  },
  {
    slug: "adk",
    serviceName: "starter-adk",
    image: "ghcr.io/copilotkit/starter-adk:latest",
  },
];

/** No-op sleep so retry-bearing tests don't actually wait. */
const NO_SLEEP = async (): Promise<void> => {};

// ── fetchExistingServices ───────────────────────────────────────────────

describe("fetchExistingServices", () => {
  it("indexes services by name and detects staging domains", async () => {
    const { gql } = makeMockGql([
      {
        id: "svc-a",
        name: "starter-mastra",
        stagingDomain: "m.up.railway.app",
      },
      { id: "svc-b", name: "starter-adk" },
    ]);
    const map = await fetchExistingServices(gql, PROJECT, STAGING_ENV_ID);
    expect(map.get("starter-mastra")).toEqual({
      id: "svc-a",
      hasStagingDomain: true,
    });
    expect(map.get("starter-adk")).toEqual({
      id: "svc-b",
      hasStagingDomain: false,
    });
  });

  it("throws when the project is null (bad id / no access)", async () => {
    const gql: RailwayGqlFn = vi.fn(async () => ({ project: null })) as never;
    await expect(
      fetchExistingServices(gql, PROJECT, STAGING_ENV_ID),
    ).rejects.toThrow(/returned null/);
  });
});

// ── provisionStarterFleet: create path ──────────────────────────────────

describe("provisionStarterFleet — create path", () => {
  it("creates services with the correct GHCR image source", async () => {
    const { gql, calls } = makeMockGql();
    const summary = await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: TWO_TARGETS,
    });

    expect(summary.records.map((r) => r.action)).toEqual([
      "created",
      "created",
    ]);

    const creates = calls.filter((c) => c.query.includes("serviceCreate("));
    expect(creates).toHaveLength(2);
    const createInputs = creates.map(
      (c) =>
        c.variables.input as {
          name: string;
          environmentId: string;
          source: { image: string };
        },
    );
    expect(createInputs[0]).toMatchObject({
      projectId: PROJECT,
      name: "starter-mastra",
      source: { image: "ghcr.io/copilotkit/starter-mastra:latest" },
    });
    expect(createInputs[1]).toMatchObject({
      name: "starter-adk",
      source: { image: "ghcr.io/copilotkit/starter-adk:latest" },
    });
    // CRITICAL: serviceCreate MUST scope the new instance to the STAGING
    // env — without environmentId Railway materializes the instance in the
    // default (production) environment, leaking a prod instance per starter.
    for (const ci of createInputs) {
      expect(ci.environmentId).toBe(STAGING_ENV_ID);
      expect(ci.environmentId).not.toBe(PRODUCTION_ENV_ID);
    }
  });

  it("sets sleepApplication:true + healthcheck '/' + region us-west1 on the staging instance", async () => {
    const { gql, calls } = makeMockGql();
    await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: TWO_TARGETS,
    });

    const updates = calls.filter((c) =>
      c.query.includes("serviceInstanceUpdate("),
    );
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      // ALWAYS targets the staging env — never prod.
      expect(u.variables.environmentId).toBe(STAGING_ENV_ID);
      expect(u.variables.environmentId).not.toBe(PRODUCTION_ENV_ID);
      const input = u.variables.input as Record<string, unknown>;
      expect(input.sleepApplication).toBe(true);
      expect(input.healthcheckPath).toBe(STARTER_HEALTHCHECK_PATH);
      expect(input.healthcheckPath).toBe("/");
      expect(input.region).toBe(STARTER_REGION);
      expect(input.region).toBe("us-west1");
    }
  });

  it("attaches registry credentials when provided", async () => {
    const { gql, calls } = makeMockGql();
    await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: TWO_TARGETS,
      registryCredentials: { username: "ck-bot", password: "ghp_x" },
    });
    const update = calls.find((c) =>
      c.query.includes("serviceInstanceUpdate("),
    )!;
    const input = update.variables.input as Record<string, unknown>;
    expect(input.registryCredentials).toEqual({
      username: "ck-bot",
      password: "ghp_x",
    });
  });

  it("omits registry credentials when none are provided", async () => {
    const { gql, calls } = makeMockGql();
    await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: TWO_TARGETS,
    });
    const update = calls.find((c) =>
      c.query.includes("serviceInstanceUpdate("),
    )!;
    const input = update.variables.input as Record<string, unknown>;
    expect(input.registryCredentials).toBeUndefined();
  });

  it("creates a staging-scoped domain per new service", async () => {
    const { gql, calls } = makeMockGql();
    const summary = await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: TWO_TARGETS,
    });
    const domainCalls = calls.filter((c) =>
      c.query.includes("serviceDomainCreate("),
    );
    expect(domainCalls).toHaveLength(2);
    for (const d of domainCalls) {
      const input = d.variables.input as { environmentId: string };
      expect(input.environmentId).toBe(STAGING_ENV_ID);
    }
    expect(summary.records.every((r) => r.domainAction === "created")).toBe(
      true,
    );
  });

  it("retries the post-create instance update on transient 'ServiceInstance not found'", async () => {
    // Railway materializes the env-scoped instance asynchronously after
    // serviceCreate, so the first serviceInstanceUpdate can fail with
    // "ServiceInstance not found". The provisioner must retry rather than
    // abort the whole fleet.
    let updateAttempts = 0;
    const gql: RailwayGqlFn = vi.fn(
      async <T = unknown>(
        query: string,
        variables: Record<string, unknown> = {},
      ): Promise<T> => {
        if (query.includes("project(id:")) {
          return { project: { services: { edges: [] } } } as T;
        }
        if (query.includes("serviceCreate(")) {
          const input = variables.input as { name: string };
          return { serviceCreate: { id: "new-1", name: input.name } } as T;
        }
        if (query.includes("serviceInstanceUpdate(")) {
          updateAttempts += 1;
          if (updateAttempts === 1) {
            throw new Error(
              "Railway GraphQL errors:\n  - ServiceInstance not found",
            );
          }
          return { serviceInstanceUpdate: true } as T;
        }
        if (query.includes("serviceDomainCreate(")) {
          return {
            serviceDomainCreate: { domain: "new-1.up.railway.app" },
          } as T;
        }
        throw new Error(`unexpected query:\n${query}`);
      },
    ) as RailwayGqlFn;

    const summary = await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: [TWO_TARGETS[0]],
      sleepMs: NO_SLEEP,
    });
    expect(updateAttempts).toBe(2); // failed once, succeeded on retry
    expect(summary.records[0].action).toBe("created");
  });

  it("does NOT retry a non-transient error (fails loud)", async () => {
    const gql: RailwayGqlFn = vi.fn(
      async <T = unknown>(query: string): Promise<T> => {
        if (query.includes("project(id:")) {
          return { project: { services: { edges: [] } } } as T;
        }
        if (query.includes("serviceCreate(")) {
          return {
            serviceCreate: { id: "new-1", name: "starter-mastra" },
          } as T;
        }
        if (query.includes("serviceInstanceUpdate(")) {
          throw new Error("Railway GraphQL errors:\n  - Unauthorized");
        }
        throw new Error(`unexpected query:\n${query}`);
      },
    ) as RailwayGqlFn;

    await expect(
      provisionStarterFleet({
        gql,
        projectId: PROJECT,
        stagingEnvId: STAGING_ENV_ID,
        targets: [TWO_TARGETS[0]],
        sleepMs: NO_SLEEP,
      }),
    ).rejects.toThrow(/Unauthorized/);
  });
});

// ── provisionStarterFleet: idempotent update path ───────────────────────

describe("provisionStarterFleet — idempotent update path", () => {
  it("UPDATES (does not re-create) a starter service that already exists", async () => {
    const { gql, calls } = makeMockGql([
      {
        id: "existing-mastra",
        name: "starter-mastra",
        stagingDomain: "starter-mastra.up.railway.app",
      },
    ]);
    const summary = await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: TWO_TARGETS,
    });

    const mastra = summary.records.find(
      (r) => r.serviceName === "starter-mastra",
    )!;
    const adk = summary.records.find((r) => r.serviceName === "starter-adk")!;

    // mastra already existed → updated, reuses its id, no create call for it.
    expect(mastra.action).toBe("updated");
    expect(mastra.serviceId).toBe("existing-mastra");
    // adk did not exist → created.
    expect(adk.action).toBe("created");

    const creates = calls.filter((c) => c.query.includes("serviceCreate("));
    expect(creates).toHaveLength(1);
    expect((creates[0].variables.input as { name: string }).name).toBe(
      "starter-adk",
    );

    // The existing service still gets its instance settings re-applied
    // (converge sleep/healthcheck/region on re-run).
    const updates = calls.filter((c) =>
      c.query.includes("serviceInstanceUpdate("),
    );
    expect(updates).toHaveLength(2);
  });

  it("does NOT create a duplicate domain when the existing service already has one", async () => {
    const { gql, calls } = makeMockGql([
      {
        id: "existing-mastra",
        name: "starter-mastra",
        stagingDomain: "starter-mastra.up.railway.app",
      },
    ]);
    const summary = await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      // only the already-domained service
      targets: [TWO_TARGETS[0]],
    });
    const domainCalls = calls.filter((c) =>
      c.query.includes("serviceDomainCreate("),
    );
    expect(domainCalls).toHaveLength(0);
    expect(summary.records[0].domainAction).toBe("existing");
  });

  it("creates a domain for an existing service that lacks one", async () => {
    const { gql, calls } = makeMockGql([
      { id: "existing-mastra", name: "starter-mastra" }, // no domain
    ]);
    await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: [TWO_TARGETS[0]],
    });
    const domainCalls = calls.filter((c) =>
      c.query.includes("serviceDomainCreate("),
    );
    expect(domainCalls).toHaveLength(1);
  });
});

// ── provisionStarterFleet: dry run ──────────────────────────────────────

describe("provisionStarterFleet — dry run", () => {
  it("sends no mutations in dry-run mode (only the read query)", async () => {
    const { gql, calls } = makeMockGql();
    const summary = await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: TWO_TARGETS,
      dryRun: true,
    });
    expect(calls.every((c) => c.query.includes("project(id:"))).toBe(true);
    expect(calls.filter((c) => c.query.includes("Create("))).toHaveLength(0);
    expect(
      calls.filter((c) => c.query.includes("serviceInstanceUpdate(")),
    ).toHaveLength(0);
    expect(summary.records).toHaveLength(2);
  });
});
