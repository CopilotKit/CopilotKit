import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every database belongs to a uniquely named, loopback-only test container.
// No caller-supplied database URL or volume can be mutated by this driver.
assert.equal(
  process.env.PB_TEST_RESULT_FILE,
  undefined,
  "PB_TEST_RESULT_FILE is unsupported; use the deterministic 42-cell regression fixture",
);
const baselineImage = process.env.PB_TEST_BASELINE_IMAGE;
assert.ok(
  baselineImage,
  "PB_TEST_BASELINE_IMAGE must be an official baseline image",
);
const candidateImage = process.env.PB_TEST_CANDIDATE_IMAGE;
const legacy = process.env.PB_TEST_MODE === "legacy";
const context = process.env.PB_TEST_DOCKER_CONTEXT;
const evidence = process.env.PB_TEST_EVIDENCE_DIR;
const keep = process.env.PB_TEST_KEEP_ARTIFACTS === "1";
const prefix = `pb-capacity-${randomUUID().slice(0, 8)}`;
const containers = [];
const volumes = [];
const failures = [];
const temporary = mkdtempSync(join(tmpdir(), "pb-capacity-"));
const migration = "1779990600_probe_jobs_result_capacity.js";
const docker = (...args) =>
  execFileSync(
    "docker",
    [...(context ? ["--context", context] : []), ...args],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
const sleep = () => new Promise((resolve) => setTimeout(resolve, 100));
const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const digest = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
function save(name, value) {
  if (evidence)
    writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
}
function volume(label) {
  const name = `${prefix}-${label}`;
  volumes.push(name);
  docker("volume", "create", name);
  return name;
}
function start(image, dataVolume, label, migrations) {
  const name = `${prefix}-${label}`;
  const args = [
    "run",
    "-d",
    "--name",
    name,
    "-p",
    "127.0.0.1::8090",
    "-v",
    `${dataVolume}:/pb_data`,
  ];
  if (migrations) args.push("-v", `${migrations}:/pb_migrations:ro`);
  args.push(
    "-e",
    "POCKETBASE_SUPERUSER_EMAIL=local-proof@example.test",
    "-e",
    "POCKETBASE_SUPERUSER_PASSWORD=local-proof-password-only",
    image,
  );
  containers.push(name);
  docker(...args);
  return name;
}
async function connect(name) {
  const info = JSON.parse(docker("inspect", name))[0];
  const port = info.NetworkSettings.Ports["8090/tcp"][0].HostPort;
  const url = `http://127.0.0.1:${port}`;
  let token;
  async function request(path, method = "GET", body) {
    const r = await fetch(url + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, data: await r.json() };
  }
  async function ok(path, method, body) {
    const r = await request(path, method, body);
    assert.ok(r.status < 300, JSON.stringify(r));
    return r.data;
  }
  for (let n = 0; n < 100; n++) {
    try {
      await ok("/api/health");
      break;
    } catch (error) {
      if (
        docker("inspect", "--format", "{{.State.Running}}", name) !== "true" ||
        n === 99
      )
        throw new Error(
          `Private PocketBase failed to start: ${docker("logs", name)}`,
          { cause: error },
        );
      await sleep();
    }
  }
  token = (
    await ok("/api/admins/auth-with-password", "POST", {
      identity: "local-proof@example.test",
      password: "local-proof-password-only",
    })
  ).token;
  const schema = () => ok("/api/collections/probe_jobs");
  const row = (id) => ok(`/api/collections/probe_jobs/records/${id}`);
  const patch = (id, result) =>
    request(`/api/collections/probe_jobs/records/${id}`, "PATCH", { result });
  const seed = (result = { sentinel: "unchanged legacy result" }) =>
    ok("/api/collections/probe_jobs/records", "POST", {
      probe_key: "d5:capacity-proof/complete",
      status: "done",
      result,
    });
  return { request, ok, schema, row, patch, seed };
}
function capacity(schema) {
  return schema.schema.find((field) => field.name === "result")?.options
    .maxSize;
}
function unchangedSchema(before, after, allowCapacityChange = false) {
  const normalize = (schema) => {
    const copy = structuredClone(schema);
    if (allowCapacityChange) {
      delete copy.updated;
      copy.schema.find((field) => field.name === "result").options.maxSize =
        2000000;
    }
    return copy;
  };
  assert.deepEqual(
    normalize(after),
    normalize(before),
    "Unrelated schema changed",
  );
}
function attempt(label, operation) {
  try {
    operation();
    return true;
  } catch (error) {
    failures.push(new Error(label, { cause: error }));
    return false;
  }
}
// Register names before allocation: a failed Docker run may still create a
// container. Only an explicitly absent owned resource is harmless at cleanup.
function ownedDocker(...args) {
  try {
    return docker(...args);
  } catch (error) {
    if (/No such container:|no such volume/i.test(error.stderr ?? ""))
      return null;
    throw error;
  }
}
try {
  const payload = {
    dimension: "d5",
    cells: Array.from({ length: 42 }, (_, index) => ({
      key: `cell-${index}`,
      verdict: index % 2 ? "pass" : "fail",
      proof: "complete proof α ".repeat(160),
    })),
  };
  const payloadBytes = Buffer.byteLength(canonical(payload));
  assert.ok(
    payloadBytes > 65536 && payloadBytes < 2000000,
    "Proof payload must exceed the old cap and fit the new cap",
  );
  console.log(
    JSON.stringify({
      payloadBytes,
      payloadSha256: digest(payload),
      fixture: "deterministic 42-cell regression fixture",
    }),
  );
  const dataVolume = volume("upgrade");
  let name = start(baselineImage, dataVolume, "baseline");
  let pb = await connect(name);
  const originalSchema = await pb.schema();
  assert.equal(capacity(originalSchema), 65536);
  const originalRow = await pb.seed();
  const red = await pb.patch(originalRow.id, payload);
  console.log(
    JSON.stringify({
      case: "complete result write before migration",
      status: red.status,
      error: red.data.data?.result,
      rowId: originalRow.id,
    }),
  );
  save("baseline-red.json", {
    payloadBytes,
    payloadSha256: digest(payload),
    response: red,
  });
  if (legacy)
    assert.equal(red.status, 200, "Complete result over 64 KiB must persist");
  assert.equal(red.status, 400);
  assert.equal(red.data.data.result.code, "validation_json_size_limit");
  assert.deepEqual(await pb.row(originalRow.id), originalRow);
  console.log(
    "PASS legacy RED rejects complete result without changing the existing row",
  );
  assert.ok(
    candidateImage,
    "PB_TEST_CANDIDATE_IMAGE is required after baseline RED",
  );
  docker("stop", name);
  name = start(candidateImage, dataVolume, "upgrade");
  pb = await connect(name);
  const upgradedSchema = await pb.schema();
  assert.equal(capacity(upgradedSchema), 2000000);
  unchangedSchema(originalSchema, upgradedSchema, true);
  assert.deepEqual(await pb.row(originalRow.id), originalRow);
  const green = await pb.patch(originalRow.id, payload);
  assert.equal(green.status, 200, JSON.stringify(green));
  const retainedRow = await pb.row(originalRow.id);
  assert.deepEqual(retainedRow.result, payload);
  assert.equal(canonical(retainedRow.result), canonical(payload));
  save("upgrade-green.json", {
    payloadBytes,
    payloadSha256: digest(payload),
    readbackSha256: digest(retainedRow.result),
    rowId: retainedRow.id,
    capacity: capacity(upgradedSchema),
  });
  console.log(
    "PASS same row and complete payload GREEN; all data and canonical UTF-8 bytes retained",
  );
  const overflow = await pb.patch(originalRow.id, {
    padding: "x".repeat(2000000),
  });
  assert.equal(overflow.status, 400);
  assert.equal(overflow.data.data.result.code, "validation_json_size_limit");
  assert.deepEqual(await pb.row(originalRow.id), retainedRow);
  console.log(
    "PASS finite 2000000-byte cap rejects overflow without mutating retained result",
  );
  // Re-execute the exact migration under a fresh migration identity in a private
  // directory; a normal restart alone would only test the migration ledger.
  const replayDir = join(temporary, "migrations");
  docker("cp", `${name}:/pb_migrations`, replayDir);
  cpSync(
    join(replayDir, migration),
    join(replayDir, "1779990601_capacity_repeat.js"),
  );
  docker("stop", name);
  name = start(candidateImage, dataVolume, "repeat", replayDir);
  pb = await connect(name);
  unchangedSchema(upgradedSchema, await pb.schema());
  assert.deepEqual(await pb.row(originalRow.id), retainedRow);
  console.log(
    "PASS exact migration up callback re-execution is idempotent on real database",
  );
  docker("stop", name);
  name = start(baselineImage, dataVolume, "rollback");
  pb = await connect(name);
  unchangedSchema(upgradedSchema, await pb.schema());
  assert.deepEqual(await pb.row(originalRow.id), retainedRow);
  assert.equal((await pb.patch(originalRow.id, payload)).status, 200);
  const afterRollbackWrite = await pb.row(originalRow.id);
  console.log(
    "PASS application-image rollback retains capacity/result and accepts complete writes; no down migration",
  );
  docker("stop", name);
  name = start(candidateImage, dataVolume, "reupgrade");
  pb = await connect(name);
  unchangedSchema(upgradedSchema, await pb.schema());
  assert.deepEqual(await pb.row(originalRow.id), afterRollbackWrite);
  console.log("PASS application-image re-upgrade retains schema and result");
  for (const variant of ["larger", "wrong-type", "missing"]) {
    const variantVolume = volume(variant);
    let variantName = start(
      baselineImage,
      variantVolume,
      `${variant}-baseline`,
    );
    let variantPb = await connect(variantName);
    if (variant === "larger") {
      const altered = await variantPb.schema();
      altered.schema.find((field) => field.name === "result").options.maxSize =
        3000000;
      await variantPb.ok("/api/collections/probe_jobs", "PATCH", {
        schema: altered.schema,
      });
    } else {
      // Use a private fixture migration: PB's REST schema editor forbids type
      // changes and its automigration path can fail after saving a collection.
      const fixtureDir = join(temporary, variant);
      docker("cp", `${variantName}:/pb_migrations`, fixtureDir);
      writeFileSync(
        join(fixtureDir, "1779990500_capacity_fixture.js"),
        `migrate((db) => {
        const dao = new Dao(db);
        const collection = dao.findCollectionByNameOrId("probe_jobs");
        collection.schema.removeField(collection.schema.getFieldByName("result").id);
        ${variant === "wrong-type" ? 'collection.schema.addField(new SchemaField({ name: "result", type: "text", options: {} }));' : ""}
        dao.saveCollection(collection);
      }, () => {});`,
      );
      docker("stop", variantName);
      variantName = start(
        baselineImage,
        variantVolume,
        `${variant}-fixture`,
        fixtureDir,
      );
      variantPb = await connect(variantName);
    }
    const beforeSchema = await variantPb.schema();
    const variantRow = await variantPb.ok(
      "/api/collections/probe_jobs/records",
      "POST",
      {
        probe_key: "d5:capacity-proof/schema-guard",
        status: "done",
        ...(variant === "missing"
          ? {}
          : {
              result:
                variant === "larger"
                  ? { padding: "x".repeat(2100000) }
                  : "retained text sentinel",
            }),
      },
    );
    docker("stop", variantName);
    variantName = start(candidateImage, variantVolume, `${variant}-candidate`);
    if (variant === "larger") {
      variantPb = await connect(variantName);
      assert.equal(capacity(await variantPb.schema()), 3000000);
      unchangedSchema(beforeSchema, await variantPb.schema());
      assert.deepEqual(await variantPb.row(variantRow.id), variantRow);
      console.log(
        "PASS existing larger 3000000-byte field and >2 MiB result are not shrunk or changed",
      );
    } else {
      for (
        let n = 0;
        n < 100 &&
        docker("inspect", "--format", "{{.State.Running}}", variantName) ===
          "true";
        n++
      )
        await sleep();
      assert.equal(
        docker("inspect", "--format", "{{.State.Running}}", variantName),
        "false",
        "Malformed schema must prevent serving",
      );
      // PB 0.22.21 can exit zero for a rejected migration. The contract is
      // the specific loud guard error and no running server, not its exit code.
      const logs = docker("logs", variantName);
      assert.ok(logs.includes(`Failed to apply migration ${migration}`), logs);
      assert.ok(logs.includes("Expected probe_jobs.result JSON field"), logs);
      console.log(`PASS ${variant} schema fails startup loudly`);
      variantName = start(baselineImage, variantVolume, `${variant}-check`);
      variantPb = await connect(variantName);
      unchangedSchema(beforeSchema, await variantPb.schema());
      assert.deepEqual(await variantPb.row(variantRow.id), variantRow);
      console.log(
        `PASS ${variant} migration failure leaves schema/data unchanged`,
      );
    }
  }
  const fresh = await connect(start(candidateImage, volume("fresh"), "fresh"));
  assert.equal(capacity(await fresh.schema()), 2000000);
  const freshRow = await fresh.seed();
  assert.equal((await fresh.patch(freshRow.id, payload)).status, 200);
  assert.deepEqual((await fresh.row(freshRow.id)).result, payload);
  console.log(
    "PASS fresh candidate volume persists complete result at finite 2000000-byte cap",
  );
  console.log("ALL REAL POCKETBASE RESULT CAPACITY CHECKS PASSED");
} catch (error) {
  failures.push(error);
} finally {
  const retainedContainers = [];
  const retainedVolumes = [];
  for (const name of containers.toReversed()) {
    if (evidence)
      attempt(`Collect evidence for ${name}`, () => {
        const logs = ownedDocker("logs", name);
        if (logs !== null)
          writeFileSync(join(evidence, `${name}.log`), logs + "\n");
      });
    if (keep) {
      const stopped = attempt(`Stop ${name}`, () => {
        if (ownedDocker("stop", name) !== null) retainedContainers.push(name);
      });
      // Preservation may retain only stopped resources. A failed stop must
      // still attempt removal so it cannot intentionally leave a live server.
      if (stopped) continue;
    }
    attempt(`Remove ${name}`, () => ownedDocker("rm", "-f", "-v", name));
  }
  for (const name of volumes) {
    if (keep)
      attempt(`Inspect retained volume ${name}`, () => {
        if (ownedDocker("volume", "inspect", name) !== null)
          retainedVolumes.push(name);
      });
    else
      attempt(`Remove volume ${name}`, () => ownedDocker("volume", "rm", name));
  }
  attempt("Remove temporary migrations", () =>
    rmSync(temporary, { recursive: true, force: true }),
  );
  attempt("Report retained resources", () =>
    console.log(
      JSON.stringify({
        retainedVolumes,
        containers: retainedContainers,
      }),
    ),
  );
}
if (failures.length === 1) throw failures[0];
if (failures.length > 1)
  throw new AggregateError(
    failures,
    "PocketBase capacity proof and resource finalization failed",
  );
