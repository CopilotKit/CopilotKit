import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const services = [
  ["appApi", "app-api", "apps/app-api/Dockerfile", ""],
  [
    "realtimeGateway",
    "realtime-gateway",
    "Dockerfile",
    "apps/realtime-gateway",
  ],
  ["migrations", "migrations", "app-db-migrations/Dockerfile", ""],
];
const identityFormat =
  '{"id":{{json .Id}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}';

/** Build local images from the clean committed checkout without untracked secrets. */
export async function buildCandidate({ source, directory, run }) {
  const cwd = resolve(source);
  // Test/media fixtures stay as committed LFS pointers; service builds do not consume them.
  const git = (args, step) =>
    run("git", args, {
      cwd,
      step,
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" },
    });
  const revision = (
    await git(["rev-parse", "HEAD"], "candidate-revision")
  ).trim();
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error("Candidate revision must be a full Git commit");
  if (
    (
      await git(
        ["status", "--porcelain", "--untracked-files=no"],
        "candidate-clean",
      )
    ).trim()
  ) {
    throw new Error("Candidate source must have clean tracked files");
  }
  const tag = `${revision}-${randomUUID()}`;
  const images = {};
  const dockerImages = [];
  const imageEvidence = [];
  try {
    for (const [key, name, dockerfile, subtree] of services) {
      const repository = `pe431-candidate/${name}`;
      const ref = `${repository}:${tag}`;
      const archive = resolve(directory, `candidate-${name}-${tag}.tar`);
      try {
        // The gateway Dockerfile expects its own directory as the build context.
        await git(
          [
            "archive",
            "--format=tar",
            "--output",
            archive,
            `${revision}${subtree ? `:${subtree}` : ""}`,
          ],
          `candidate-archive-${name}`,
        );
        dockerImages.push(ref);
        await run(
          "docker",
          [
            "build",
            "--file",
            dockerfile,
            "--tag",
            ref,
            "--label",
            `org.opencontainers.image.revision=${revision}`,
            "-",
          ],
          {
            cwd,
            step: `candidate-build-${name}`,
            timeoutMs: 1_800_000,
            input: await readFile(archive),
          },
        );
        const identity = JSON.parse(
          await run(
            "docker",
            ["image", "inspect", "--format", identityFormat, ref],
            { cwd, step: `candidate-inspect-${name}` },
          ),
        );
        if (identity.revision !== revision)
          throw new Error(
            `Candidate ${name} image revision does not match source`,
          );
        if (!/^sha256:[a-f0-9]{64}$/.test(identity.id ?? ""))
          throw new Error(`Candidate ${name} image identity is missing`);
        images[key] = { repository, tag, digest: "", pullPolicy: "Never" };
        imageEvidence.push({
          service: key,
          image: ref,
          id: identity.id,
          revision,
        });
      } finally {
        await rm(archive, { force: true });
      }
    }
  } catch (error) {
    const cleanupErrors = [];
    for (const ref of dockerImages) {
      try {
        const present = await run("docker", ["image", "ls", "--quiet", ref], {
          cwd,
          step: "candidate-cleanup-list",
          cleanup: true,
        });
        if (present.trim())
          await run("docker", ["image", "rm", "--force", ref], {
            cwd,
            step: "candidate-cleanup-image",
            cleanup: true,
          });
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length) {
      const failure = new Error(
        `${error.message}; candidate image cleanup failed`,
        { cause: error },
      );
      failure.cleanupErrors = cleanupErrors;
      throw failure;
    }
    throw error;
  }
  return { revision, images, dockerImages, imageEvidence };
}
