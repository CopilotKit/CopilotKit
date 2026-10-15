import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, stat, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSshSeed } from "./ssh-seed.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "runner-ssh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "fixture");
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path]);
  return {
    directory: join(root, "ssh"),
    privateKeyBase64: (await readFile(path)).toString("base64"),
    publicKey: (await readFile(`${path}.pub`, "utf8")).trim(),
    knownHosts: `ssh.railway.com ${(await readFile(`${path}.pub`, "utf8")).trim()}\n`,
  };
}

test("SSH startup installs a matched key and strict host trust without prompting", async (t) => {
  const args = await fixture(t);
  await installSshSeed(args);
  assert.equal(
    (await stat(join(args.directory, "id_ed25519"))).mode & 0o777,
    0o600,
  );
  assert.equal((await stat(args.directory)).mode & 0o777, 0o700);
  assert.equal(
    execFileSync(
      "ssh-keygen",
      ["-y", "-f", join(args.directory, "id_ed25519")],
      { encoding: "utf8" },
    )
      .trim()
      .split(" ")
      .slice(0, 2)
      .join(" "),
    args.publicKey.split(" ").slice(0, 2).join(" "),
  );
  const config = await readFile(join(args.directory, "config"), "utf8");
  assert.match(config, /StrictHostKeyChecking yes/);
  assert.match(config, /BatchMode yes/);
  await installSshSeed(args);
  assert.equal(
    await readFile(join(args.directory, "known_hosts"), "utf8"),
    args.knownHosts,
  );
});

test("SSH startup refuses missing, mismatched, or malformed credentials", async (t) => {
  const args = await fixture(t);
  await assert.rejects(
    installSshSeed({ ...args, privateKeyBase64: undefined }),
    /SSH private seed/,
  );
  await assert.rejects(
    installSshSeed({ ...args, privateKeyBase64: "bad!" }),
    /SSH private seed/,
  );
  const other = await fixture(t);
  await assert.rejects(
    installSshSeed({ ...args, publicKey: other.publicKey }),
    /SSH public key mismatch/,
  );
  await assert.rejects(
    installSshSeed({
      ...args,
      knownHosts: "untrusted.example ssh-ed25519 AAAA",
    }),
    /Railway host key/,
  );
});

test("SSH startup refuses a symlink directory", async (t) => {
  const args = await fixture(t);
  await symlink(tmpdir(), args.directory);
  await assert.rejects(installSshSeed(args));
});
