import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { authority } from "../journal.mjs";

const exec = promisify(execFile);

/** Restore a registered runner identity and operator-supplied host trust privately. */
export async function installSshSeed({
  directory,
  privateKeyBase64,
  publicKey,
  knownHosts,
}) {
  assert.ok(
    typeof privateKeyBase64 === "string" &&
      privateKeyBase64.length > 0 &&
      privateKeyBase64.length < 16_384,
    "SSH private seed required",
  );
  const bytes = Buffer.from(privateKeyBase64, "base64");
  assert.equal(
    bytes.toString("base64"),
    privateKeyBase64,
    "SSH private seed must be canonical base64",
  );
  assert.ok(
    typeof publicKey === "string" &&
      /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: [^\r\n]*)?$/.test(publicKey),
    "SSH public key required",
  );
  assert.ok(
    typeof knownHosts === "string" &&
      knownHosts.length < 16_384 &&
      /^ssh\.railway\.com ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: [^\r\n]*)?\n?$/.test(
        knownHosts,
      ),
    "Verified Railway host key required",
  );
  await mkdir(directory, { mode: 0o700 }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  await authority(directory);
  const temporary = join(directory, `.identity-${randomUUID()}`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    let derived;
    try {
      derived = (
        await exec("ssh-keygen", ["-y", "-f", temporary], {
          timeout: 5_000,
          maxBuffer: 16_384,
        })
      ).stdout.trim();
    } catch {
      throw new Error("SSH private seed is invalid or requires a passphrase");
    }
    assert.equal(
      derived.split(" ").slice(0, 2).join(" "),
      publicKey.split(" ").slice(0, 2).join(" "),
      "SSH public key mismatch",
    );
    await rename(temporary, join(directory, "id_ed25519"));
    for (const [name, value] of Object.entries({
      "id_ed25519.pub": `${publicKey}\n`,
      known_hosts: knownHosts,
      config:
        "Host ssh.railway.com\n  BatchMode yes\n  IdentitiesOnly yes\n  StrictHostKeyChecking yes\n",
    })) {
      const staged = join(directory, `.config-${randomUUID()}`);
      try {
        await writeFile(staged, value, { flag: "wx", mode: 0o600 });
        await rename(staged, join(directory, name));
      } finally {
        await rm(staged, { force: true });
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
