import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RAILWAY_GRAPHQL_ENDPOINT } from "./lib/railway-graphql";
import { IN_PROGRESS_DEPLOY_STATUSES } from "./lib/railway-deployment";

import { extractRevisionLabel, parseCompareStatus } from "./advance-latest-tag";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface ExpectedImage {
  digests: string[];
  build?: { repository: string; sha: string };
}

export class SupersededImageError extends Error {
  constructor(
    readonly supersededBy: string,
    readonly supersedingImageDigest: string,
  ) {
    super(
      `Image superseded by newer build ${supersededBy} (${supersedingImageDigest})`,
    );
    this.name = "SupersededImageError";
  }
}

type ImageInspector = (
  ref: string,
  format: "digest" | "manifest" | "config",
) => string | Promise<string>;
type CompareRevisions = (
  repository: string,
  base: string,
  head: string,
) => Promise<string>;
const execFileAsync = promisify(execFile);
const PROCESS_OPTIONS = {
  encoding: "utf8" as const,
  timeout: 30_000,
  maxBuffer: 4 * 1024 * 1024,
};

async function compareRevisions(
  repository: string,
  base: string,
  head: string,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", `repos/${repository}/compare/${base}...${head}`, "--jq", ".status"],
    PROCESS_OPTIONS,
  );
  return stdout;
}

/** Missing ownership evidence must preserve the original verification failure. */
async function proveSuperseded(
  build: ExpectedImage["build"],
  inspect: ImageInspector,
  compare: CompareRevisions,
  observedDigest?: string,
  candidateDigest?: string,
): Promise<SupersededImageError | undefined> {
  if (!build || !/^[0-9a-f]{40}$/.test(build.sha)) return;
  try {
    const digest =
      candidateDigest ??
      (await inspect(`${build.repository}:latest`, "digest")).trim();
    if (!DIGEST.test(digest)) return;
    const candidate = await readExpectedImage(
      `${build.repository}@${digest}`,
      {},
      inspect,
    );
    if (
      candidate.digests[0] !== digest ||
      (observedDigest !== undefined &&
        !candidate.digests.includes(observedDigest))
    )
      return;
    const revision = extractRevisionLabel(
      await inspect(`${build.repository}@${digest}`, "config"),
    );
    if (!revision || !/^[0-9a-f]{40}$/.test(revision) || revision === build.sha)
      return;
    const repository = process.env.GITHUB_REPOSITORY ?? "CopilotKit/CopilotKit";
    if (
      !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository)
    )
      return;
    // Reversed compare: only `behind` proves candidate is a strict descendant.
    if (
      parseCompareStatus(await compare(repository, revision, build.sha)) !==
      "behind"
    )
      return;
    return new SupersededImageError(revision, digest);
  } catch {
    return;
  }
}

async function inspectImage(
  ref: string,
  format: "digest" | "manifest" | "config",
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
        : format === "config"
          ? ["--format", "{{json .Image}}"]
          : ["--raw"]),
    ],
    PROCESS_OPTIONS,
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
    compare?: CompareRevisions;
  } = {},
  inspect: ImageInspector = inspectImage,
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
  const build = options.requireCommit
    ? { repository, sha: match[2]! }
    : undefined;
  if (options.checkLatest) {
    const latest = (await inspect(`${repository}:latest`, "digest")).trim();
    if (latest !== digest) {
      const superseded = await proveSuperseded(
        build,
        inspect,
        options.compare ?? compareRevisions,
        undefined,
        latest,
      );
      if (superseded) throw superseded;
      throw new Error(
        `${label} :latest no longer matches this build; refusing a superseded deployment`,
      );
    }
  }
  return { digests, ...(build ? { build } : {}) };
}
export interface VerifyImageOptions {
  inspect?: ImageInspector;
  compare?: CompareRevisions;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}

function isTransientFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  const codes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENETUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
  ]);
  const code = "code" in error ? error.code : undefined;
  const cause = error.cause;
  const causeCode =
    cause && typeof cause === "object" && "code" in cause
      ? cause.code
      : undefined;
  if (
    (typeof code === "string" && codes.has(code)) ||
    (typeof causeCode === "string" && codes.has(causeCode))
  )
    return true;
  // Native fetch can omit a cause. An explicit, unrecognized cause must fail closed.
  return (
    error instanceof TypeError &&
    error.message === "fetch failed" &&
    code === undefined &&
    cause == null
  );
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
    let response: Response;
    try {
      response = await fetchImpl(RAILWAY_GRAPHQL_ENDPOINT, {
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
    } catch (error) {
      if (!isTransientFetchError(error) || now() >= deadline) throw error;
      await sleep(Math.min(5_000, Math.max(0, deadline - now())));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (
        (response.status === 429 ||
          (response.status >= 500 && response.status <= 599)) &&
        now() < deadline
      ) {
        await sleep(Math.min(5_000, Math.max(0, deadline - now())));
        continue;
      }
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
        // Ownership can excuse only a valid SUCCESS image from this exact deployment.
        if (typeof digest === "string" && DIGEST.test(digest)) {
          const superseded = await proveSuperseded(
            expected.build,
            options.inspect ?? inspectImage,
            options.compare ?? compareRevisions,
            digest,
          );
          if (superseded) throw superseded;
        }
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
