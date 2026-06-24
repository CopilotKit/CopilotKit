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
  parseArgs,
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

      if (query.includes("serviceInstanceRedeploy(")) {
        return { serviceInstanceRedeploy: true } as T;
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

  it("tolerates a service node with null serviceInstances (transitional service)", async () => {
    // A service in a transitional state can return a null serviceInstances
    // connection (or null .edges). An unguarded `.edges.find(...)` throws a
    // TypeError that aborts the ENTIRE fetch — before any starter is touched.
    // The fetch must coalesce and treat such a node as having no staging
    // instance / no domain rather than crash.
    const gql: RailwayGqlFn = vi.fn(async () => ({
      project: {
        services: {
          edges: [
            {
              node: {
                id: "svc-null-instances",
                name: "starter-mastra",
                serviceInstances: null,
              },
            },
            {
              node: {
                id: "svc-null-edges",
                name: "starter-adk",
                serviceInstances: { edges: null },
              },
            },
          ],
        },
      },
    })) as never;

    const map = await fetchExistingServices(gql, PROJECT, STAGING_ENV_ID);
    expect(map.get("starter-mastra")).toEqual({
      id: "svc-null-instances",
      hasStagingDomain: false,
    });
    expect(map.get("starter-adk")).toEqual({
      id: "svc-null-edges",
      hasStagingDomain: false,
    });
  });

  it("FAILS LOUD when the page-drain loop is truncated (hasNextPage still true at the bound)", async () => {
    // If the defensive page bound is reached while pageInfo.hasNextPage is
    // STILL true, the byName map is a TRUNCATED snapshot. Returning it
    // silently would feed erroneous create-vs-update decisions (a service on
    // an undrained page looks absent → CREATE → "already exists"). Refuse to
    // provision against a truncated snapshot.
    const gql: RailwayGqlFn = vi.fn(
      async <T = unknown>(): Promise<T> =>
        ({
          project: {
            services: {
              edges: [
                {
                  node: {
                    id: "svc-loop",
                    name: "starter-loop",
                    serviceInstances: { edges: [] },
                  },
                },
              ],
              // Always more pages, never a usable cursor advance → the loop
              // exhausts its bound with hasNextPage still true.
              pageInfo: { hasNextPage: true, endCursor: "stuck-cursor" },
            },
          },
        }) as T,
    ) as RailwayGqlFn;

    await expect(
      fetchExistingServices(gql, PROJECT, STAGING_ENV_ID),
    ).rejects.toThrow(/truncated/i);
  });

  it("paginates the Relay ServiceConnection — services on page 2 are NOT truncated", async () => {
    // Railway's `project.services` is a Relay connection that page-limits.
    // With ~27 SSOT + 12 starter services in staging, a single un-paginated
    // query returns a TRUNCATED first page — a starter that lives on page 2
    // looks absent, the provisioner takes the CREATE path, and serviceCreate
    // rejects with a non-transient "already exists" → the whole run ABORTS.
    // fetchExistingServices must follow `pageInfo.hasNextPage`/`endCursor`
    // until every page is drained, accumulating into one byName map.
    let afterSeen: unknown;
    const gql: RailwayGqlFn = vi.fn(
      async <T = unknown>(
        _query: string,
        variables: Record<string, unknown> = {},
      ): Promise<T> => {
        const after = variables.after;
        afterSeen = after;
        const mkNode = (id: string, name: string) => ({
          node: {
            id,
            name,
            serviceInstances: {
              edges: [
                {
                  node: {
                    environmentId: STAGING_ENV_ID,
                    domains: { serviceDomains: [] },
                  },
                },
              ],
            },
          },
        });
        // Page 1: one service + hasNextPage. Page 2 (after cursor): the rest.
        if (!after) {
          return {
            project: {
              services: {
                edges: [mkNode("svc-page1", "starter-mastra")],
                pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
              },
            },
          } as T;
        }
        return {
          project: {
            services: {
              edges: [mkNode("svc-page2", "starter-adk")],
              pageInfo: { hasNextPage: false, endCursor: "cursor-2" },
            },
          },
        } as T;
      },
    ) as RailwayGqlFn;

    const map = await fetchExistingServices(gql, PROJECT, STAGING_ENV_ID);
    // Both pages' services are present — page 2 was NOT truncated away.
    expect(map.get("starter-mastra")?.id).toBe("svc-page1");
    expect(map.get("starter-adk")?.id).toBe("svc-page2");
    expect(map.size).toBe(2);
    // The second query carried the first page's endCursor as `after`.
    expect(afterSeen).toBe("cursor-1");
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

  it("sets sleepApplication:false (always-on) + healthcheck '/' + region us-west1 on the staging instance", async () => {
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
      expect(input.sleepApplication).toBe(false);
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
        if (query.includes("serviceInstanceRedeploy(")) {
          return { serviceInstanceRedeploy: true } as T;
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

  it("retries Railway's INTERPOLATED 'Service <id> not found' (id in message)", async () => {
    // Railway's real eventual-consistency message interpolates the service id:
    // "Service abc-123 not found" — NOT the contiguous "Service not found".
    // The transient regex must match the interpolated form so the post-create
    // race is retried; otherwise the run aborts on a benign timing error.
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
              "Railway GraphQL errors:\n  - Service abc-123-def not found",
            );
          }
          return { serviceInstanceUpdate: true } as T;
        }
        if (query.includes("serviceInstanceRedeploy(")) {
          return { serviceInstanceRedeploy: true } as T;
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
    expect(updateAttempts).toBe(2); // failed once on interpolated msg, retried
    expect(summary.records[0].action).toBe("created");
  });

  it("THROWS when serviceCreate returns no id (silent-success guard)", async () => {
    // serviceCreate must yield a non-empty service id. A null/empty id means
    // the create silently failed — every downstream mutation would target an
    // invalid service. Fail loud, naming the service.
    const gql: RailwayGqlFn = vi.fn(
      async <T = unknown>(query: string): Promise<T> => {
        if (query.includes("project(id:")) {
          return { project: { services: { edges: [] } } } as T;
        }
        if (query.includes("serviceCreate(")) {
          return { serviceCreate: { id: "", name: "starter-mastra" } } as T;
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
    ).rejects.toThrow(/serviceCreate.*starter-mastra/i);
  });

  it("THROWS when serviceInstanceUpdate returns false (settings NOT applied)", async () => {
    // serviceInstanceUpdate returns Boolean! — a `false` return means
    // sleepApplication/healthcheck/image/creds were NOT applied. Reporting
    // success here would run the service WITHOUT sleep. Fail loud.
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
          return { serviceInstanceUpdate: false } as T;
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
    ).rejects.toThrow(/serviceInstanceUpdate.*starter-mastra/i);
  });

  it("does NOT log 'configured ...' before the update result is verified", async () => {
    // The "configured ..." log line must come AFTER the update result is
    // verified — a false return must throw without ever claiming the settings
    // were configured.
    const logs: string[] = [];
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
          return { serviceInstanceUpdate: false } as T;
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
        log: (line) => logs.push(line),
      }),
    ).rejects.toThrow();
    expect(logs.some((l) => l.includes("configured"))).toBe(false);
  });

  it("THROWS when serviceDomainCreate returns no domain on the create path", async () => {
    // serviceDomainCreate must yield a domain on the create path. A
    // null/empty domain means the create silently failed.
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
          return { serviceInstanceUpdate: true } as T;
        }
        if (query.includes("serviceInstanceRedeploy(")) {
          return { serviceInstanceRedeploy: true } as T;
        }
        if (query.includes("serviceDomainCreate(")) {
          return { serviceDomainCreate: { domain: "" } } as T;
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
    ).rejects.toThrow(/serviceDomainCreate.*starter-mastra/i);
  });

  it("absorbs a serviceCreate 'already exists' rejection → falls to update, fleet continues", async () => {
    // A snapshot-miss (Railway eventual consistency) makes a service look
    // absent → CREATE path. If serviceCreate then rejects with a non-transient
    // "already exists", the script must NOT abort: it re-fetches the service
    // id by name and falls through to the UPDATE path so the fleet converges.
    let createAttempts = 0;
    const gql: RailwayGqlFn = vi.fn(
      async <T = unknown>(
        query: string,
        variables: Record<string, unknown> = {},
      ): Promise<T> => {
        if (query.includes("project(id:")) {
          // First snapshot is empty (miss). A re-fetch by name must surface
          // the now-visible service so the update path can use its id.
          if (createAttempts === 0) {
            return { project: { services: { edges: [] } } } as T;
          }
          return {
            project: {
              services: {
                edges: [
                  {
                    node: {
                      id: "found-mastra",
                      name: "starter-mastra",
                      serviceInstances: { edges: [] },
                    },
                  },
                ],
              },
            },
          } as T;
        }
        if (query.includes("serviceCreate(")) {
          createAttempts += 1;
          const input = variables.input as { name: string };
          throw new Error(
            `Railway GraphQL errors:\n  - Service ${input.name} already exists`,
          );
        }
        if (query.includes("serviceInstanceUpdate(")) {
          return { serviceInstanceUpdate: true } as T;
        }
        if (query.includes("serviceInstanceRedeploy(")) {
          return { serviceInstanceRedeploy: true } as T;
        }
        if (query.includes("serviceDomainCreate(")) {
          return {
            serviceDomainCreate: { domain: "found-mastra.up.railway.app" },
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
    // Did not abort: the target was processed via the update path with the
    // re-fetched id.
    expect(summary.records).toHaveLength(1);
    expect(summary.records[0].action).toBe("updated");
    expect(summary.records[0].serviceId).toBe("found-mastra");
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

  it("does NOT treat a newline-joined multi-error blob as transient (no cross-line bridge)", async () => {
    // The transient regex must not bridge "Service" on one error line to
    // "not found" on a DIFFERENT line of a newline-joined GraphQL error blob.
    // Railway interpolates the id on a SINGLE line ("Service <id> not found"),
    // which never contains a newline. A blob that pairs an unrelated "Service
    // ..." line with a "... not found" line is NOT the eventual-consistency
    // signal and must fail loud immediately (no wasted retries).
    let updateAttempts = 0;
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
          updateAttempts += 1;
          throw new Error(
            "Railway GraphQL errors:\n  - Service config invalid\n  - Volume not found",
          );
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
    ).rejects.toThrow(/config invalid/);
    // Failed loud on the first attempt — not retried as transient.
    expect(updateAttempts).toBe(1);
  });

  it("wraps the rethrow with retry-exhaustion context when the schedule is exhausted", async () => {
    // When every transient retry is exhausted, the final rethrow must carry
    // context (how many retries, that the error was transient) with the
    // original error as `cause`.
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
          // Always transient → exhausts the schedule.
          throw new Error(
            "Railway GraphQL errors:\n  - ServiceInstance not found",
          );
        }
        throw new Error(`unexpected query:\n${query}`);
      },
    ) as RailwayGqlFn;

    let caught: unknown;
    try {
      await provisionStarterFleet({
        gql,
        projectId: PROJECT,
        stagingEnvId: STAGING_ENV_ID,
        targets: [TWO_TARGETS[0]],
        sleepMs: NO_SLEEP,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/exhausted.*retries.*transient/i);
    // The original transient error is preserved as the cause.
    expect((caught as Error).cause).toBeInstanceOf(Error);
    expect(((caught as Error).cause as Error).message).toMatch(
      /ServiceInstance not found/,
    );
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
    expect(
      calls.filter((c) => c.query.includes("serviceInstanceRedeploy(")),
    ).toHaveLength(0);
    expect(summary.records).toHaveLength(2);
  });

  it("reports a NEW service's domain as 'would-create' (faithful preview, not 'skipped')", async () => {
    // A real run creates a domain for a new service, so dry-run must preview
    // that as "would-create" rather than the misleading "skipped".
    const { gql } = makeMockGql();
    const summary = await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: TWO_TARGETS,
      dryRun: true,
    });
    expect(
      summary.records.every((r) => r.domainAction === "would-create"),
    ).toBe(true);
  });

  it("reports an EXISTING already-domained service as 'existing' in dry-run", async () => {
    const { gql } = makeMockGql([
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
      targets: [TWO_TARGETS[0]],
      dryRun: true,
    });
    expect(summary.records[0].domainAction).toBe("existing");
  });
});

// ── provisionStarterFleet: redeploy (image must actually run) ────────────

describe("provisionStarterFleet — redeploy", () => {
  it("triggers serviceInstanceRedeploy after configuring a NEW service so the image actually runs", async () => {
    // serviceCreate + serviceInstanceUpdate(source.image) pins the image but
    // does NOT start a deployment (auto-updates only fire on a NEW digest
    // push; bin/railway documents update+redeploy as the canonical pattern).
    // Without an explicit redeploy the service never runs and starter_smoke
    // would never find it up.
    const { gql, calls } = makeMockGql();
    await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: TWO_TARGETS,
    });
    const redeploys = calls.filter((c) =>
      c.query.includes("serviceInstanceRedeploy("),
    );
    expect(redeploys).toHaveLength(2);
    for (const r of redeploys) {
      expect(r.variables.environmentId).toBe(STAGING_ENV_ID);
      expect(r.variables.environmentId).not.toBe(PRODUCTION_ENV_ID);
    }
  });

  it("triggers serviceInstanceRedeploy on the update path (re-asserted image must run)", async () => {
    const { gql, calls } = makeMockGql([
      {
        id: "existing-mastra",
        name: "starter-mastra",
        stagingDomain: "starter-mastra.up.railway.app",
      },
    ]);
    await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: [TWO_TARGETS[0]],
    });
    const redeploys = calls.filter((c) =>
      c.query.includes("serviceInstanceRedeploy("),
    );
    expect(redeploys).toHaveLength(1);
    expect(redeploys[0].variables.serviceId).toBe("existing-mastra");
  });

  it("sends NO redeploy in dry-run mode", async () => {
    const { gql, calls } = makeMockGql();
    await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: TWO_TARGETS,
      dryRun: true,
    });
    expect(
      calls.filter((c) => c.query.includes("serviceInstanceRedeploy(")),
    ).toHaveLength(0);
  });

  it("THROWS when serviceInstanceRedeploy returns false (image would not run)", async () => {
    // serviceInstanceRedeploy returns Boolean! (verified against
    // redeploy-env.ts:117 + bin/railway RestoreCommand). A `false` return
    // means Railway did not start a deployment — the image would never run,
    // so the provisioner must fail loud rather than report success.
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
          return { serviceInstanceUpdate: true } as T;
        }
        if (query.includes("serviceInstanceRedeploy(")) {
          return { serviceInstanceRedeploy: false } as T;
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
    ).rejects.toThrow(/image will not run/);
  });

  it("THROWS when serviceInstanceRedeploy returns null (no deployment started)", async () => {
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
          return { serviceInstanceUpdate: true } as T;
        }
        if (query.includes("serviceInstanceRedeploy(")) {
          return { serviceInstanceRedeploy: null } as T;
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
    ).rejects.toThrow(/image will not run/);
  });

  it("SUCCEEDS when serviceInstanceRedeploy returns true (the verified Boolean! contract)", async () => {
    const { gql } = makeMockGql();
    const summary = await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: [TWO_TARGETS[0]],
      sleepMs: NO_SLEEP,
    });
    expect(summary.records[0].action).toBe("created");
  });
});

// ── provisionStarterFleet: idempotent domain re-create (partial failure) ─

describe("provisionStarterFleet — domain already-exists is a benign no-op", () => {
  it("treats a 'domain already exists' error as existing and CONTINUES the fleet (does not abort)", async () => {
    // Partial-failure re-run: the start-of-run snapshot missed the domain
    // (Railway eventual consistency / a run that died mid-fleet), so the
    // provisioner re-issues serviceDomainCreate and Railway rejects it with a
    // NON-transient "already exists" error. This must converge (mark existing,
    // keep going), not abort the remaining fleet.
    let domainAttempts = 0;
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
          return {
            serviceCreate: { id: `svc-${input.name}`, name: input.name },
          } as T;
        }
        if (query.includes("serviceInstanceUpdate(")) {
          return { serviceInstanceUpdate: true } as T;
        }
        if (query.includes("serviceInstanceRedeploy(")) {
          return { serviceInstanceRedeploy: true } as T;
        }
        if (query.includes("serviceDomainCreate(")) {
          domainAttempts += 1;
          // First target's domain create rejects as already-existing.
          if (domainAttempts === 1) {
            throw new Error(
              "Railway GraphQL errors:\n  - A domain already exists for this service",
            );
          }
          return {
            serviceDomainCreate: { domain: "svc.up.railway.app" },
          } as T;
        }
        throw new Error(`unexpected query:\n${query}`);
      },
    ) as RailwayGqlFn;

    const logs: string[] = [];
    const summary = await provisionStarterFleet({
      gql,
      projectId: PROJECT,
      stagingEnvId: STAGING_ENV_ID,
      targets: TWO_TARGETS,
      sleepMs: NO_SLEEP,
      log: (line) => logs.push(line),
    });
    // Both targets processed — the fleet did NOT abort.
    expect(summary.records).toHaveLength(2);
    // The duplicate-domain target is marked existing (benign no-op).
    expect(summary.records[0].domainAction).toBe("existing");
    // The second target's domain succeeded normally.
    expect(summary.records[1].domainAction).toBe("created");
    // Forensic trail: the benign no-op log line includes the ACTUAL matched
    // Railway error message, not just a generic "already exists" note.
    expect(
      logs.some((l) => l.includes("A domain already exists for this service")),
    ).toBe(true);
  });

  it("still ABORTS on a genuine non-transient domain-create error", async () => {
    const gql: RailwayGqlFn = vi.fn(
      async <T = unknown>(query: string): Promise<T> => {
        if (query.includes("project(id:")) {
          return { project: { services: { edges: [] } } } as T;
        }
        if (query.includes("serviceCreate(")) {
          return {
            serviceCreate: { id: "svc-1", name: "starter-mastra" },
          } as T;
        }
        if (query.includes("serviceInstanceUpdate(")) {
          return { serviceInstanceUpdate: true } as T;
        }
        if (query.includes("serviceInstanceRedeploy(")) {
          return { serviceInstanceRedeploy: true } as T;
        }
        if (query.includes("serviceDomainCreate(")) {
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

// ── parseArgs: argv validation ───────────────────────────────────────────

describe("parseArgs", () => {
  it("parses known flags", () => {
    expect(parseArgs(["--dry-run"])).toEqual({
      help: false,
      list: false,
      dryRun: true,
    });
    expect(parseArgs(["--list"])).toMatchObject({ list: true });
    expect(parseArgs(["--help"])).toMatchObject({ help: true });
    expect(parseArgs([])).toEqual({ help: false, list: false, dryRun: false });
  });

  it("REJECTS an unrecognized flag (mistyped --dry-rn must not silently run live)", () => {
    expect(() => parseArgs(["--dry-rn"])).toThrow(/unknown|unrecognized/i);
  });

  it("rejects any unrecognized dash-prefixed argument", () => {
    expect(() => parseArgs(["--list", "--bogus"])).toThrow(
      /unknown|unrecognized/i,
    );
    expect(() => parseArgs(["-x"])).toThrow(/unknown|unrecognized/i);
  });
});
