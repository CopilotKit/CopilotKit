import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { policy, parseRunRecordsSnapshot } from "./contract.mts";
export const policyDigest = () =>
  createHash("sha256").update(JSON.stringify(policy)).digest("hex");
export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const roles = ["image-gate", "ruby-promotion", "harness"];
export function validateDistribution(targets) {
  assert.ok(Array.isArray(targets) && targets.length);
  for (const role of roles)
    assert.ok(
      targets.some((t) => t.consumer === role),
      `Missing registry consumer distribution: ${role}`,
    );
  for (const t of targets) {
    assert.match(t.host, /^[a-zA-Z0-9][a-zA-Z0-9@._-]*$/);
    assert.match(t.receiver, /^\/[a-zA-Z0-9/_.-]+$/);
    assert.match(t.recordsFile, /^\/[a-zA-Z0-9/_.-]+$/);
    assert.ok(roles.includes(t.consumer));
  }
}
export async function sshJson(target, request) {
  const child = spawn(
    "ssh",
    [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=10",
      target.host,
      "node",
      "--import",
      "tsx",
      target.receiver,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let oversized = false;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.length > 8 * 1024 * 1024) {
      oversized = true;
      child.kill("SIGKILL");
    }
  });
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(request));
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    assert.ok(
      code === 0 && !oversized,
      `Registry distribution failed for ${target.consumer}`,
    );
    return JSON.parse(stdout);
  } finally {
    clearTimeout(timer);
  }
}
/** All required consumer mirrors must acknowledge the exact validated bytes before create/ready. */
export async function distributeSnapshot(file, targets, send = sshJson) {
  validateDistribution(targets);
  const bytes = await readFile(file, "utf8");
  const snapshot = JSON.parse(bytes);
  const parsed = parseRunRecordsSnapshot(snapshot, policy, new Date());
  assert.ok(parsed.ok, "Refusing to distribute invalid ownership snapshot");
  const sha256 = digest(bytes);
  const acknowledgments = [];
  for (const target of targets) {
    const ack = await send(target, {
      snapshot,
      sha256,
      policySha256: policyDigest(),
      consumer: target.consumer,
    });
    assert.equal(ack.sha256, sha256, "Consumer snapshot digest mismatch");
    assert.equal(
      ack.policySha256,
      policyDigest(),
      "Consumer registry policy mismatch",
    );
    assert.equal(ack.consumer, target.consumer);
    assert.equal(
      ack.recordsFile,
      target.recordsFile,
      "Consumer reads a different ownership path",
    );
    assert.equal(ack.valid, true, "Consumer rejected configured evidence");
    acknowledgments.push(ack);
  }
  return { sha256, acknowledgments };
}
