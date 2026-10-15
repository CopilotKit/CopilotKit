import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractRevisionLabel } from "../../../scripts/advance-latest-tag";
import { PROJECT_ID, resolveEnv } from "../../../scripts/railway-envs";
import { RAILWAY_GRAPHQL_ENDPOINT } from "../../../scripts/lib/railway-graphql";
import { resolveRailwayToken } from "../../../scripts/lib/railway-token";
import { COMPATIBILITY_MAPPING } from "./mapping";

const exec = promisify(execFile);
interface Metadata {
  errors?: unknown[];
  data?: {
    project?: {
      services: {
        edges: {
          node: {
            name: string;
            serviceInstances: {
              edges: {
                node: {
                  environmentId: string;
                  source: { image: string } | null;
                  latestDeployment?: { status: string } | null;
                  activeDeployments: {
                    status: string;
                    meta: { imageDigest?: string } | null;
                  }[];
                };
              }[];
            };
          };
        }[];
      };
    } | null;
  };
}

// Same non-terminal statuses used by the existing deployment verifier.
const inProgress = new Set([
  "QUEUED",
  "BUILDING",
  "INITIALIZING",
  "DEPLOYING",
  "WAITING",
  "NEEDS_APPROVAL",
]);
class DeploymentTransitionError extends Error {}

/** Active images only: failed builds and floating tags are never version evidence. */
export function selectDeployedImages(
  payload: Metadata,
  environmentId: string,
  slugs: string[],
): Record<string, string> {
  if (payload.errors?.length || !payload.data?.project)
    throw new Error("Railway deployment metadata is unavailable");
  const refs: Record<string, string> = {};
  let transition: DeploymentTransitionError | undefined;
  for (const slug of slugs) {
    const matches = payload.data.project.services.edges.filter(
      ({ node }) => node.name === `showcase-${slug}`,
    );
    if (matches.length !== 1)
      throw new Error(`Missing or ambiguous deployed service: ${slug}`);
    const instances = matches[0].node.serviceInstances.edges.filter(
      ({ node }) => node.environmentId === environmentId,
    );
    if (instances.length !== 1)
      throw new Error(`Missing or ambiguous deployment environment: ${slug}`);
    const instance = instances[0].node;
    const image = instance.source?.image?.split("@")[0].split(":")[0];
    if (!image || !/^ghcr\.io\/copilotkit\/[a-z0-9._-]+$/.test(image))
      throw new Error(
        `Missing or unsupported deployed image repository: ${slug}`,
      );
    const active = instance.activeDeployments;
    if (
      inProgress.has(instance.latestDeployment?.status ?? "") ||
      active.some((deployment) => inProgress.has(deployment.status))
    ) {
      transition ??= new DeploymentTransitionError(
        `Deployment is still settling: ${slug}`,
      );
      continue;
    }
    const digests = new Set(
      active.map((deployment) => deployment.meta?.imageDigest),
    );
    const digest = [...digests][0];
    if (
      active.length > 1 &&
      active.every(
        (deployment) =>
          deployment.status === "SUCCESS" &&
          /^sha256:[a-f0-9]{64}$/.test(deployment.meta?.imageDigest ?? ""),
      ) &&
      digests.size > 1
    ) {
      transition ??= new DeploymentTransitionError(
        `Deployment is still settling: ${slug}`,
      );
      continue;
    }
    if (
      !active.length ||
      active.some((deployment) => deployment.status !== "SUCCESS") ||
      digests.size !== 1 ||
      !digest ||
      !/^sha256:[a-f0-9]{64}$/.test(digest)
    )
      throw new Error(`Missing or ambiguous active image digest: ${slug}`);
    refs[slug] = `${image}@${digest}`;
  }
  if (transition) throw transition;
  return refs;
}

/** Wait for a stable active-image set; permanent evidence errors fail immediately. */
export async function waitForDeployedImages(
  readMetadata: () => Promise<Metadata>,
  environmentId: string,
  slugs: string[],
): Promise<Record<string, string>> {
  const waitMs = 600_000;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const payload = await readMetadata();
    try {
      return selectDeployedImages(payload, environmentId, slugs);
    } catch (error) {
      if (!(error instanceof DeploymentTransitionError)) throw error;
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error(
          `Deployment is still settling after ${waitMs}ms: ${error.message}`,
          { cause: error },
        );
      console.log(
        `Compatibility: ${error.message}; waiting for a stable active image`,
      );
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(15_000, remaining)),
      );
    }
  }
}

export async function collectDeployedCommits(
  environment: "prod" | "staging",
): Promise<Record<string, string>> {
  const { envId } = resolveEnv(environment);
  const { token } = resolveRailwayToken();
  const readMetadata = async (): Promise<Metadata> => {
    const response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        query: `query($id: String!) { project(id: $id) { services { edges { node {
        name serviceInstances { edges { node { environmentId source { image } latestDeployment { status }
          activeDeployments { status meta } } } }
      } } } } }`,
        variables: { id: PROJECT_ID },
      }),
    });
    if (!response.ok)
      throw new Error(
        `Railway deployment metadata request failed: HTTP ${response.status}`,
      );
    return response.json();
  };
  const slugs = COMPATIBILITY_MAPPING.filter(
    (variant) => variant.excludedReason === undefined,
  ).map((variant) => variant.slug);
  const refs = await waitForDeployedImages(readMetadata, envId, slugs);
  const commits: Record<string, string> = {};
  const inspected = new Map<string, string>();
  for (const [slug, ref] of Object.entries(refs)) {
    let commit = inspected.get(ref);
    if (!commit) {
      const { stdout } = await exec(
        "docker",
        ["buildx", "imagetools", "inspect", ref, "--format", "{{json .Image}}"],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      );
      const revision = extractRevisionLabel(stdout);
      if (!revision || !/^[a-fA-F0-9]{40}$/.test(revision))
        throw new Error(`Missing or ambiguous source commit label: ${slug}`);
      commit = revision.toLowerCase();
      inspected.set(ref, commit);
    }
    commits[slug] = commit;
  }
  return commits;
}
