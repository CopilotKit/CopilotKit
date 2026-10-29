import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const roles = ["image-gate", "ruby-promotion", "harness"];
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function runReaders({ env, signal }) {
  const directory = await mkdtemp(join(tmpdir(), "registry-activation-"));
  try {
    // These real readers validate inventory and registry bytes before acknowledging.
    // No harness-role process is run here: that receipt must come from the deployment.
    await execute(
      join(root, "node_modules/.bin/tsx"),
      ["showcase/scripts/verify-railway-image-refs.ts"],
      {
        cwd: root,
        env: { ...env, SHOWCASE_REGISTRY_CONSUMER: "image-gate" },
        signal,
        maxBuffer: 1024 * 1024,
      },
    );
    await execute(
      "ruby",
      [
        "showcase/scripts/validate-registry.rb",
        join(directory, "receipt.json"),
      ],
      {
        cwd: root,
        env: { ...env, SHOWCASE_REGISTRY_CONSUMER: "ruby-promotion" },
        signal,
        maxBuffer: 1024 * 1024,
      },
    );
  } catch {
    // Child diagnostics can contain credentials/inventory. Do not relay raw output.
    throw new Error(
      "Real registry reader validation failed; retain drain and inspect its safe diagnostics",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Run only after candidate verification, while admissions remain drained.
 * Adapters must read the actual configured harness deployment and authenticated
 * GET /consumers/<role>. They receive a cancellation signal and must not mutate.
 * A receipt is evidence of the real reader, not proof of a successful model run.
 */
export async function activateRegistryReaders(input, dependencies = {}) {
  const {
    policySha256,
    recordsFile,
    notBefore,
    harnessDeploymentId,
    harnessImage,
    readHarnessDeployment,
    readConsumerReceipt,
    assertCandidateDrained,
    timeoutMs = 120_000,
    env = process.env,
  } = input;
  assert.equal(
    typeof assertCandidateDrained,
    "function",
    "Candidate/drain guard required",
  );
  assert.match(policySha256, /^[a-f0-9]{64}$/);
  assert.match(
    harnessImage,
    /^ghcr\.io\/copilotkit\/showcase-harness@sha256:[a-f0-9]{64}$/,
  );
  assert.match(harnessDeploymentId, /^[a-f0-9-]{36}$/);
  assert.ok(
    Number.isFinite(Date.parse(notBefore)) &&
      Date.parse(notBefore) <= Date.now(),
    "Invalid activation boundary",
  );
  assert.ok(
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000,
  );
  const endpoint = new URL(recordsFile);
  assert.ok(
    endpoint.protocol === "https:" &&
      endpoint.pathname === "/registry" &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash,
  );
  assert.equal(env.SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE, endpoint.href);
  for (const name of [
    "SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN",
    "RAILWAY_TOKEN",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_SHA",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_WORKFLOW",
  ])
    assert.ok(env[name]?.trim(), `Missing ${name}`);
  const generated = JSON.parse(
    await readFile(
      new URL("./railway-envs.generated.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    hash(generated.disposableLifecyclePolicy),
    policySha256,
    "Local reader policy must match candidate",
  );
  const signal = AbortSignal.timeout(timeoutMs);
  // Enforce the bound even if an adapter ignores cancellation.
  async function bounded(operation) {
    signal.throwIfAborted();
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () =>
        reject(
          new Error("Registry activation deadline exceeded; retain drain"),
        );
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([Promise.resolve().then(operation), aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
  async function verifyHarness() {
    const observed = await bounded(() => readHarnessDeployment(signal));
    assert.equal(
      observed.id,
      harnessDeploymentId,
      "Harness deployment differs",
    );
    assert.equal(observed.image, harnessImage, "Harness image differs");
    assert.equal(
      observed.status,
      "SUCCESS",
      "Harness is not deployed successfully",
    );
  }
  await bounded(() => assertCandidateDrained(signal));
  await verifyHarness();
  await bounded(() => (dependencies.runReaders ?? runReaders)({ env, signal }));
  while (true) {
    await verifyHarness();
    const receipts = [];
    for (const role of roles)
      receipts.push(await bounded(() => readConsumerReceipt(role, signal)));
    const fresh = receipts.every(
      (receipt, index) =>
        receipt &&
        receipt.consumer === roles[index] &&
        receipt.reader === "railway-lifecycle-records-v1" &&
        receipt.recordsFile === endpoint.href &&
        receipt.policySha256 === policySha256 &&
        /^[a-f0-9]{64}$/.test(receipt.sha256) &&
        Date.parse(receipt.at) >= Date.parse(notBefore) &&
        Date.parse(receipt.at) <= Date.now(),
    );
    if (fresh) {
      await bounded(() => assertCandidateDrained(signal));
      return { policySha256, harnessDeploymentId, harnessImage, receipts };
    }
    await bounded(() => delay(1000, undefined, { signal }));
  }
}
