import { describe, expect, it, vi } from "vitest";
import {
  deployAngularPreview,
  sanitizeAngularPreviewError,
} from "../deploy-angular-preview";
import type {
  AngularPreviewEvidence,
  RailwayGqlFn,
} from "../deploy-angular-preview";

const PROJECT_ID = "project";
const STAGING_ENV_ID = "staging";
const PRODUCTION_ENV_ID = "production";
const SERVICE_ID = "angular-preview-service";
const DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE = `ghcr.io/copilotkit/showcase-angular@${DIGEST}`;

interface GqlCall {
  query: string;
  variables: Record<string, unknown>;
}

function options(gql: RailwayGqlFn) {
  return {
    gql,
    projectId: PROJECT_ID,
    stagingEnvironmentId: STAGING_ENV_ID,
    productionEnvironmentId: PRODUCTION_ENV_ID,
    serviceName: "showcase-angular-preview",
    image: IMAGE,
    registryCredentials: {
      username: "copilotkit-ci",
      password: "super-secret-token",
    },
    pollIntervalMs: 0,
    maxPolls: 3,
    sleepMs: vi.fn(async () => {}),
    probe: vi.fn(async () => ({
      healthStatus: 200,
      routeStatus: 200,
      contentSecurityPolicy: "default-src 'self'",
      xContentTypeOptions: "nosniff",
    })),
    log: vi.fn(),
  };
}

function emptyProductionInstance() {
  return {
    id: "empty-production-instance",
    source: { image: null },
    latestDeployment: null,
    domains: { serviceDomains: [] },
  };
}

describe("deployAngularPreview", () => {
  it("rejects mutable image references before contacting Railway", async () => {
    const gql = vi.fn<RailwayGqlFn>();

    await expect(
      deployAngularPreview({
        ...options(gql),
        image: "ghcr.io/copilotkit/showcase-angular:latest",
      }),
    ).rejects.toThrow(/immutable.*sha256/i);
    expect(gql).not.toHaveBeenCalled();
  });

  it("rejects an empty deployment polling budget before contacting Railway", async () => {
    const gql = vi.fn<RailwayGqlFn>();

    await expect(
      deployAngularPreview({ ...options(gql), maxPolls: 0 }),
    ).rejects.toThrow(/maxPolls.*positive/i);
    expect(gql).not.toHaveBeenCalled();
  });

  it("redacts every runtime credential from Railway error text", () => {
    expect(
      sanitizeAngularPreviewError(
        "Railway token rail-secret and GHCR token ghcr-secret were rejected",
        ["rail-secret", "ghcr-secret"],
      ),
    ).toBe("Railway token [REDACTED] and GHCR token [REDACTED] were rejected");
  });

  it("fails closed when an existing service has any production host configuration", async () => {
    const calls: GqlCall[] = [];
    const gql: RailwayGqlFn = async (query, variables) => {
      calls.push({ query, variables });
      if (query.includes("query AngularPreviewServices")) {
        return {
          project: {
            services: {
              edges: [
                {
                  node: {
                    id: SERVICE_ID,
                    name: "showcase-angular-preview",
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }
      if (query.includes("query AngularPreviewInstance")) {
        return {
          serviceInstance: {
            ...emptyProductionInstance(),
            latestDeployment: { id: "prod-deployment", status: "SUCCESS" },
          },
        };
      }
      throw new Error(`unexpected GraphQL operation: ${query}`);
    };

    await expect(deployAngularPreview(options(gql))).rejects.toThrow(
      /production.*configured/i,
    );
    expect(
      calls.some((call) => call.query.includes("serviceInstanceUpdate")),
    ).toBe(false);
  });

  it("creates and deploys only the staging instance, verifies its digest, and emits secret-free evidence", async () => {
    const calls: GqlCall[] = [];
    let serviceLookupCount = 0;
    let stagingReadCount = 0;
    const gql: RailwayGqlFn = async (query, variables) => {
      calls.push({ query, variables });
      if (query.includes("query AngularPreviewServices")) {
        serviceLookupCount += 1;
        return {
          project: {
            services: {
              edges:
                serviceLookupCount === 1
                  ? []
                  : [
                      {
                        node: {
                          id: SERVICE_ID,
                          name: "showcase-angular-preview",
                        },
                      },
                    ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }
      if (query.includes("mutation AngularPreviewServiceCreate")) {
        return {
          serviceCreate: {
            id: SERVICE_ID,
            name: "showcase-angular-preview",
          },
        };
      }
      if (query.includes("query AngularPreviewInstance")) {
        if (variables.environmentId === PRODUCTION_ENV_ID) {
          throw new Error("ServiceInstance not found");
        }
        stagingReadCount += 1;
        return {
          serviceInstance: {
            id: "staging-instance",
            source: { image: IMAGE },
            latestDeployment:
              stagingReadCount === 1
                ? null
                : {
                    id: "deployment-1",
                    status: "SUCCESS",
                    meta: JSON.stringify({ imageDigest: DIGEST }),
                  },
            domains: {
              serviceDomains:
                stagingReadCount === 1
                  ? []
                  : [{ domain: "angular-preview.up.railway.app" }],
            },
          },
        };
      }
      if (query.includes("mutation AngularPreviewInstanceUpdate")) {
        return { serviceInstanceUpdate: true };
      }
      if (query.includes("mutation AngularPreviewVariables")) {
        return { variableCollectionUpsert: true };
      }
      if (query.includes("mutation AngularPreviewDomainCreate")) {
        return {
          serviceDomainCreate: {
            domain: "angular-preview.up.railway.app",
          },
        };
      }
      if (query.includes("mutation AngularPreviewDeploy")) {
        return { serviceInstanceDeployV2: "deployment-1" };
      }
      throw new Error(`unexpected GraphQL operation: ${query}`);
    };
    const opts = options(gql);

    const evidence: AngularPreviewEvidence = await deployAngularPreview(opts);

    const createCall = calls.find((call) =>
      call.query.includes("mutation AngularPreviewServiceCreate"),
    );
    expect(createCall?.variables).toMatchObject({
      input: {
        projectId: PROJECT_ID,
        environmentId: STAGING_ENV_ID,
        name: "showcase-angular-preview",
        source: { image: IMAGE },
      },
    });
    const updateCall = calls.find((call) =>
      call.query.includes("mutation AngularPreviewInstanceUpdate"),
    );
    expect(updateCall?.variables).toMatchObject({
      serviceId: SERVICE_ID,
      environmentId: STAGING_ENV_ID,
      input: {
        source: { image: IMAGE },
        sleepApplication: false,
        healthcheckPath: "/healthz",
      },
    });
    expect(evidence).toEqual({
      serviceName: "showcase-angular-preview",
      serviceId: SERVICE_ID,
      environmentId: STAGING_ENV_ID,
      deploymentId: "deployment-1",
      image: IMAGE,
      digest: DIGEST,
      url: "https://angular-preview.up.railway.app",
      productionConfigured: false,
      probes: {
        healthStatus: 200,
        routeStatus: 200,
        contentSecurityPolicy: "default-src 'self'",
        xContentTypeOptions: "nosniff",
      },
    });
    expect(JSON.stringify(evidence)).not.toContain("super-secret-token");
    expect(JSON.stringify(vi.mocked(opts.log).mock.calls)).not.toContain(
      "super-secret-token",
    );
    expect(opts.probe).toHaveBeenCalledWith(
      "https://angular-preview.up.railway.app",
    );
  });

  it("rejects a successful deployment that serves a different digest", async () => {
    const gql: RailwayGqlFn = async (query, variables) => {
      if (query.includes("query AngularPreviewServices")) {
        return {
          project: {
            services: {
              edges: [
                {
                  node: {
                    id: SERVICE_ID,
                    name: "showcase-angular-preview",
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }
      if (query.includes("query AngularPreviewInstance")) {
        if (variables.environmentId === PRODUCTION_ENV_ID) {
          return { serviceInstance: null };
        }
        return {
          serviceInstance: {
            id: "staging-instance",
            source: { image: IMAGE },
            latestDeployment: {
              id: "deployment-1",
              status: "SUCCESS",
              meta: { imageDigest: `sha256:${"b".repeat(64)}` },
            },
            domains: {
              serviceDomains: [{ domain: "angular-preview.up.railway.app" }],
            },
          },
        };
      }
      if (query.includes("mutation AngularPreviewInstanceUpdate")) {
        return { serviceInstanceUpdate: true };
      }
      if (query.includes("mutation AngularPreviewVariables")) {
        return { variableCollectionUpsert: true };
      }
      if (query.includes("mutation AngularPreviewDeploy")) {
        return { serviceInstanceDeployV2: "deployment-1" };
      }
      throw new Error(`unexpected GraphQL operation: ${query}`);
    };

    await expect(deployAngularPreview(options(gql))).rejects.toThrow(
      /serves.*expected/i,
    );
  });

  it("fails immediately when the new deployment reaches a terminal failure", async () => {
    const gql: RailwayGqlFn = async (query, variables) => {
      if (query.includes("query AngularPreviewServices")) {
        return {
          project: {
            services: {
              edges: [
                {
                  node: {
                    id: SERVICE_ID,
                    name: "showcase-angular-preview",
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }
      if (query.includes("query AngularPreviewInstance")) {
        if (variables.environmentId === PRODUCTION_ENV_ID) {
          return { serviceInstance: null };
        }
        return {
          serviceInstance: {
            id: "staging-instance",
            source: { image: IMAGE },
            latestDeployment: {
              id: "deployment-1",
              status: "FAILED",
              meta: null,
            },
            domains: {
              serviceDomains: [{ domain: "angular-preview.up.railway.app" }],
            },
          },
        };
      }
      if (query.includes("mutation AngularPreviewInstanceUpdate")) {
        return { serviceInstanceUpdate: true };
      }
      if (query.includes("mutation AngularPreviewVariables")) {
        return { variableCollectionUpsert: true };
      }
      if (query.includes("mutation AngularPreviewDeploy")) {
        return { serviceInstanceDeployV2: "deployment-1" };
      }
      throw new Error(`unexpected GraphQL operation: ${query}`);
    };

    await expect(deployAngularPreview(options(gql))).rejects.toThrow(
      /deployment-1.*FAILED/i,
    );
  });
});
