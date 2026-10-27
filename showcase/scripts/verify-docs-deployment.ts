import { execFileSync } from "node:child_process";
import { DOCS_GHCR_IMAGE } from "./docs-prod-pin";
import { domainFor, SERVICES, STAGING_ENV_ID } from "./railway-envs";
import { RAILWAY_GRAPHQL_ENDPOINT } from "./lib/railway-graphql";
import { IN_PROGRESS_DEPLOY_STATUSES } from "./lib/railway-deployment";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface ExpectedDocsImage {
  digests: string[];
}

function inspectImage(ref: string, format: "digest" | "manifest"): string {
  return execFileSync(
    "docker",
    [
      "buildx",
      "imagetools",
      "inspect",
      ref,
      ...(format === "digest"
        ? ["--format", "{{.Manifest.Digest}}"]
        : ["--raw"]),
    ],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  ).trim();
}

/** Read the immutable commit image through CI's existing GHCR login. Never run a container. */
export function readExpectedDocsImage(
  image: string,
  inspect: typeof inspectImage = inspectImage,
): ExpectedDocsImage {
  const tag = image.slice(DOCS_GHCR_IMAGE.length + 1);
  if (!image.startsWith(`${DOCS_GHCR_IMAGE}:`) || !/^[0-9a-f]{40}$/.test(tag)) {
    throw new Error(
      "docs verification requires the full built commit image reference",
    );
  }
  const digest = inspect(image, "digest").trim();
  if (!DIGEST.test(digest))
    throw new Error("docs commit image has no valid digest");
  if (inspect(`${DOCS_GHCR_IMAGE}:latest`, "digest").trim() !== digest) {
    throw new Error(
      "docs :latest no longer matches this build; refusing a superseded deployment",
    );
  }
  // Railway may report the index digest or its selected platform manifest.
  // Attestation manifests (unknown/unknown) are not runnable image identities.
  const manifest = JSON.parse(
    inspect(`${DOCS_GHCR_IMAGE}@${digest}`, "manifest"),
  ) as {
    schemaVersion?: number;
    manifests?: Array<{
      digest?: string;
      platform?: { os?: string; architecture?: string };
    }>;
    config?: object;
    layers?: unknown[];
  };
  if (manifest.schemaVersion !== 2)
    throw new Error("docs image manifest is invalid");
  const digests = [digest];
  if (Array.isArray(manifest.manifests)) {
    const platforms = manifest.manifests.filter(
      (m) =>
        m.platform?.os === "linux" &&
        m.platform.architecture === "amd64" &&
        typeof m.digest === "string" &&
        DIGEST.test(m.digest),
    );
    if (platforms.length !== 1)
      throw new Error(
        "docs image must contain exactly one linux/amd64 manifest",
      );
    digests.push(platforms[0].digest!);
  } else if (!manifest.config || !Array.isArray(manifest.layers)) {
    throw new Error("docs image manifest is invalid");
  }
  return { digests };
}

interface VerifyOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}

/** Bind SUCCESS to the deployment just created and the image CI published, then check its routes. */
export async function verifyDocsDeployment(
  token: string,
  deploymentId: string,
  expected: ExpectedDocsImage,
  options: VerifyOptions = {},
): Promise<{ imageDigest: string }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 150_000);
  let imageDigest: string;
  for (;;) {
    const response = await fetchImpl(RAILWAY_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        query: `query docsDeployment($id: String!) {
          deployment(id: $id) { id serviceId environmentId status meta }
        }`,
        variables: { id: deploymentId },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `docs deployment lookup returned HTTP ${response.status}`,
      );
    }
    const result = (await response.json()) as {
      errors?: unknown[];
      data?: {
        deployment?: {
          id?: string;
          serviceId?: string;
          environmentId?: string;
          status?: string;
          meta?: unknown;
        };
      };
    };
    if (result.errors?.length)
      throw new Error("docs deployment lookup returned GraphQL errors");
    const deployment = result.data?.deployment;
    if (
      deployment?.id !== deploymentId ||
      deployment.serviceId !== SERVICES.docs.serviceId ||
      deployment.environmentId !== STAGING_ENV_ID
    ) {
      throw new Error(
        "docs deployment identity does not match the requested service/environment/deployment",
      );
    }
    if (deployment.status === "SUCCESS") {
      const meta = (
        typeof deployment.meta === "string"
          ? JSON.parse(deployment.meta)
          : deployment.meta
      ) as {
        imageDigest?: unknown;
      } | null;
      const digest = meta?.imageDigest;
      if (typeof digest !== "string" || !expected.digests.includes(digest)) {
        throw new Error(
          `docs deployment ${deploymentId} image digest does not match the published image`,
        );
      }
      imageDigest = digest;
      break;
    }
    if (!IN_PROGRESS_DEPLOY_STATUSES.has(deployment.status ?? "")) {
      throw new Error(
        `docs deployment ${deploymentId} reached ${deployment.status ?? "UNKNOWN"}`,
      );
    }
    if (now() >= deadline)
      throw new Error(
        `docs deployment ${deploymentId} timed out waiting for SUCCESS`,
      );
    await sleep(Math.min(5_000, Math.max(0, deadline - now())));
  }

  for (const [path, marker] of [
    ["/generative-ui/components", "createGenerativeUI"],
    ["/generative-ui/components/standard-catalog", "standardUI"],
  ]) {
    const response = await fetchImpl(
      `https://${domainFor("docs", "staging")}${path}`,
      {
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      },
    );
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`docs ${path} returned HTTP ${response.status}`);
    }
    if (!(await response.text()).includes(marker))
      throw new Error(`docs ${path} is missing expected content`);
  }
  return { imageDigest };
}
