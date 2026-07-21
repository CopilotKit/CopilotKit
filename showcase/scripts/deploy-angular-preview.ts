#!/usr/bin/env npx tsx
/**
 * Deploy the canonical Angular showcase host to an isolated Railway staging
 * service. The service is always pinned by digest and production is treated as
 * a forbidden surface: any production image, deployment, healthcheck, or
 * public domain aborts the operation before staging is changed and is checked
 * again after the new deployment becomes healthy.
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PRODUCTION_ENV_ID, PROJECT_ID, STAGING_ENV_ID } from "./railway-envs";
import {
  RAILWAY_GRAPHQL_ENDPOINT,
  sanitizeErrorBody,
} from "./lib/railway-graphql";
import { resolveRailwayToken } from "./lib/railway-token";

export const ANGULAR_PREVIEW_SERVICE_NAME = "showcase-angular-preview";
export const ANGULAR_PREVIEW_HEALTHCHECK_PATH = "/healthz";
export const ANGULAR_PREVIEW_ROUTE = "/mastra/agentic-chat";
export const ANGULAR_PREVIEW_REGION = "us-west1";

const IMAGE_RE =
  /^ghcr\.io\/copilotkit\/showcase-angular@(sha256:[a-f0-9]{64})$/i;
const TERMINAL_FAILURE_STATUSES = new Set(["FAILED", "CRASHED", "REMOVED"]);

export type RailwayGqlFn = <T = unknown>(
  query: string,
  variables: Record<string, unknown>,
) => Promise<T>;

export interface RegistryCredentials {
  username: string;
  password: string;
}

export interface AngularPreviewProbeEvidence {
  healthStatus: number;
  routeStatus: number;
  contentSecurityPolicy: string;
  xContentTypeOptions: string;
}

export interface AngularPreviewEvidence {
  serviceName: string;
  serviceId: string;
  environmentId: string;
  deploymentId: string;
  image: string;
  digest: string;
  url: string;
  productionConfigured: false;
  probes: AngularPreviewProbeEvidence;
}

interface ServiceInstance {
  id: string;
  source?: { image?: string | null } | null;
  healthcheckPath?: string | null;
  latestDeployment?: {
    id: string;
    status: string;
    meta?: unknown;
  } | null;
  domains?: {
    serviceDomains?: Array<{ domain: string }> | null;
  } | null;
}

interface DeployOptions {
  gql: RailwayGqlFn;
  projectId: string;
  stagingEnvironmentId: string;
  productionEnvironmentId: string;
  serviceName: string;
  image: string;
  registryCredentials: RegistryCredentials;
  probe?: (url: string) => Promise<AngularPreviewProbeEvidence>;
  sleepMs?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
  log?: (line: string) => void;
}

interface ProjectServicesResult {
  project: {
    services: {
      edges: Array<{ node: { id: string; name: string } }>;
      pageInfo?: {
        hasNextPage: boolean;
        endCursor?: string | null;
      } | null;
    };
  } | null;
}

interface ServiceInstanceResult {
  serviceInstance: ServiceInstance | null;
}

/** Validate and return the digest from the one permitted immutable image. */
export function angularPreviewDigest(image: string): string {
  const match = IMAGE_RE.exec(image);
  if (!match) {
    throw new Error(
      "Angular preview requires an immutable ghcr.io/copilotkit/showcase-angular@sha256:<64 hex> image reference.",
    );
  }
  return match[1].toLowerCase();
}

/** Redact exact runtime credentials before bounding API error text for logs. */
export function sanitizeAngularPreviewError(
  body: string,
  credentials: readonly string[],
): string {
  const redacted = credentials
    .filter((credential) => credential.length > 0)
    .reduce(
      (message, credential) => message.replaceAll(credential, "[REDACTED]"),
      body,
    );
  return sanitizeErrorBody(redacted);
}

/** Read one environment-scoped service instance, including Railway's absent-instance error shape. */
async function readServiceInstance(
  gql: RailwayGqlFn,
  serviceId: string,
  environmentId: string,
): Promise<ServiceInstance | null> {
  try {
    const result = await gql<ServiceInstanceResult>(
      `query AngularPreviewInstance($serviceId: String!, $environmentId: String!) {
        serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
          id
          source { image }
          healthcheckPath
          latestDeployment { id status meta }
          domains { serviceDomains { domain } }
        }
      }`,
      { serviceId, environmentId },
    );
    return result.serviceInstance;
  } catch (error) {
    if (
      error instanceof Error &&
      /^ServiceInstance not found\.?$/.test(error.message.trim())
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Refuse any production host that could serve traffic. Railway may expose an
 * empty environment instance for a staging-only service; that is allowed only
 * while it has no image, healthcheck, deployment, or domain.
 */
export function assertProductionUnconfigured(
  instance: ServiceInstance | null,
): void {
  if (!instance) return;
  const hasImage = Boolean(instance.source?.image?.trim());
  const hasHealthcheck = Boolean(instance.healthcheckPath?.trim());
  const hasDeployment =
    instance.latestDeployment !== null &&
    instance.latestDeployment !== undefined;
  const hasDomain = (instance.domains?.serviceDomains?.length ?? 0) > 0;
  if (hasImage || hasHealthcheck || hasDeployment || hasDomain) {
    throw new Error(
      "Angular preview production service is configured; refusing to mutate staging until the production host is absent or disabled.",
    );
  }
}

/** Find a service by exact name while draining Railway's paginated result. */
async function findServiceId(
  gql: RailwayGqlFn,
  projectId: string,
  serviceName: string,
): Promise<string | undefined> {
  let after: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const result: ProjectServicesResult = await gql<ProjectServicesResult>(
      `query AngularPreviewServices($projectId: String!, $after: String) {
        project(id: $projectId) {
          services(first: 100, after: $after) {
            edges { node { id name } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { projectId, after },
    );
    if (!result.project) {
      throw new Error(
        `Railway project ${projectId} was not found or is not accessible.`,
      );
    }
    const found = result.project.services.edges.find(
      (edge: { node: { id: string; name: string } }) =>
        edge.node.name === serviceName,
    );
    if (found) return found.node.id;
    const pageInfo:
      | {
          hasNextPage: boolean;
          endCursor?: string | null;
        }
      | null
      | undefined = result.project.services.pageInfo;
    if (!pageInfo?.hasNextPage) return undefined;
    if (!pageInfo.endCursor || pageInfo.endCursor === after) {
      throw new Error(
        "Railway service pagination did not advance; refusing a partial lookup.",
      );
    }
    after = pageInfo.endCursor;
  }
  throw new Error("Railway service lookup exceeded its defensive page bound.");
}

/** Extract Railway's resolved digest from an object or JSON-string meta value. */
export function deploymentDigest(meta: unknown): string | undefined {
  let parsed = meta;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const value = (parsed as { imageDigest?: unknown }).imageDigest;
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

/** Probe readiness plus a real routed Angular page and its security headers. */
export async function probeAngularPreview(
  baseUrl: string,
): Promise<AngularPreviewProbeEvidence> {
  const health = await fetch(`${baseUrl}${ANGULAR_PREVIEW_HEALTHCHECK_PATH}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const route = await fetch(`${baseUrl}${ANGULAR_PREVIEW_ROUTE}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const contentSecurityPolicy =
    route.headers.get("content-security-policy") ?? "";
  const xContentTypeOptions = route.headers.get("x-content-type-options") ?? "";
  if (
    health.status !== 200 ||
    route.status !== 200 ||
    !contentSecurityPolicy.includes("default-src 'self'") ||
    xContentTypeOptions !== "nosniff"
  ) {
    throw new Error(
      `Angular preview probe failed (health=${health.status}, route=${route.status}, csp=${contentSecurityPolicy.length > 0}, nosniff=${xContentTypeOptions === "nosniff"}).`,
    );
  }
  return {
    healthStatus: health.status,
    routeStatus: route.status,
    contentSecurityPolicy,
    xContentTypeOptions,
  };
}

/**
 * Create or converge the isolated staging service, deploy the exact digest,
 * prove the new deployment is serving it, and re-check production isolation.
 */
export async function deployAngularPreview(
  options: DeployOptions,
): Promise<AngularPreviewEvidence> {
  const digest = angularPreviewDigest(options.image);
  const maxPolls = options.maxPolls ?? 36;
  if (!Number.isInteger(maxPolls) || maxPolls < 1) {
    throw new Error("maxPolls must be a positive integer.");
  }
  const log = options.log ?? (() => {});
  const sleepMs =
    options.sleepMs ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pollIntervalMs = options.pollIntervalMs ?? 10_000;
  const probe = options.probe ?? probeAngularPreview;

  let serviceId = await findServiceId(
    options.gql,
    options.projectId,
    options.serviceName,
  );
  if (serviceId) {
    assertProductionUnconfigured(
      await readServiceInstance(
        options.gql,
        serviceId,
        options.productionEnvironmentId,
      ),
    );
    log(`Reusing isolated service ${options.serviceName} (${serviceId}).`);
  } else {
    const created = await options.gql<{
      serviceCreate?: { id?: string; name?: string } | null;
    }>(
      `mutation AngularPreviewServiceCreate($input: ServiceCreateInput!) {
        serviceCreate(input: $input) { id name }
      }`,
      {
        input: {
          projectId: options.projectId,
          environmentId: options.stagingEnvironmentId,
          name: options.serviceName,
          source: { image: options.image },
          registryCredentials: options.registryCredentials,
        },
      },
    );
    serviceId = created.serviceCreate?.id;
    if (!serviceId) {
      throw new Error(
        "Railway serviceCreate returned no Angular preview service id.",
      );
    }
    log(`Created staging-only service ${options.serviceName} (${serviceId}).`);
    assertProductionUnconfigured(
      await readServiceInstance(
        options.gql,
        serviceId,
        options.productionEnvironmentId,
      ),
    );
  }

  const update = await options.gql<{ serviceInstanceUpdate?: boolean | null }>(
    `mutation AngularPreviewInstanceUpdate($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`,
    {
      serviceId,
      environmentId: options.stagingEnvironmentId,
      input: {
        source: { image: options.image },
        registryCredentials: options.registryCredentials,
        sleepApplication: false,
        healthcheckPath: ANGULAR_PREVIEW_HEALTHCHECK_PATH,
        region: ANGULAR_PREVIEW_REGION,
      },
    },
  );
  if (update.serviceInstanceUpdate !== true) {
    throw new Error(
      "Railway did not apply the Angular preview staging configuration.",
    );
  }

  const variables = await options.gql<{
    variableCollectionUpsert?: boolean | null;
  }>(
    `mutation AngularPreviewVariables($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId: options.projectId,
        environmentId: options.stagingEnvironmentId,
        serviceId,
        variables: {
          NODE_ENV: "production",
          SHOWCASE_BACKEND_HOST_PATTERN:
            "showcase-{slug}-production.up.railway.app",
          SHOWCASE_FRAME_ANCESTORS: "https://showcase.staging.copilotkit.ai",
        },
      },
    },
  );
  if (variables.variableCollectionUpsert !== true) {
    throw new Error(
      "Railway did not apply the Angular preview runtime variables.",
    );
  }

  const stagingBeforeDeploy = await readServiceInstance(
    options.gql,
    serviceId,
    options.stagingEnvironmentId,
  );
  let domain = stagingBeforeDeploy?.domains?.serviceDomains?.[0]?.domain;
  if (!domain) {
    const createdDomain = await options.gql<{
      serviceDomainCreate?: { domain?: string } | null;
    }>(
      `mutation AngularPreviewDomainCreate($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) { domain }
      }`,
      {
        input: {
          serviceId,
          environmentId: options.stagingEnvironmentId,
        },
      },
    );
    domain = createdDomain.serviceDomainCreate?.domain;
    if (!domain) {
      throw new Error(
        "Railway did not return an Angular preview staging domain.",
      );
    }
  }

  const deployed = await options.gql<{
    serviceInstanceDeployV2?: string | null;
  }>(
    `mutation AngularPreviewDeploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { serviceId, environmentId: options.stagingEnvironmentId },
  );
  const deploymentId = deployed.serviceInstanceDeployV2;
  if (!deploymentId) {
    throw new Error(
      "Railway did not return a new Angular preview deployment id.",
    );
  }

  let lastStatus = "unknown";
  for (let poll = 0; poll < maxPolls; poll += 1) {
    const instance = await readServiceInstance(
      options.gql,
      serviceId,
      options.stagingEnvironmentId,
    );
    const latest = instance?.latestDeployment;
    lastStatus = latest?.status ?? "unknown";
    if (
      latest?.id === deploymentId &&
      TERMINAL_FAILURE_STATUSES.has(latest.status)
    ) {
      throw new Error(
        `Angular preview deployment ${deploymentId} reached ${latest.status}.`,
      );
    }
    if (latest?.id === deploymentId && latest.status === "SUCCESS") {
      const servingDigest = deploymentDigest(latest.meta);
      if (servingDigest !== digest) {
        throw new Error(
          `Angular preview deployment ${deploymentId} serves ${servingDigest ?? "no digest"}; expected ${digest}.`,
        );
      }
      break;
    }
    if (poll === maxPolls - 1) {
      throw new Error(
        `Angular preview deployment ${deploymentId} did not converge after ${maxPolls} polls (last status ${lastStatus}).`,
      );
    }
    await sleepMs(pollIntervalMs);
  }

  assertProductionUnconfigured(
    await readServiceInstance(
      options.gql,
      serviceId,
      options.productionEnvironmentId,
    ),
  );
  const url = `https://${domain}`;
  const probes = await probe(url);
  log(`Verified ${options.serviceName} at ${url} serving ${digest}.`);
  return {
    serviceName: options.serviceName,
    serviceId,
    environmentId: options.stagingEnvironmentId,
    deploymentId,
    image: options.image,
    digest,
    url,
    productionConfigured: false,
    probes,
  };
}

/** Build a GraphQL client whose errors are bounded and scrubbed for logs. */
function liveRailwayGql(
  token: string,
  credentials: readonly string[],
): RailwayGqlFn {
  return async <T>(query: string, variables: Record<string, unknown>) => {
    const response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `Railway GraphQL HTTP ${response.status}: ${sanitizeAngularPreviewError(raw, credentials)}`,
      );
    }
    const payload = JSON.parse(raw) as {
      data?: T;
      errors?: Array<{ message?: string }>;
    };
    if (payload.errors?.length) {
      throw new Error(
        payload.errors
          .map((error) =>
            sanitizeAngularPreviewError(
              error.message ?? "unknown error",
              credentials,
            ),
          )
          .join("; "),
      );
    }
    if (!payload.data) throw new Error("Railway GraphQL returned no data.");
    return payload.data;
  };
}

/** Run the CI entrypoint without exposing token or registry credential values. */
async function main(): Promise<void> {
  const image = process.env.ANGULAR_IMAGE?.trim();
  const username = (
    process.env.GHCR_USERNAME ??
    process.env.GITHUB_ACTOR ??
    ""
  ).trim();
  const password = process.env.GHCR_TOKEN?.trim();
  const evidencePath =
    process.env.ANGULAR_PREVIEW_EVIDENCE?.trim() ||
    "angular-preview-evidence.json";
  if (!image || !username || !password) {
    throw new Error(
      "ANGULAR_IMAGE, GHCR_TOKEN, and GHCR_USERNAME or GITHUB_ACTOR are required.",
    );
  }
  const token = resolveRailwayToken().token;
  const evidence = await deployAngularPreview({
    gql: liveRailwayGql(token, [token, password]),
    projectId: PROJECT_ID,
    stagingEnvironmentId: STAGING_ENV_ID,
    productionEnvironmentId: PRODUCTION_ENV_ID,
    serviceName: ANGULAR_PREVIEW_SERVICE_NAME,
    image,
    registryCredentials: { username, password },
    log: console.log,
  });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(`Wrote deployment evidence to ${evidencePath}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(sanitizeErrorBody(message));
    process.exitCode = 1;
  });
}
