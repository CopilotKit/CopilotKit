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

/** Active images only: failed builds and floating tags are never version evidence. */
export function selectDeployedImages(
  payload: Metadata,
  environmentId: string,
  slugs: string[],
): Record<string, string> {
  if (payload.errors?.length || !payload.data?.project)
    throw new Error("Railway deployment metadata is unavailable");
  const refs: Record<string, string> = {};
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
    const digests = new Set(
      active.map((deployment) => deployment.meta?.imageDigest),
    );
    const digest = [...digests][0];
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
  return refs;
}

export async function collectDeployedCommits(
  environment: "prod" | "staging",
): Promise<Record<string, string>> {
  const { envId } = resolveEnv(environment);
  const { token } = resolveRailwayToken();
  const response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      query: `query($id: String!) { project(id: $id) { services { edges { node {
        name serviceInstances { edges { node { environmentId source { image }
          activeDeployments { status meta } } } }
      } } } } }`,
      variables: { id: PROJECT_ID },
    }),
  });
  if (!response.ok)
    throw new Error(
      `Railway deployment metadata request failed: HTTP ${response.status}`,
    );
  const slugs = COMPATIBILITY_MAPPING.filter(
    (variant) => variant.excludedReason === undefined,
  ).map((variant) => variant.slug);
  const refs = selectDeployedImages(await response.json(), envId, slugs);
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
