import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { open, rename, rm, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSource } from "../bootstrap.mjs";
import { authority } from "../journal.mjs";

// Source bytes are provided privately by the operator, never included in the image.
export async function installPinnedSeed({ directory, sha256, seed }) {
  await authority(directory);
  const path = join(directory, "bootstrap-self-hosted.sh");
  let bytes;
  if (seed !== undefined) {
    assert.ok(
      typeof seed === "string" && seed.length > 0 && seed.length <= 2_800_000,
      "Bootstrap seed missing or oversized",
    );
    bytes = Buffer.from(seed, "base64");
    assert.equal(
      bytes.toString("base64"),
      seed,
      "Bootstrap seed is not canonical base64",
    );
  } else {
    const stat = await lstat(path);
    assert.ok(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size <= 2_000_000 &&
        (stat.mode & 0o077) === 0 &&
        stat.uid === process.getuid?.(),
      "Retained bootstrap must be an owner-only regular file",
    );
    bytes = await readFile(path);
  }
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    sha256,
    "Bootstrap seed digest mismatch",
  );
  if (seed === undefined) return path;
  const temporary = join(directory, `.bootstrap-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const dir = await open(directory, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}

export async function installBootstrap({ root, template, seed }) {
  assert.equal(
    template.bootstrap?.sourceRevision,
    bootstrapSource.sourceRevision,
  );
  assert.equal(template.bootstrap?.sha256, bootstrapSource.sha256);
  assert.equal(
    template.bootstrap?.scriptPath,
    join(root, "private/bootstrap-self-hosted.sh"),
  );
  return installPinnedSeed({
    directory: join(root, "private"),
    sha256: bootstrapSource.sha256,
    seed,
  });
}
