import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RAILWAY_GRAPHQL_ENDPOINT } from "./lib/railway-graphql";
import { IN_PROGRESS_DEPLOY_STATUSES } from "./lib/railway-deployment";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface ExpectedImage {
  digests: string[];
}

const execFileAsync = promisify(execFile);

async function inspectImage(
  ref: string,
  format: "digest" | "manifest",
): Promise<string> {
  const { stdout } = await execFileAsync(
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
  );
  return stdout.trim();
}

/** Resolve a selected image before deployment, including its runnable amd64 identity. */
export async function readExpectedImage(
  image: string,
  options: {
    requireCommit?: boolean;
    checkLatest?: boolean;
    label?: string;
  } = {},
  inspect: (
    ref: string,
    format: "digest" | "manifest",
  ) => string | Promise<string> = inspectImage,
): Promise<ExpectedImage> {
  const label = options.label ?? "image";
  const match =
    /^(ghcr\.io\/copilotkit\/[a-z0-9][a-z0-9/_-]*)(?::([a-zA-Z0-9._-]+)|@(sha256:[0-9a-f]{64}))$/.exec(
      image,
    );
  if (
    !match ||
    (options.requireCommit && !/^[0-9a-f]{40}$/.test(match[2] ?? ""))
  ) {
    throw new Error(
      `${label} verification requires ${options.requireCommit ? "the full built commit" : "a valid GHCR"} image reference`,
    );
  }
  const repository = match[1];
  const digest = (await inspect(image, "digest")).trim();
  if (!DIGEST.test(digest))
    throw new Error(`${label} image has no valid digest`);
  if (
    options.checkLatest &&
    (await inspect(`${repository}:latest`, "digest")).trim() !== digest
  ) {
    throw new Error(
      `${label} :latest no longer matches this build; refusing a superseded deployment`,
    );
  }
  // Railway may report the index digest or its selected platform manifest.
  // Attestation manifests (unknown/unknown) are not runnable image identities.
  const manifest = JSON.parse(
    await inspect(`${repository}@${digest}`, "manifest"),
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
    throw new Error(`${label} image manifest is invalid`);
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
        `${label} image must contain exactly one linux/amd64 manifest`,
      );
    digests.push(platforms[0].digest!);
  } else if (!manifest.config || !Array.isArray(manifest.layers)) {
    throw new Error(`${label} image manifest is invalid`);
  }
  return { digests };
}
export interface VerifyImageOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}

/** Bind SUCCESS to the exact deployment, service, environment and selected image. */
export async function verifyImageDeployment(
  token: string,
  deploymentId: string,
  expected: ExpectedImage,
  target: { serviceId: string; environmentId: string; label?: string },
  options: VerifyImageOptions = {},
): Promise<{ imageDigest: string }> {
  const label = target.label ?? "image";
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
        query: `query imageDeployment($id: String!) {
          deployment(id: $id) { id serviceId environmentId status meta }
        }`,
        variables: { id: deploymentId },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `${label} deployment lookup returned HTTP ${response.status}`,
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
      throw new Error(`${label} deployment lookup returned GraphQL errors`);
    const deployment = result.data?.deployment;
    if (
      deployment?.id !== deploymentId ||
      deployment.serviceId !== target.serviceId ||
      deployment.environmentId !== target.environmentId
    ) {
      throw new Error(
        `${label} deployment identity does not match the requested service/environment/deployment`,
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
          `${label} deployment ${deploymentId} image digest does not match the published image`,
        );
      }
      imageDigest = digest;
      break;
    }
    if (
      deployment.status === "NEEDS_APPROVAL" ||
      !IN_PROGRESS_DEPLOY_STATUSES.has(deployment.status ?? "")
    ) {
      throw new Error(
        `${label} deployment ${deploymentId} reached ${deployment.status ?? "UNKNOWN"}`,
      );
    }
    if (now() >= deadline)
      throw new Error(
        `${label} deployment ${deploymentId} timed out waiting for SUCCESS`,
      );
    await sleep(Math.min(5_000, Math.max(0, deadline - now())));
  }

  return { imageDigest };
}
