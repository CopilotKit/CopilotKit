import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  stat,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPinnedSeed, installBootstrap } from "./bootstrap-seed.mjs";

test("private seed is hash checked before replacement and retained across startup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bootstrap-seed-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("fixture-only private source\n");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const args = { directory, sha256 };
  await assert.rejects(installPinnedSeed(args), { code: "ENOENT" });
  const path = await installPinnedSeed({
    ...args,
    seed: bytes.toString("base64"),
  });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(path), bytes);
  assert.equal(await installPinnedSeed(args), path);
  await assert.rejects(
    installPinnedSeed({
      ...args,
      seed: Buffer.from("wrong").toString("base64"),
    }),
    /digest mismatch/,
  );
  assert.deepEqual(await readFile(path), bytes);
  await assert.rejects(
    installPinnedSeed({ ...args, seed: "not base64!" }),
    /canonical base64/,
  );
  await writeFile(path, "corrupt");
  await assert.rejects(installPinnedSeed(args), /digest mismatch/);
  await rm(path);
  const other = join(directory, "other");
  await writeFile(other, bytes, { mode: 0o600 });
  await symlink(other, path);
  await assert.rejects(installPinnedSeed(args), /owner-only regular file/);
});

test("runner cannot override committed bootstrap provenance", async () => {
  await assert.rejects(
    installBootstrap({
      root: "/data",
      template: {
        bootstrap: {
          sourceRevision: "unreviewed",
          sha256: "0".repeat(64),
          scriptPath: "/data/private/bootstrap-self-hosted.sh",
        },
      },
      seed: "",
    }),
  );
});
