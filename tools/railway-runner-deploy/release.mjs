import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { BUILD_WORKFLOW, requireThat, sha256 } from "./contract.mjs";
import { verifyBuild, readBaselineReceipt } from "./provenance.mjs";
import { createGithub, verifyRegistryImage } from "./github.mjs";

/** Create reviewable release data using read-only GitHub/GHCR access, never Railway credentials. */
export async function generateRelease({
  buildRun,
  baselineRun,
  bootstrapBaseline,
  bootstrapSha,
  github,
  verifyImage,
  recovery,
}) {
  requireThat(
    Boolean(baselineRun) !== Boolean(bootstrapBaseline),
    "Choose one explicit baseline source",
  );
  const run = await github.run(buildRun);
  const artifacts = (await github.artifacts(buildRun)).filter(
    (item) => item.name === "bounded-row1-image-candidates",
  );
  requireThat(artifacts.length === 1, "Unique build artifact required");
  const artifact = await github.artifact(artifacts[0].id);
  const archive = await github.archive(artifact);
  const candidate = {
    image: JSON.parse(archive["image-candidates.json"]).runner,
    runtimeIdentity: JSON.parse(archive["runner-identity.json"]),
  };
  const baseline = baselineRun
    ? await readBaselineReceipt(baselineRun, github, { bootstrapSha })
    : bootstrapBaseline;
  const release = {
    schemaVersion: 1,
    sourceRevision: run.head_sha,
    build: {
      runId: buildRun,
      runAttempt: run.run_attempt,
      workflowPath: BUILD_WORKFLOW,
      workflowSha256: sha256(
        await github.workflow(BUILD_WORKFLOW, run.head_sha),
      ),
      artifactId: artifact.id,
      artifactSha256: artifact.digest?.replace(/^sha256:/, ""),
    },
    baseline,
    candidate,
    ...(recovery === undefined ? {} : { recovery }),
  };
  await verifyBuild(release, github, { verifyImage });
  return release;
}
/** Replace the explicitly named reviewed release only after all checks have passed. */
export async function writeRelease(output, release) {
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(release, null, 2) + "\n", {
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
}
/** Resolve a local GitHub read token without printing credentials. */
export async function githubToken(env = process.env) {
  if (env.GITHUB_TOKEN || env.GH_TOKEN) return env.GITHUB_TOKEN || env.GH_TOKEN;
  const { stdout } = await promisify(execFile)("gh", ["auth", "token"], {
    maxBuffer: 65536,
  });
  return stdout.trim();
}
/** Generate a release for review or validate the reviewed file without provider credentials. */
async function main() {
  const { values } = parseArgs({
    options: {
      "build-run": { type: "string" },
      "baseline-run": { type: "string" },
      "bootstrap-baseline": { type: "string" },
      "bootstrap-deploy-sha": { type: "string" },
      output: { type: "string" },
      validate: { type: "string" },
      recovery: { type: "string" },
    },
  });
  const token = await githubToken();
  const github = createGithub({ token });
  const verifyImage = (image) => verifyRegistryImage(image, { token });
  if (values.validate) {
    requireThat(
      !values["build-run"] &&
        !values["baseline-run"] &&
        !values["bootstrap-baseline"] &&
        !values.recovery &&
        !values.output,
      "Validation accepts only the reviewed release path",
    );
    await verifyBuild(
      JSON.parse(await readFile(values.validate, "utf8")),
      github,
      { verifyImage },
    );
    console.log("Reviewed runner release provenance verified");
    return;
  }
  requireThat(
    /^\d+$/.test(values["build-run"] ?? "") && values.output,
    "Build run and output path required",
  );
  if (values["baseline-run"])
    requireThat(/^\d+$/.test(values["baseline-run"]), "Invalid baseline run");
  const release = await generateRelease({
    buildRun: Number(values["build-run"]),
    baselineRun: values["baseline-run"]
      ? Number(values["baseline-run"])
      : undefined,
    bootstrapBaseline: values["bootstrap-baseline"]
      ? JSON.parse(await readFile(values["bootstrap-baseline"], "utf8"))
      : undefined,
    bootstrapSha: values["bootstrap-deploy-sha"],
    github,
    verifyImage,
    recovery: values.recovery
      ? JSON.parse(await readFile(values.recovery, "utf8"))
      : undefined,
  });
  await writeRelease(values.output, release);
  console.log("Release record written for review");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Release provenance validation failed; no deployment performed",
    );
    process.exitCode = 1;
  });
