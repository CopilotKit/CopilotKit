#!/usr/bin/env npx tsx
/**
 * float-staging-latest.ts — Set digest-pinned staging services back to
 * `ghcr.io/copilotkit/<repo>:latest`.
 *
 * Showcase CI requires staging `source.image` to be the mutable `:latest`
 * tag. A digest pin (often left after an operator pin or a promote-back)
 * fails `verify-railway-image-refs.ts` and skips every image build,
 * including unrelated services such as shell-docs.
 *
 * Usage:
 *   npx tsx showcase/scripts/float-staging-latest.ts
 *   npx tsx showcase/scripts/float-staging-latest.ts --dry-run
 *
 * Auth: RAILWAY_TOKEN or ~/.railway/config.json.
 * Exit: 0 when every digest-pinned staging instance was updated (or none
 * needed it). 1 on a per-service mutation failure. 2 on operator/config
 * errors.
 */

import { fileURLToPath } from "url";
import {
  ENV_ID_BY_NAME,
  PROJECT_ID,
  SERVICES,
  STAGING_ENV_ID,
  repoNameFor,
  workerProvisioningFor,
} from "./railway-envs";
import {
  RAILWAY_GRAPHQL_ENDPOINT,
  sanitizeErrorBody,
} from "./lib/railway-graphql";
import { RailwayTokenError, resolveRailwayToken } from "./lib/railway-token";

const RAILWAY_API = RAILWAY_GRAPHQL_ENDPOINT;

export function stagingLatestRef(repoName: string): string {
  return `ghcr.io/copilotkit/${repoName}:latest`;
}

/** True when a staging image is a digest pin instead of `:latest`. */
export function needsStagingFloat(image: string | null): boolean {
  return image !== null && image.includes("@sha256:");
}

interface ProjectServicesWithInstances {
  project: {
    services: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          serviceInstances: {
            edges: Array<{
              node: {
                environmentId: string;
                source: { image: string | null } | null;
              };
            }>;
          };
        };
      }>;
    };
  } | null;
}

export interface StagingFloatTarget {
  service: string;
  serviceId: string;
  current: string;
  next: string;
}

export function collectStagingFloatTargets(
  data: ProjectServicesWithInstances,
): StagingFloatTarget[] {
  const stagingEnvId = ENV_ID_BY_NAME.staging;
  const targets: StagingFloatTarget[] = [];
  if (!data.project) return targets;

  for (const edge of data.project.services.edges) {
    const svc = edge.node;
    const entry = SERVICES[svc.name];
    if (!entry || entry.gateIgnore || !entry.gateValidated) continue;
    if (!entry.environments.staging) continue;

    const instance = svc.serviceInstances.edges.find(
      (item) => item.node.environmentId === stagingEnvId,
    );
    const image = instance?.node.source?.image ?? null;
    if (!needsStagingFloat(image) || image === null) continue;

    targets.push({
      service: svc.name,
      serviceId: svc.id,
      current: image,
      next: stagingLatestRef(repoNameFor(svc.name, "staging")),
    });
  }

  return targets.sort((a, b) => a.service.localeCompare(b.service));
}

function getToken(): string {
  try {
    return resolveRailwayToken().token;
  } catch (e) {
    if (e instanceof RailwayTokenError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
}

async function railwayGql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(
      `Railway API error: ${res.status} ${sanitizeErrorBody(await res.text())}`,
    );
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(
      `Railway GraphQL errors:\n${json.errors.map((e) => `  - ${e.message}`).join("\n")}`,
    );
  }
  if (json.data === undefined) {
    throw new Error("Railway GraphQL returned no data");
  }
  return json.data;
}

function workerUpdateInput(image: string): Record<string, unknown> {
  const provisioning = workerProvisioningFor("harness-workers", "staging");
  if (provisioning === undefined) {
    throw new Error("harness-workers staging provisioning is missing from SSOT");
  }
  return {
    source: { image },
    restartPolicyType: provisioning.restartPolicyType,
    multiRegionConfig: {
      "us-west2": {
        numReplicas: provisioning.effectiveReplicas,
      },
    },
  };
}

async function floatService(
  token: string,
  target: StagingFloatTarget,
): Promise<void> {
  const input =
    target.service === "harness-workers"
      ? workerUpdateInput(target.next)
      : { source: { image: target.next } };

  await railwayGql(
    token,
    `mutation serviceInstanceUpdate($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`,
    {
      serviceId: target.serviceId,
      environmentId: STAGING_ENV_ID,
      input,
    },
  );

  await railwayGql(
    token,
    `mutation serviceInstanceDeployV2($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    {
      serviceId: target.serviceId,
      environmentId: STAGING_ENV_ID,
    },
  );
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const token = getToken();
  const data = await railwayGql<ProjectServicesWithInstances>(
    token,
    `query project($id: String!) {
      project(id: $id) {
        services {
          edges { node {
            id
            name
            serviceInstances {
              edges { node { environmentId source { image } } }
            }
          } }
        }
      }
    }`,
    { id: PROJECT_ID },
  );

  if (data.project === null || data.project === undefined) {
    throw new Error(
      `Railway project ${PROJECT_ID} returned null — check PROJECT_ID and token access.`,
    );
  }

  const targets = collectStagingFloatTargets(data);
  if (targets.length === 0) {
    console.log("No staging digest pins to float.");
    return;
  }

  for (const target of targets) {
    console.log(
      `${dryRun ? "[dry-run] " : ""}${target.service}: ${target.current} -> ${target.next}`,
    );
    if (!dryRun) {
      await floatService(token, target);
    }
  }

  if (dryRun) {
    console.log(`Would float ${targets.length} staging service(s).`);
    return;
  }

  const after = await railwayGql<ProjectServicesWithInstances>(
    token,
    `query project($id: String!) {
      project(id: $id) {
        services {
          edges { node {
            id
            name
            serviceInstances {
              edges { node { environmentId source { image } } }
            }
          } }
        }
      }
    }`,
    { id: PROJECT_ID },
  );
  const leftover = collectStagingFloatTargets(after);
  if (leftover.length > 0) {
    const names = leftover
      .map((item) => `${item.service}=${item.current}`)
      .join(", ");
    throw new Error(
      `Railway still has staging digest pins after float: ${names}`,
    );
  }

  console.log(`Floated ${targets.length} staging service(s) to :latest.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
