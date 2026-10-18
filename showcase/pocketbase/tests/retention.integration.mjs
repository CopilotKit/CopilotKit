import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Real-PocketBase checks for pb_hooks/retention.pb.js. Each scenario runs in
// its own uniquely named, loopback-only test container with the hook on a
// 1-minute cron (or the 5-minute fallback), seeds a small backdated table with
// raw SQL, waits for a real cron pass, and checks the rows that remain.
//
// PB_TEST_IMAGE: an image built from showcase/pocketbase/Dockerfile.
// PB_TEST_HOOKS_DIR (optional): the hooks to test, default ../pb_hooks.
// The test copies those hooks into a private directory and adds one admin-only
// route file that runs the seed SQL, because PB's API does not let a client
// set `created`.
const image = process.env.PB_TEST_IMAGE;
assert.ok(image, "PB_TEST_IMAGE must be an image built from the Dockerfile");
const here = dirname(fileURLToPath(import.meta.url));
const hooksSource = process.env.PB_TEST_HOOKS_DIR ?? join(here, "../pb_hooks");
const prefix = `pb-retention-${randomUUID().slice(0, 8)}`;
const dockerLabel = "copilotkit.test=pb-retention";
const containers = [];
const failures = [];
const temporary = mkdtempSync(join(tmpdir(), "pb-retention-"));
const hooksDir = join(temporary, "hooks");
const tables = ["cvdiag_events", "diag_events", "status_history", "probe_runs"];
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const logStreams = (name) => {
  const r = spawnSync("docker", ["logs", name], { encoding: "utf8" });
  return [r.stdout ?? "", r.stderr ?? ""];
};
const logs = (name) => logStreams(name).join("");
// A log offset, one per stream because logs() joins stdout and stderr.
// logsSince(name, mark) is only what was logged after the mark was taken.
const logMark = (name) => logStreams(name).map((s) => s.length);
const logsSince = (name, mark) =>
  logStreams(name)
    .map((s, i) => s.slice(mark[i]))
    .join("");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

cpSync(hooksSource, hooksDir, { recursive: true });
writeFileSync(
  join(hooksDir, "zz_retention_test.pb.js"),
  `routerAdd("POST", "/api/retention-test/exec", (c) => {
  const sql = $apis.requestInfo(c).data.sql;
  for (let i = 0; i < sql.length; i++) $app.dao().db().newQuery(sql[i]).execute();
  return c.json(200, { ok: true });
}, $apis.requireAdminAuth());
routerAdd("POST", "/api/retention-test/query", (c) => {
  const m = new DynamicModel({ n: 0, s: "" });
  $app.dao().db().newQuery($apis.requestInfo(c).data.sql).one(m);
  return c.json(200, { n: m.n, s: m.s });
}, $apis.requireAdminAuth());
`,
);

function start(scenario, env) {
  const name = `${prefix}-${scenario}`;
  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--label",
    dockerLabel,
    "-p",
    "127.0.0.1::8090",
    "-v",
    `${hooksDir}:/pb_hooks:ro`,
    "-e",
    "POCKETBASE_SUPERUSER_EMAIL=local-proof@example.test",
    "-e",
    "POCKETBASE_SUPERUSER_PASSWORD=local-proof-password-only",
  ];
  // The boot grace is off unless a scenario sets it, so the first 1-minute
  // tick runs a pass.
  const fullEnv = { PB_RETENTION_BOOT_GRACE_MIN: "0", ...env };
  for (const [k, v] of Object.entries(fullEnv)) args.push("-e", `${k}=${v}`);
  args.push(image);
  containers.push(name);
  docker(...args);
  return name;
}

async function connect(name) {
  const info = JSON.parse(docker("inspect", name))[0];
  const port = info.NetworkSettings.Ports["8090/tcp"][0].HostPort;
  const url = `http://127.0.0.1:${port}`;
  let token;
  async function ok(path, body) {
    const r = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await r.json();
    assert.ok(r.status < 300, JSON.stringify({ path, status: r.status, data }));
    return data;
  }
  for (let n = 0; ; n++) {
    try {
      await ok("/api/health");
      break;
    } catch (error) {
      if (n >= 300)
        throw new Error(`PocketBase ${name} did not start: ${logs(name)}`, {
          cause: error,
        });
      await wait(100);
    }
  }
  token = (
    await ok("/api/admins/auth-with-password", {
      identity: "local-proof@example.test",
      password: "local-proof-password-only",
    })
  ).token;
  return {
    exec: (sql) => ok("/api/retention-test/exec", { sql }),
    query: (sql) => ok("/api/retention-test/query", { sql }),
  };
}

// Rows `first`..`last` (also their rowids) created `offset` from now, one
// second apart, in PB's exact stored format.
const rows = (table, idPrefix, first, last, offset) =>
  `INSERT INTO ${table}(rowid, id, created, updated) WITH RECURSIVE c(x) AS ` +
  `(SELECT ${first} UNION ALL SELECT x+1 FROM c WHERE x<${last}) ` +
  `SELECT x, '${idPrefix}'||x, strftime('%Y-%m-%d %H:%M:%fZ','now','${offset}','+'||x||' seconds'), '' FROM c;`;
const setCreated = (table, rowid, expr) =>
  `UPDATE ${table} SET created = ${expr} WHERE rowid = ${rowid};`;

// The one result line per table per pass that this hook printed. The
// malformed-created WARN is a separate line and is not counted here.
const retentionLines = (name, table) =>
  logs(name)
    .split("\n")
    .filter(
      (l) => l.includes("[pb-retention]") && l.includes(`table=${table} `),
    );
const passLines = (name, table) =>
  retentionLines(name, table).filter((l) => !l.includes(" WARN table="));
const warnLines = (name, table) =>
  retentionLines(name, table).filter((l) => l.includes(" WARN table="));
const passCounts = (name) =>
  Object.fromEntries(tables.map((t) => [t, passLines(name, t).length]));

// Seed only well clear of a minute boundary, so a 1-minute pass cannot start
// on a half-seeded table. The waiting can cross a minute boundary and so a
// pass, so the pass-line counts are taken after it, just before the seed.
async function seedSafely(pb, name, sql) {
  for (;;) {
    const s = new Date().getUTCSeconds();
    if (s >= 5 && s <= 45) break;
    await wait(500);
  }
  const before = passCounts(name);
  await pb.exec(sql);
  return before;
}

async function waitFor(what, name, predicate, timeoutMs) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > end)
      throw new Error(`Timed out waiting for ${what}. Logs:\n${logs(name)}`);
    await wait(1000);
  }
}

function check(label, fn) {
  try {
    fn();
    console.log("PASS " + label);
  } catch (error) {
    // The first two lines of an assert message include the actual value.
    const why = error.message.split("\n").filter(Boolean).slice(0, 2);
    console.log("FAIL " + label + ": " + why.join(" "));
    failures.push(new Error(label, { cause: error }));
  }
}

async function runScenario(label, fn) {
  try {
    await fn();
  } catch (error) {
    console.log("FAIL " + label + ": " + error.message.split("\n")[0]);
    failures.push(new Error(label, { cause: error }));
  }
}

// Main: exact deletion, malformed created, order guard, invalid DAYS.
async function mainScenario() {
  const name = start("main", {
    PB_RETENTION_CRON: "* * * * *",
    PB_RETENTION_DIAG_EVENTS_DAYS: "90d",
  });
  const pb = await connect(name);
  const before = await seedSafely(pb, name, [
    // cvdiag_events: rowids 1..1000 are 40 days old, 1001..1200 are 29 days
    // old (inside the window). Rowids 337..340 have malformed `created` and
    // rowid 444 is inside the window. None of those rowids is probed by the
    // cutoff search or its samples, so only the DELETE's own filters keep
    // them.
    rows("cvdiag_events", "old", 1, 1000, "-40 days"),
    rows("cvdiag_events", "new", 1001, 1200, "-29 days"),
    setCreated("cvdiag_events", 337, "''"),
    setCreated(
      "cvdiag_events",
      338,
      "strftime('%Y-%m-%d %H:%M:%SZ','now','-40 days')",
    ),
    setCreated(
      "cvdiag_events",
      339,
      "strftime('%Y-%m-%d %H:%M:%S','now','-40 days')||'.123456Z'",
    ),
    setCreated(
      "cvdiag_events",
      340,
      "strftime('%Y-%m-%dT%H:%M:%fZ','now','-40 days')",
    ),
    setCreated(
      "cvdiag_events",
      444,
      "strftime('%Y-%m-%d %H:%M:%fZ','now','-1 hours')",
    ),
    // status_history: every row is old, so all go.
    rows("status_history", "old", 1, 300, "-40 days"),
    // probe_runs: the lowest rowid is inside the window, old rows sit above
    // it, then newer rows again. Rowid order is broken.
    rows("probe_runs", "new", 1, 1, "-1 hours"),
    rows("probe_runs", "old", 2, 301, "-40 days"),
    rows("probe_runs", "new", 302, 401, "-1 hours"),
    // diag_events: PB_RETENTION_DIAG_EVENTS_DAYS=90d is invalid.
    rows("diag_events", "old", 1, 100, "-40 days"),
  ]);
  await waitFor(
    "the first pass over all four tables",
    name,
    () => tables.every((t) => passLines(name, t).length > before[t]),
    150000,
  );
  const line = (t) => passLines(name, t)[before[t]] ?? "";
  const count = async (table, where = "1") =>
    (
      await pb.query(
        `SELECT count(*) AS n, '' AS s FROM ${table} WHERE ${where}`,
      )
    ).n;
  const cvdiag = await pb.query(
    "SELECT count(*) AS n, COALESCE(group_concat(rowid), '') AS s FROM " +
      "(SELECT rowid FROM cvdiag_events WHERE rowid <= 1000 ORDER BY rowid)",
  );
  const cvdiagNew = await count("cvdiag_events", "rowid > 1000");
  const status = await count("status_history");
  const probe = await count("probe_runs");
  const diag = await count("diag_events");
  check("exact deletion: old rows go, in-window rows stay", () => {
    // 995 rows in the default 125-row batches: 7 full batches and one of 120.
    assert.match(line("cvdiag_events"), / deleted=995 .* batches=8 /);
    assert.equal(cvdiagNew, 200);
    assert.match(line("status_history"), / deleted=300 /);
    assert.equal(status, 0);
  });
  check("malformed and empty created rows are never deleted", () => {
    // Left below rowid 1000: the four malformed rows and the in-window row.
    assert.equal(cvdiag.s, "337,338,339,340,444");
  });
  check("order guard: old rows above an in-window first row → ERROR", () => {
    assert.match(
      line("probe_runs"),
      /ERROR table=probe_runs skipped: rowid order does not follow created/,
    );
    assert.equal(probe, 401);
  });
  check("invalid DAYS skips its table instead of using 30", () => {
    assert.match(
      line("diag_events"),
      /ERROR table=diag_events skipped: PB_RETENTION_DIAG_EVENTS_DAYS="90d"/,
    );
    assert.equal(diag, 100);
  });
  // Next pass: the lowest cvdiag_events row is now the empty one. The probes
  // step past it with a WARN instead of stopping on it. The next well-formed
  // row is 444, which is 1 hour old and sits below rows 29 days old, so the
  // order guard (not the malformed row) is what skips the table.
  await waitFor(
    "the second cvdiag_events pass",
    name,
    () => passLines(name, "cvdiag_events").length > before.cvdiag_events + 1,
    90000,
  );
  check("a probed malformed created logs a WARN and is stepped past", () => {
    assert.match(
      passLines(name, "cvdiag_events")[before.cvdiag_events + 1],
      /ERROR table=cvdiag_events skipped: rowid order does not follow created, first rowid 444 /,
    );
    assert.match(
      warnLines(name, "cvdiag_events").join("\n"),
      /WARN table=cvdiag_events malformed created at rowid 337: ""/,
    );
  });
}

// Malformed created among old rows, and rows a few ms out of order.
async function malformedAndSkewScenario() {
  const name = start("malformed", {
    PB_RETENTION_CRON: "* * * * *",
    PB_RETENTION_MAX_ROWS_PER_PASS: "100",
    PB_RETENTION_BATCH_SIZE: "10",
    PB_RETENTION_BATCH_PAUSE_MS: "0",
  });
  const pb = await connect(name);
  const before = await seedSafely(pb, name, [
    // status_history: 300 old rows, rowid 50 has an empty created. With 100
    // rows per pass, the first pass deletes 1..49 and 51..101, which leaves
    // rowid 50 as the lowest row for the second pass.
    rows("status_history", "old", 1, 300, "-40 days"),
    setCreated("status_history", 50, "''"),
    // probe_runs: three old rows whose created steps back 1 ms per rowid, so
    // the first row is a little newer than the last one.
    rows("probe_runs", "old", 1, 3, "-40 days"),
    ...[1, 2, 3].map((r) =>
      setCreated(
        "probe_runs",
        r,
        `strftime('%Y-%m-%d %H:%M:%S','now','-40 days')||'.00${4 - r}Z'`,
      ),
    ),
  ]);
  await waitFor(
    "two status_history passes",
    name,
    () => passLines(name, "status_history").length > before.status_history + 1,
    150000,
  );
  const pass = (t, i) => passLines(name, t)[before[t] + i] ?? "";
  const status = await pb.query(
    "SELECT count(*) AS n, '' AS s FROM status_history",
  );
  const malformedLeft = (
    await pb.query(
      "SELECT count(*) AS n, '' AS s FROM status_history WHERE rowid = 50",
    )
  ).n;
  const probe = (
    await pb.query("SELECT count(*) AS n, '' AS s FROM probe_runs")
  ).n;
  check("a malformed created row does not stop its table being pruned", () => {
    // PB_RETENTION_BATCH_SIZE=10: 100 rows take 10 batches.
    assert.match(
      pass("status_history", 0),
      / deleted=100 .* batches=10 .*stopped_at=row cap/,
    );
    assert.match(
      pass("status_history", 1),
      / deleted=100 .*stopped_at=row cap/,
    );
    assert.equal(malformedLeft, 1);
    assert.equal(status.n, 100);
    assert.match(
      warnLines(name, "status_history").join("\n"),
      /WARN table=status_history malformed created at rowid 50: ""/,
    );
  });
  check("rows a few ms out of order are pruned, not an order ERROR", () => {
    assert.match(pass("probe_runs", 0), / deleted=3 /);
    assert.equal(probe, 0);
  });
}

// Kill switch: nothing runs and nothing is deleted.
async function killSwitchScenario(value, expected) {
  const name = start(`off-${value.replace(/\W/g, "")}`, {
    PB_RETENTION_CRON: "* * * * *",
    PB_RETENTION_ENABLED: value,
  });
  const pb = await connect(name);
  await seedSafely(pb, name, [
    rows("status_history", "old", 1, 50, "-40 days"),
  ]);
  // Past the next minute boundary, when an enabled job would have run.
  await wait(75000);
  const left = (
    await pb.query("SELECT count(*) AS n, '' AS s FROM status_history")
  ).n;
  const out = logs(name);
  check(`kill switch PB_RETENTION_ENABLED=${value}`, () => {
    assert.match(out, expected);
    assert.doesNotMatch(out, /\[pb-retention\] scheduled/);
    assert.doesNotMatch(out, /\[pb-retention\] .*table=/);
    assert.equal(left, 50);
  });
}

// Invalid cron: ERROR, then the default 5-minute schedule still runs.
async function badCronScenario(value) {
  const name = start(`cron-${value.replace(/\W/g, "")}`, {
    PB_RETENTION_CRON: value,
  });
  const pb = await connect(name);
  await seedSafely(pb, name, [
    rows("status_history", "old", 1, 50, "-40 days"),
  ]);
  check(`invalid PB_RETENTION_CRON=${value} logs ERROR and falls back`, () => {
    const out = logs(name);
    assert.match(out, /\[pb-retention\] ERROR invalid PB_RETENTION_CRON=/);
    assert.match(out, /\[pb-retention\] scheduled: \*\/5 \* \* \* \*/);
  });
  await waitFor(
    "a pass on the fallback schedule",
    name,
    () => passLines(name, "status_history").some((l) => / deleted=50 /.test(l)),
    330000,
  );
  const left = (
    await pb.query("SELECT count(*) AS n, '' AS s FROM status_history")
  ).n;
  check(`invalid PB_RETENTION_CRON=${value} still runs retention`, () => {
    assert.equal(left, 0);
  });
}

// Invalid pacing setting: each pass logs an ERROR and deletes nothing.
async function badSettingScenario(variable, value, range) {
  const name = start(`bad-${variable.slice(13).toLowerCase()}`, {
    PB_RETENTION_CRON: "* * * * *",
    [variable]: value,
  });
  const pb = await connect(name);
  await seedSafely(pb, name, [
    rows("status_history", "old", 1, 50, "-40 days"),
  ]);
  // Only lines logged after the seed count, so the ERROR comes from a pass
  // that saw the seeded rows.
  const seeded = logMark(name);
  const error =
    `[pb-retention] ERROR ${variable}=${JSON.stringify(value)} is not an ` +
    `integer in ${range}, pass skipped (nothing deleted)`;
  await waitFor(
    `the ${variable} ERROR after the seed`,
    name,
    () => logsSince(name, seeded).includes(error),
    150000,
  );
  const left = (
    await pb.query("SELECT count(*) AS n, '' AS s FROM status_history")
  ).n;
  check(`invalid ${variable}=${value} skips the pass with an ERROR`, () => {
    assert.doesNotMatch(logs(name), /\[pb-retention\] .*table=/);
    assert.equal(left, 50);
  });
}

// Boot grace: a pass inside the grace is skipped with one line and leaves
// the seeded rows, then a pass after the grace deletes them. The grace is 2
// minutes, so at least one 1-minute tick inside it comes after the seed.
async function bootGraceScenario() {
  const name = start("grace", {
    PB_RETENTION_CRON: "* * * * *",
    PB_RETENTION_BOOT_GRACE_MIN: "2",
  });
  const pb = await connect(name);
  await seedSafely(pb, name, [
    rows("status_history", "old", 1, 50, "-40 days"),
  ]);
  const seeded = logMark(name);
  const count = async () =>
    (await pb.query("SELECT count(*) AS n, '' AS s FROM status_history")).n;
  const grace =
    /\[pb-retention\] boot grace: pass skipped, hooks loaded \d+s ago, PB_RETENTION_BOOT_GRACE_MIN=2/;
  await waitFor(
    "a boot grace line after the seed",
    name,
    () => grace.test(logsSince(name, seeded)),
    90000,
  );
  const leftInGrace = await count();
  await waitFor(
    "a pass after the boot grace",
    name,
    () => passLines(name, "status_history").length > 0,
    150000,
  );
  const out = logsSince(name, seeded).split("\n");
  const graceAt = out.findLastIndex((l) => grace.test(l));
  const passAt = out.findIndex((l) =>
    l.includes("[pb-retention] table=status_history "),
  );
  const left = await count();
  check("boot grace skips a pass after the seed, then a pass runs", () => {
    assert.equal(leftInGrace, 50, "rows deleted inside the boot grace");
    assert.ok(graceAt < passAt, `grace line ${graceAt}, pass line ${passAt}`);
    // The first pass line of the run, so no earlier pass deleted rows.
    assert.match(passLines(name, "status_history")[0], / deleted=50 /);
    assert.equal(left, 0);
  });
}

try {
  await Promise.all([
    runScenario("main", mainScenario),
    runScenario("malformed and skew", malformedAndSkewScenario),
    runScenario("kill switch off", () =>
      killSwitchScenario("off", /disabled by PB_RETENTION_ENABLED=off/),
    ),
    runScenario("kill switch unrecognized", () =>
      killSwitchScenario(
        "flase",
        /ERROR unrecognized PB_RETENTION_ENABLED="flase", retention is disabled/,
      ),
    ),
    runScenario("bad cron bogus", () => badCronScenario("bogus")),
    runScenario("bad cron field", () => badCronScenario("*/0 * * * *")),
    runScenario("bad batch size", () =>
      badSettingScenario("PB_RETENTION_BATCH_SIZE", "5000", "10..1000"),
    ),
    runScenario("bad batch pause", () =>
      badSettingScenario("PB_RETENTION_BATCH_PAUSE_MS", "fast", "0..10000"),
    ),
    runScenario("bad boot grace", () =>
      badSettingScenario("PB_RETENTION_BOOT_GRACE_MIN", "-1", "0..1440"),
    ),
    runScenario("boot grace", bootGraceScenario),
  ]);
} finally {
  for (const name of containers) {
    try {
      docker("rm", "-f", "-v", name);
    } catch (error) {
      if (!/No such container:/i.test(error.stderr ?? ""))
        failures.push(new Error(`Remove ${name}`, { cause: error }));
    }
  }
  rmSync(temporary, { recursive: true, force: true });
}
if (failures.length > 0) {
  console.log(`${failures.length} RETENTION CHECK(S) FAILED`);
  process.exit(1);
}
console.log("ALL REAL POCKETBASE RETENTION CHECKS PASSED");
