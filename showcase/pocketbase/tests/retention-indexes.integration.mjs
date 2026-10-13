import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Proves migration 1779990700 against a real PocketBase image: all `created`
// indexes exist in SQLite AND are listed exactly once in the collection's
// `indexes` metadata, across clean boots, idempotent re-boots, an exact
// re-execution of the up callback, and pre-existing indexes whose names
// contain the new index names. Every database belongs to a uniquely named,
// loopback-only test container; no external database or volume is touched.
// Containers, volumes and temporary files are removed after the run.
//
// Needs a local Docker engine and Node >= 22.13 (node:sqlite). From the
// repository root:
//   docker build -t showcase-pocketbase:retention-indexes showcase/pocketbase
//   PB_TEST_IMAGE=showcase-pocketbase:retention-indexes \
//     node showcase/pocketbase/tests/retention-indexes.integration.mjs
const image = process.env.PB_TEST_IMAGE;
assert.ok(image, "PB_TEST_IMAGE must be an image built from this checkout");
const migration = "1779990700_retention_created_indexes.js";
const replayMigration = "1779990701_retention_indexes_repeat.js";
const targets = [
  { collection: "diag_events", name: "idx_diag_events_created" },
  { collection: "status_history", name: "idx_sh_created" },
  { collection: "cvdiag_events", name: "idx_cvdiag_events_created" },
];
// Pre-existing indexes whose names CONTAIN a target name. A substring
// presence check mistakes these for the target and skips the metadata append.
const decoys = {
  diag_events: "idx_diag_events_created_run",
  status_history: "idx_sh_created_key",
  cvdiag_events: "idx_cvdiag_events_created_slug",
};
const prefix = `pb-retention-idx-${randomUUID().slice(0, 8)}`;
const containers = [];
const volumes = [];
const failures = [];
const temporary = mkdtempSync(join(tmpdir(), "pb-retention-idx-"));
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const sleep = () => new Promise((resolve) => setTimeout(resolve, 100));
function volume(label) {
  const name = `${prefix}-${label}`;
  volumes.push(name);
  docker("volume", "create", name);
  return name;
}
function start(dataVolume, label, migrations) {
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
  async function ok(path, method = "GET", body) {
    const r = await fetch(url + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await r.json();
    assert.ok(r.status < 300, JSON.stringify({ status: r.status, data }));
    return data;
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
  return { ok };
}
// Same exact-name rule as the migration: the identifier after
// CREATE [UNIQUE] INDEX [IF NOT EXISTS], with any quoting removed.
function indexName(sql) {
  const m =
    /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([^`"\]\s(]+)/i.exec(
      sql,
    );
  return m ? m[1] : null;
}
// Stop the container (PocketBase closes SQLite cleanly), copy its data
// directory out, and read sqlite_master and _collections directly.
let snapshots = 0;
function inspect(name) {
  docker("stop", name);
  const dir = join(temporary, `snapshot-${snapshots++}`);
  docker("cp", `${name}:/pb_data`, dir);
  const db = new DatabaseSync(join(dir, "data.db"));
  try {
    const sqlite = new Map(
      db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => [row.name, row.sql]),
    );
    const metadata = {};
    for (const row of db
      .prepare("SELECT name, indexes FROM _collections")
      .all())
      metadata[row.name] = JSON.parse(row.indexes || "[]");
    const appliedCount = (file) =>
      db
        .prepare("SELECT COUNT(*) AS n FROM _migrations WHERE file = ?")
        .get(file).n;
    const applied = appliedCount(migration);
    const replayApplied = appliedCount(replayMigration);
    return { sqlite, metadata, applied, replayApplied };
  } finally {
    db.close();
  }
}
function assertIndexed(state, label) {
  for (const { collection, name } of targets) {
    const sql = state.sqlite.get(name);
    assert.ok(sql, `${label}: ${name} missing from sqlite_master`);
    assert.match(
      sql,
      /\(\s*`?created`?\s*\)/,
      `${label}: ${name} not on created`,
    );
    const listed = (state.metadata[collection] ?? []).filter(
      (ix) => indexName(ix) === name,
    );
    assert.equal(
      listed.length,
      1,
      `${label}: ${name} must be listed exactly once in ${collection}.indexes, got ${JSON.stringify(state.metadata[collection])}`,
    );
  }
}
// Copy the image's own migrations into a private directory without running it.
function imageMigrations(label) {
  const name = `${prefix}-${label}`;
  containers.push(name);
  docker("create", "--name", name, image);
  const dir = join(temporary, label);
  docker("cp", `${name}:/pb_migrations`, dir);
  return dir;
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
  // 1. Decoy: pre-existing indexes whose names contain the target names,
  // added with saveCollection before 1779990700 runs.
  const decoyVolume = volume("decoy");
  const withoutMigration = imageMigrations("without-migration");
  rmSync(join(withoutMigration, migration));
  // A private fixture migration adds the decoys with saveCollection, the same
  // path as an Admin UI schema edit. (A REST PATCH fails here: PocketBase
  // tries to write an automigration into the read-only migrations mount.)
  writeFileSync(
    join(withoutMigration, "1779990650_retention_decoy_fixture.js"),
    "migrate((db) => {\n" +
      "  const dao = new Dao(db);\n" +
      "  const decoys = " +
      JSON.stringify(decoys) +
      ";\n" +
      "  for (const collection in decoys) {\n" +
      "    const c = dao.findCollectionByNameOrId(collection);\n" +
      "    const indexes = (c.indexes || []).slice();\n" +
      '    indexes.push("CREATE INDEX `" + decoys[collection] + "` ON `" + collection + "` (`created`, `id`)");\n' +
      "    c.indexes = indexes;\n" +
      "    dao.saveCollection(c);\n" +
      "  }\n" +
      "}, () => {});\n",
  );
  let name = start(decoyVolume, "decoy-seed", withoutMigration);
  let pb = await connect(name);
  let state = inspect(name);
  assert.equal(state.applied, 0, "decoy seed must run before the migration");
  for (const { collection, name: target } of targets) {
    assert.ok(state.sqlite.has(decoys[collection]));
    assert.ok(!state.sqlite.has(target));
  }
  name = start(decoyVolume, "decoy-upgrade");
  await connect(name);
  state = inspect(name);
  assert.equal(state.applied, 1);
  assertIndexed(state, "decoy upgrade");
  for (const [collection, decoy] of Object.entries(decoys)) {
    assert.ok(state.sqlite.has(decoy), `${decoy} dropped from sqlite_master`);
    assert.equal(
      state.metadata[collection].filter((ix) => indexName(ix) === decoy).length,
      1,
      `${decoy} must stay listed exactly once`,
    );
  }
  console.log(
    "PASS pre-existing indexes containing the target names do not suppress the metadata entries",
  );

  // 2. Clean boot on a fresh volume.
  const freshVolume = volume("fresh");
  name = start(freshVolume, "fresh");
  await connect(name);
  const fresh = inspect(name);
  assert.equal(fresh.applied, 1);
  assertIndexed(fresh, "fresh boot");
  console.log("PASS fresh boot creates all indexes and lists each once");

  // 3. Idempotent re-boot: the migration ledger skips the migration.
  name = start(freshVolume, "reboot");
  await connect(name);
  state = inspect(name);
  assertIndexed(state, "re-boot");
  assert.deepEqual(state.metadata, fresh.metadata);
  console.log("PASS idempotent re-boot leaves indexes and metadata unchanged");

  // 4. Re-execute the exact up callback under a fresh migration identity; a
  // re-boot alone only exercises the migration ledger.
  const replayDir = imageMigrations("replay");
  cpSync(join(replayDir, migration), join(replayDir, replayMigration));
  name = start(freshVolume, "repeat", replayDir);
  await connect(name);
  state = inspect(name);
  // Without this the check passes vacuously if the replay never ran.
  assert.equal(state.replayApplied, 1, `${replayMigration} did not run`);
  assertIndexed(state, "re-run");
  assert.deepEqual(state.metadata, fresh.metadata);
  console.log(
    "PASS exact migration up callback re-execution adds no duplicate index or metadata",
  );

  // 5. A later saveCollection (Admin UI / REST schema edit) keeps the index.
  name = start(freshVolume, "save");
  pb = await connect(name);
  for (const { collection } of targets) {
    const current = await pb.ok(`/api/collections/${collection}`);
    await pb.ok(`/api/collections/${collection}`, "PATCH", {
      indexes: current.indexes,
    });
  }
  state = inspect(name);
  assertIndexed(state, "after saveCollection");
  console.log("PASS later saveCollection keeps all indexes and metadata");
  console.log("ALL REAL POCKETBASE RETENTION INDEX CHECKS PASSED");
} catch (error) {
  failures.push(error);
} finally {
  for (const name of containers.toReversed())
    attempt(`Remove ${name}`, () => ownedDocker("rm", "-f", "-v", name));
  for (const name of volumes)
    attempt(`Remove volume ${name}`, () => ownedDocker("volume", "rm", name));
  attempt("Remove temporary files", () =>
    rmSync(temporary, { recursive: true, force: true }),
  );
}
if (failures.length === 1) throw failures[0];
if (failures.length > 1)
  throw new AggregateError(
    failures,
    "PocketBase retention index proof and resource finalization failed",
  );
