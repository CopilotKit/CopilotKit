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
    if (t.transport === "https") {
      const url = new URL(t.recordsFile);
      assert.ok(
        url.protocol === "https:" &&
          url.pathname === "/registry" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash,
      );
      assert.ok(roles.includes(t.consumer));
      continue;
    }
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
/** Verify current publication and each configured consumer transport before create/ready. */
export async function distributeSnapshot(file, targets, send = registrySend) {
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

export async function registrySend(target, request) {
  if (target.transport !== "https") return sshJson(target, request);
  const token = process.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN;
  assert.ok(token, "Registry authentication missing");
  const options = {
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  };
  const response = await fetch(target.recordsFile, options);
  assert.ok(response.ok, "Published registry unavailable");
  const bytes = await boundedResponse(response, 8 * 1024 * 1024);
  assert.equal(digest(bytes), request.sha256);
  assert.equal(response.headers.get("x-snapshot-sha256"), request.sha256);
  assert.equal(response.headers.get("x-policy-sha256"), request.policySha256);
  const activation = await fetch(
    new URL(`/consumers/${target.consumer}`, target.recordsFile),
    options,
  );
  assert.ok(activation.ok, "Consumer activation not observed");
  const ack = JSON.parse(await boundedResponse(activation, 16_384));
  assert.equal(
    ack.recordsFile,
    target.recordsFile,
    "Consumer activated another transport",
  );
  assert.ok(
    ack.consumer === target.consumer &&
      ack.reader === "railway-lifecycle-records-v1" &&
      ack.policySha256 === request.policySha256 &&
      /^[a-f0-9]{64}$/.test(ack.sha256) &&
      Number.isFinite(Date.parse(ack.at)) &&
      Date.parse(ack.at) <= Date.now(),
    "Consumer activation missing or incompatible",
  );
  return {
    consumer: target.consumer,
    recordsFile: target.recordsFile,
    sha256: digest(bytes),
    policySha256: response.headers.get("x-policy-sha256"),
    valid: true,
    activatedAt: ack.at,
  };
}

async function boundedResponse(response, limit) {
  assert.ok(response.body, "Registry response body missing");
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    assert.ok(size <= limit, "Registry response exceeds bound");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
