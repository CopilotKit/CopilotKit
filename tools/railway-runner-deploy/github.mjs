import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPOSITORY,
  DEPLOY_WORKFLOW,
  IMAGE,
  requireThat,
  sha256,
} from "./contract.mjs";
import { boundedBytes } from "./adapters.mjs";
import { validateArtifactTime } from "./provenance.mjs";
const execute = promisify(execFile);
/** Read only a fixed allowlist of bounded ZIP members with the trusted Python standard library. */
export async function readArchive(bytes) {
  requireThat(
    bytes.length <= 8 * 1024 * 1024,
    "Artifact archive exceeds bound",
  );
  const directory = await mkdtemp(join(tmpdir(), "runner-release-"));
  try {
    const path = join(directory, "artifact.zip");
    await writeFile(path, bytes, { mode: 0o600 });
    const { stdout } = await execute(
      "python3",
      [fileURLToPath(new URL("./archive.py", import.meta.url)), path],
      { maxBuffer: 24 * 1024 * 1024, timeout: 30000 },
    );
    return Object.fromEntries(
      Object.entries(JSON.parse(stdout)).map(([name, base64]) => [
        name,
        Buffer.from(base64, "base64"),
      ]),
    );
  } catch {
    throw new Error("Artifact archive refused");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
/** Use only fixed GitHub API paths; signed artifact URLs receive no authorization header. */
export function createGithub({
  token,
  fetch = globalThis.fetch,
  unzip = readArchive,
}) {
  requireThat(
    typeof token === "string" && token.length > 0,
    "GitHub read credential required",
  );
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const response = async (path, extra = {}) => {
    requireThat(
      path.startsWith(`/repos/${REPOSITORY}/`),
      "Foreign GitHub API path refused",
    );
    return fetch(`https://api.github.com${path}`, {
      headers: { ...headers, ...extra },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
  };
  const bytes = async (path, extra) => {
    const result = await response(path, extra);
    requireThat(result.ok, "GitHub request refused");
    return boundedBytes(result, 8 * 1024 * 1024);
  };
  const json = async (path) =>
    JSON.parse(await bytes(`/repos/${REPOSITORY}${path}`));
  const api = {
    run: (id, attempt) =>
      json(`/actions/runs/${id}${attempt ? `/attempts/${attempt}` : ""}`),
    workflow: (path, revision) =>
      bytes(`/repos/${REPOSITORY}/contents/${path}?ref=${revision}`, {
        accept: "application/vnd.github.raw+json",
      }),
    artifact: (id) => json(`/actions/artifacts/${id}`),
    async artifacts(runId) {
      const result = await json(
        `/actions/runs/${runId}/artifacts?per_page=100`,
      );
      requireThat(
        result.total_count <= 100 && Array.isArray(result.artifacts),
        "Artifact list exceeds bound",
      );
      return result.artifacts;
    },
    async archive(artifact) {
      let result = await response(
        `/repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`,
      );
      for (
        let redirects = 0;
        [301, 302, 303, 307, 308].includes(result.status);
        redirects++
      ) {
        requireThat(redirects < 3, "Artifact redirect bound exceeded");
        const url = new URL(result.headers.get("location"));
        requireThat(
          url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.port &&
            (url.hostname.endsWith(".blob.core.windows.net") ||
              url.hostname.endsWith(".actions.githubusercontent.com")),
          "Artifact redirect origin refused",
        );
        await result.body?.cancel();
        result = await fetch(url.href, {
          redirect: "manual",
          signal: AbortSignal.timeout(30000),
        });
      }
      requireThat(result.ok, "Artifact download refused");
      const archive = await boundedBytes(result, 8 * 1024 * 1024);
      requireThat(
        artifact.digest === `sha256:${sha256(archive)}`,
        "Artifact archive digest mismatch",
      );
      return unzip(archive);
    },
    async receipt(run) {
      const artifacts = await api.artifacts(run.id);
      const matches = artifacts.filter(
        (item) => item.name === `runner-deployment-receipt-${run.run_attempt}`,
      );
      requireThat(matches.length === 1, "Unique deployment receipt required");
      const artifact = await api.artifact(matches[0].id);
      requireThat(
        artifact.expired === false &&
          artifact.size_in_bytes > 0 &&
          artifact.size_in_bytes <= 8 * 1024 * 1024 &&
          artifact.workflow_run?.id === run.id &&
          artifact.workflow_run.head_sha === run.head_sha,
        "Deployment receipt artifact mismatch",
      );
      validateArtifactTime(artifact, run);
      const archive = await api.archive(artifact);
      requireThat(
        Object.keys(archive).length === 1 && archive["deployment-receipt.json"],
        "Invalid receipt archive",
      );
      const receipt = JSON.parse(archive["deployment-receipt.json"]);
      requireThat(
        receipt.run?.workflowSha256 ===
          sha256(await api.workflow(DEPLOY_WORKFLOW, run.head_sha)),
        "Deployment workflow digest mismatch",
      );
      return receipt;
    },
  };
  return api;
}
/** Prove that GHCR serves the reviewed OCI manifest bytes for this digest. */
export async function verifyRegistryImage(
  image,
  {
    token,
    username = process.env.GITHUB_ACTOR ?? "x-access-token",
    fetch = globalThis.fetch,
  },
) {
  requireThat(IMAGE.test(image), "Immutable runner image required");
  const authentication = await fetch(
    "https://ghcr.io/token?service=ghcr.io&scope=repository:copilotkit/rich-thread-runner:pull",
    {
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  requireThat(authentication.ok, "Registry authentication refused");
  const access = JSON.parse(await boundedBytes(authentication, 65536));
  requireThat(
    typeof access.token === "string" && access.token.length > 0,
    "Registry authentication refused",
  );
  const digest = image.split("@")[1];
  const manifest = await fetch(
    `https://ghcr.io/v2/copilotkit/rich-thread-runner/manifests/${digest}`,
    {
      headers: {
        authorization: `Bearer ${access.token}`,
        accept:
          "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  requireThat(
    manifest.ok &&
      `sha256:${sha256(await boundedBytes(manifest, 4 * 1024 * 1024))}` ===
        digest,
    "Registry image digest mismatch",
  );
}
