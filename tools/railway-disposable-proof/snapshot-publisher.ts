import { randomUUID, createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DISPOSABLE_LIFECYCLE_POLICY } from "../../showcase/scripts/railway-envs";
import {
  parseRailwayLifecyclePolicy,
  parseRunRecordsSnapshot,
} from "../../showcase/harness/src/shared/railway-lifecycle";
import type {
  RunRecord,
  RunRecordsSnapshot,
} from "../../showcase/harness/src/shared/railway-lifecycle";

function validate(input: unknown, now: Date): RunRecordsSnapshot {
  const policy = parseRailwayLifecyclePolicy(DISPOSABLE_LIFECYCLE_POLICY);
  if (!policy.ok)
    throw new Error(
      `Invalid committed policy: ${policy.issues.map((i) => i.code).join(",")}`,
    );
  const parsed = parseRunRecordsSnapshot(input, policy.value, now);
  if (!parsed.ok)
    throw new Error(
      `Invalid run snapshot: ${parsed.issues.map((i) => i.code).join(",")}`,
    );
  return parsed.value;
}

async function privateDirectory(directory: string) {
  const stat = await lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o022) !== 0 ||
    stat.uid !== process.getuid?.()
  ) {
    throw new Error(
      "Snapshot parent must be an operator-owned directory without group/other writes",
    );
  }
}

function retainOwnership(before: RunRecord, after: RunRecord) {
  for (const key of [
    "projectId",
    "environmentId",
    "startedAt",
    "expiresAt",
  ] as const) {
    if (before[key] !== after[key]) throw new Error(`Run ${key} cannot change`);
  }
  for (const service of before.services) {
    if (
      !after.services.some(
        (s) =>
          s.serviceId === service.serviceId &&
          s.name === service.name &&
          s.expectedImage === service.expectedImage,
      )
    ) {
      throw new Error("Previously recorded service ownership must be retained");
    }
  }
  for (const resource of before.resources) {
    if (
      !after.resources.some(
        (r) => r.kind === resource.kind && r.id === resource.id,
      )
    ) {
      throw new Error(
        "Previously recorded resource ownership must be retained",
      );
    }
  }
  const allowed = {
    setup: ["setup", "ready", "teardown", "interrupted"],
    ready: ["ready", "teardown", "interrupted"],
    teardown: ["teardown", "complete", "interrupted"],
    interrupted: ["interrupted", "teardown"],
    complete: ["complete"],
  };
  if (!allowed[before.phase].includes(after.phase))
    throw new Error("Invalid lifecycle phase transition");
}

/** Local durable publication seam, not provisioning, deletion authority or remote distribution.
 * Call initialize explicitly once. Never infer an empty snapshot from a missing file.
 * A controller crash can leave .lock: recovery must inspect it, never auto-steal it.
 */
export async function publishSnapshot(
  filePath: string,
  change: { initialize: true } | { run: RunRecord },
  now = new Date(),
) {
  const file = resolve(filePath);
  const directory = dirname(file);
  await privateDirectory(directory);
  const lock = `${file}.lock`;
  await mkdir(lock, { mode: 0o700 });
  const temporary = join(directory, `.snapshot-${randomUUID()}.tmp`);
  try {
    let current: RunRecordsSnapshot;
    if ("initialize" in change) {
      // Under the same writer lock; all subsequent publications require existing evidence.
      let exists = true;
      try {
        await lstat(file);
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
        exists = false;
      }
      if (exists) throw new Error("Snapshot already exists");
      current = validate({ schemaVersion: 1, runs: [] }, now);
    } else {
      const stat = await lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o022) !== 0 ||
        stat.uid !== process.getuid?.()
      )
        throw new Error(
          "Snapshot file must be operator-owned and private to writers",
        );
      current = validate(JSON.parse(await readFile(file, "utf8")), now);
      const old = current.runs.find((run) => run.runId === change.run.runId);
      if (old) retainOwnership(old, change.run);
      current = validate(
        {
          schemaVersion: 1,
          runs: [
            ...current.runs.filter((run) => run.runId !== change.run.runId),
            change.run,
          ],
        },
        now,
      );
    }
    const bytes = `${JSON.stringify(current, null, 2)}\n`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
    // Digest lets a future distributor require exact reader acknowledgments.
    return {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      snapshot: current,
    };
  } finally {
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true });
  }
}
