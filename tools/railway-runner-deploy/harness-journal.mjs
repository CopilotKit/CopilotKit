import transportAssert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { STAGING } from "./contract.mjs";

/** Self-contained reviewed code executed in the runner; no dependency on its image contents. */
export async function retainedHarnessJournal(input, options = {}) {
  const assert = (await import("node:assert/strict")).default;
  const fs = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const env = options.env ?? process.env;
  const root = options.root ?? "/data/private";
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const scope = input.context.runner;
  assert.equal(env.RAILWAY_PROJECT_ID, scope.projectId);
  assert.equal(env.RAILWAY_ENVIRONMENT_ID, scope.environmentId);
  assert.equal(env.RAILWAY_SERVICE_ID, scope.serviceId);
  assert.equal(env.RAILWAY_DEPLOYMENT_ID, input.context.deploymentId);
  assert.match(input.context.releaseSha256, /^[a-f0-9]{64}$/);
  const mountInfo =
    options.mountInfo ?? (await fs.readFile("/proc/self/mountinfo", "utf8"));
  assert.ok(
    mountInfo.split("\n").some((line) => line.split(" ")[4] === "/data"),
    "Retained /data mount missing",
  );
  assert.equal(
    await fs.realpath(root),
    root,
    "Private journal root is a symlink",
  );
  const directory = `${root}/harness-policy-rollout`;
  const phases = [
    "source-requested",
    "deploy-requested",
    "deploy-acknowledged",
    "verified",
  ];
  const names = phases.map((phase, index) => `${index}-${phase}.json`);
  const syncDirectory = async (path) => {
    const fd = await fs.open(path, "r");
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
  };
  async function load() {
    let files;
    try {
      files = await fs.readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    assert.ok(
      files.length > 0,
      "Incomplete durable harness claim; recovery required",
    );
    files.sort();
    assert.deepEqual(
      files,
      names.slice(0, files.length),
      "Invalid durable harness checkpoint sequence",
    );
    let previous = null,
      previousHash = null;
    for (const [index, file] of files.entries()) {
      const bytes = await fs.readFile(`${directory}/${file}`);
      assert.ok(bytes.length <= 65536, "Harness checkpoint exceeds bound");
      const record = JSON.parse(bytes);
      assert.deepEqual(Object.keys(record).sort(), [
        "context",
        "previousSha256",
        "receipt",
      ]);
      assert.deepEqual(
        record.context,
        input.context,
        "Durable harness operation binding differs",
      );
      assert.equal(
        record.previousSha256,
        previousHash,
        "Harness checkpoint chain differs",
      );
      assert.equal(record.receipt.phase, phases[index]);
      if (previous) sameBinding(previous.receipt, record.receipt);
      previous = record;
      previousHash = hash(bytes);
    }
    return { ...previous, sha256: previousHash, count: files.length };
  }
  function sameBinding(previous, next) {
    const { phase: _p, deploymentId: _d, ...before } = previous;
    const { phase: _n, deploymentId: _e, ...after } = next;
    assert.deepEqual(after, before, "Harness receipt binding changed");
    if (previous.deploymentId)
      assert.equal(next.deploymentId, previous.deploymentId);
  }
  if (input.action === "load") return (await load())?.receipt ?? null;
  assert.ok(["claim", "save"].includes(input.action));
  const receipt = input.receipt;
  assert.match(receipt.operationId, /^github-655515393-\d+$/);
  assert.equal(receipt.operationId, input.context.operationId);
  assert.equal(receipt.targetImage, input.context.harnessImage);
  assert.equal(receipt.scope.serviceId, "3a14bfed-0537-4d71-897b-7c593dca161d");
  assert.equal(receipt.scope.projectId, scope.projectId);
  assert.equal(receipt.scope.environmentId, scope.environmentId);
  const index = phases.indexOf(receipt.phase);
  assert.ok(index >= 0);
  if (index >= 2) assert.match(receipt.deploymentId, /^[a-f0-9-]{36}$/);
  let prior = null;
  if (input.action === "claim") {
    assert.equal(index, 0);
    // Directory creation is exclusive across workers/operations. An interrupted
    // empty directory remains a blocker; it is never interpreted as no claim.
    await fs.mkdir(directory, { mode: 0o700 });
    await syncDirectory(root);
  } else {
    prior = await load();
    assert.ok(prior, "Durable claim missing");
    assert.equal(index, prior.count, "Out-of-order or repeated checkpoint");
    sameBinding(prior.receipt, receipt);
  }
  const bytes = JSON.stringify({
    context: input.context,
    previousSha256: prior?.sha256 ?? null,
    receipt,
  });
  assert.ok(Buffer.byteLength(bytes) <= 65536);
  // Immutable wx checkpoint is the compare-and-set: competing writers cannot
  // both acknowledge a phase. Torn writes fail parsing on subsequent reads.
  const fd = await fs.open(`${directory}/${names[index]}`, "wx", 0o600);
  try {
    await fd.writeFile(bytes);
    await fd.sync();
  } finally {
    await fd.close();
  }
  await syncDirectory(directory);
  return receipt;
}

/** Shell contains only encoded code/data; never credentials or unquoted values. */
export function harnessJournalCommand(input) {
  const encoded = Buffer.from(JSON.stringify(input)).toString("base64");
  const source = `(${retainedHarnessJournal.toString()})(JSON.parse(Buffer.from(process.argv[1],"base64").toString())).then(v=>console.log(JSON.stringify(v))).catch(()=>{console.error("Durable harness journal refused; retain drain");process.exitCode=1;})`;
  const code = Buffer.from(source).toString("base64");
  return `node -e 'eval(Buffer.from("${code}","base64").toString())' '${encoded}'`;
}

export function createRetainedHarnessJournal({
  context,
  inspectRunner,
  assertCandidateDrained,
  env = process.env,
  execute = promisify(execFile),
}) {
  let deploymentId;
  async function guard() {
    await assertCandidateDrained();
    const state = await inspectRunner();
    transportAssert.equal(state.active?.status, "SUCCESS");
    transportAssert.equal(state.active.image, context.runnerImage);
    transportAssert.deepEqual(state.latest, state.active);
    for (const key of ["volumeId", "volumeInstanceId", "mountPath"])
      transportAssert.equal(state[key], STAGING[key]);
    transportAssert.notEqual(state.isPendingDeletion, true);
    if (deploymentId) transportAssert.equal(state.active.id, deploymentId);
    deploymentId = state.active.id;
  }
  async function request(action, receipt) {
    transportAssert.ok(
      env.RAILWAY_SSH_IDENTITY_FILE,
      "Explicit registered Railway SSH identity required",
    );
    await guard();
    const input = {
      action,
      context: { ...context, runner: STAGING, deploymentId },
      ...(receipt ? { receipt } : {}),
    };
    let stdout;
    try {
      ({ stdout } = await execute(
        "railway",
        [
          "ssh",
          "--identity-file",
          env.RAILWAY_SSH_IDENTITY_FILE,
          "--project",
          STAGING.projectId,
          "--environment",
          STAGING.environmentId,
          "--service",
          STAGING.serviceId,
          "--",
          harnessJournalCommand(input),
        ],
        {
          env: {
            ...env,
            RAILWAY_API_TOKEN: env.RAILWAY_TOKEN,
            RAILWAY_TOKEN: undefined,
          },
          timeout: 30000,
          maxBuffer: 131072,
        },
      ));
    } catch {
      throw new Error(
        "Durable harness journal outcome unknown; inspect retained volume, do not retry mutations",
      );
    }
    const value = JSON.parse(stdout);
    if (receipt)
      transportAssert.deepEqual(
        value,
        receipt,
        "Durable checkpoint acknowledgment differs",
      );
    await guard();
    return value;
  }
  return {
    load: () => request("load"),
    claim: (value) => request("claim", value),
    save: (value) => request("save", value),
  };
}
