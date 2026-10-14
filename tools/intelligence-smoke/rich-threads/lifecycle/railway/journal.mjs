import { processOwner, ownerAlive } from "./process-owner.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { open, rename, mkdir, lstat, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
export async function durableJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function authority(directory) {
  const stat = await lstat(directory);
  assert.ok(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (stat.mode & 0o022) === 0 &&
      stat.uid === process.getuid?.(),
    "Operator-owned durable control directory required",
  );
}
export async function acquire(directory, runId) {
  await authority(directory);
  const path = join(directory, "active-run");
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST")
      throw Object.assign(
        new Error("Run overlap or unresolved cleanup: skip and flag this tick"),
        { code: "RICH_RUN_OVERLAP" },
      );
    throw error;
  }
  const lease = {
    runId,
    token: randomUUID(),
    ...(await processOwner()),
    createdAt: new Date().toISOString(),
  };
  await durableJson(join(path, "lease.json"), lease);
  return lease;
}
export async function release(directory, lease) {
  const actual = JSON.parse(
    await readFile(join(directory, "active-run", "lease.json"), "utf8"),
  );
  assert.equal(
    actual.token,
    lease.token,
    "Refusing to release another controller lease",
  );
  await rm(join(directory, "active-run"), { recursive: true });
}

/** Atomically publish a complete lock owner. Dead-owner recovery retains a stable tombstone;
 * a competing stale remover cannot rename a replacement lock over that nonempty directory.
 */
export async function recoveryLock(path) {
  const owner = {
    ...(await processOwner()),
    token: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const candidate = `${path}.candidate-${owner.token}`;
  await mkdir(candidate, { mode: 0o700 });
  await durableJson(join(candidate, "owner.json"), owner);
  try {
    try {
      await rename(candidate, path);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      const previous = JSON.parse(
        await readFile(join(path, "owner.json"), "utf8"),
      );
      assert.match(previous.token, /^[a-f0-9-]{36}$/);
      assert.ok(Number.isSafeInteger(previous.pid) && previous.pid > 0);
      assert.ok(!(await ownerAlive(previous)), "Recovery owner is still alive");
      await rename(path, `${path}.recovered-${previous.token}`);
      await rename(candidate, path);
    }
    return async () => {
      const actual = JSON.parse(
        await readFile(join(path, "owner.json"), "utf8"),
      );
      assert.equal(actual.token, owner.token);
      await rm(path, { recursive: true });
    };
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}
