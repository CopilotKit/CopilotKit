import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const url = process.env.PB_TEST_URL ?? "http://127.0.0.1:43120";
const mode = process.env.PB_TEST_MODE ?? "atomic";
let token;
async function request(path, method = "GET", body, auth = true) {
  const response = await fetch(url + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth && token ? { Authorization: token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  return { status: response.status, data };
}
async function ok(path, method, body) {
  const r = await request(path, method, body);
  assert.ok(r.status < 300, JSON.stringify(r));
  return r.data;
}
token = (
  await ok("/api/admins/auth-with-password", "POST", {
    identity: "local-proof@example.test",
    password: "local-proof-password-only",
  })
).token;
const collection = (name) => `/api/collections/${name}/records`;
const key = `d5:transaction-proof/${Date.now()}`;
const observed_at = new Date().toISOString();
const values = {
  key,
  dimension: "d5",
  state: "red",
  signal: { proof: true },
  observed_at,
  transitioned_at: observed_at,
  fail_count: 1,
  first_failure_at: observed_at,
  written_by: "transaction-proof",
  state_written_at: observed_at,
};
const job = await ok(collection("probe_jobs"), "POST", {
  probe_key: key,
  status: "done",
  result: { proof: "immutable" },
});
const history = {
  key,
  dimension: "d5",
  state: "red",
  transition: "first",
  signal: { proof: true },
  observed_at,
};
const outcome = {
  kind: "write",
  value: {
    previousState: null,
    newState: "red",
    transition: "first",
    firstFailureAt: observed_at,
    failCount: 1,
    persisted: true,
  },
};
const input = {
  jobId: job.id,
  key,
  fingerprint: "a".repeat(64),
  route: "write",
  basis: null,
  status: { mode: "upsert", values },
  history,
  outcome,
};
async function apply(body) {
  if (mode !== "legacy")
    return request("/api/fleet/observations/apply", "POST", body);
  // Exact old persistence boundary: separate status then best-effort history.
  const status = await request(
    collection("status"),
    "POST",
    body.status.values,
  );
  if (status.status >= 300) return status;
  const audit = await request(
    collection("status_history"),
    "POST",
    body.history,
  );
  return audit.status >= 300
    ? audit
    : { status: 200, data: { replay: false, outcome: body.outcome } };
}
const list = async (name) =>
  (
    await ok(
      collection(name) + "?filter=" + encodeURIComponent(`key = "${key}"`),
    )
  ).items;
if (mode === "missing-schema") {
  const schema = await ok("/api/collections/probe_jobs");
  assert.ok(
    !schema.schema.some(
      (field) => field.name === "result_observation_receipts",
    ),
  );
  const response = await apply(input);
  assert.equal(response.status, 500);
  assert.equal(response.data.data.code, "persistence_failure");
  assert.equal((await list("status")).length, 0);
  assert.equal((await list("status_history")).length, 0);
  console.log(
    "PASS missing receipt schema fails loudly before status/history effects",
  );
  process.exit(0);
}
const invalidHistory = {
  ...input,
  history: { ...history, transition: "INVALID" },
};
const failed = await apply(invalidHistory);
const afterFailure = {
  status: await list("status"),
  history: await list("status_history"),
  job: await ok(collection("probe_jobs") + "/" + job.id),
};
console.log(
  JSON.stringify({
    case: "history failure rolls back attempted status",
    mode,
    failed,
    afterFailure,
  }),
);
assert.ok(failed.status >= 400);
assert.equal(
  afterFailure.status.length,
  0,
  "history failure must roll back status",
);
assert.equal(afterFailure.history.length, 0);
assert.ok(!afterFailure.job.result_observation_receipts?.[key]);
console.log("PASS history failure atomic rollback");
const unauthenticated = await request(
  "/api/fleet/observations/apply",
  "POST",
  input,
  false,
);
assert.equal(unauthenticated.status, 401);
assert.equal((await apply({ ...input, jobId: "missingjob00000" })).status, 404);
const snapshot = async (jobId = job.id) => ({
  status: await list("status"),
  history: await list("status_history"),
  job: await ok(collection("probe_jobs") + "/" + jobId),
});

const container = process.env.PB_TEST_CONTAINER;
assert.ok(
  container,
  "PB_TEST_CONTAINER is required for real server-side fault checks",
);
const docker = (...args) =>
  execFileSync("docker", ["--context", "desktop-linux", ...args], {
    encoding: "utf8",
  });
for (const fault of ["status", "history", "receipt"]) {
  const before = await snapshot();
  docker("exec", container, "touch", `/pb_data/fault-${fault}`);
  let failure;
  try {
    failure = await apply(input);
  } finally {
    docker("exec", container, "rm", `/pb_data/fault-${fault}`);
  }
  assert.equal(failure.status, 500, JSON.stringify(failure));
  assert.deepEqual(await snapshot(), before, `${fault} failure rollback`);
  console.log(
    `PASS server-side ${fault} failure rolls back status/history/receipt`,
  );
}
const success = await apply(input);
assert.equal(success.status, 200, JSON.stringify(success));
assert.deepEqual(success.data, { replay: false, outcome });
const committed = await snapshot();
assert.equal(committed.history.length, 1);
assert.deepEqual(committed.job.result, { proof: "immutable" });
assert.deepEqual((await apply(input)).data, { replay: true, outcome });
assert.deepEqual(await snapshot(), committed);
assert.equal(
  (await apply({ ...input, fingerprint: "b".repeat(64) })).data.data.code,
  "identity_conflict",
);
console.log(
  "PASS replay is durable and preserves raw worker result; conflicting identity rejects",
);
const statusFields = [
  "key",
  "dimension",
  "state",
  "signal",
  "observed_at",
  "transitioned_at",
  "fail_count",
  "first_failure_at",
  "written_by",
  "state_written_at",
];
const basisOf = (row) => ({
  id: row.id,
  fields: Object.fromEntries(statusFields.map((field) => [field, row[field]])),
  updated: row.updated,
});
const secondJob = await ok(collection("probe_jobs"), "POST", {
  probe_key: key,
  status: "done",
});
const second = {
  ...input,
  jobId: secondJob.id,
  basis: basisOf(committed.status[0]),
  status: { mode: "upsert", values: { ...values, fail_count: 2 } },
  history: { ...history, transition: "sustained_red" },
  outcome: {
    kind: "write",
    value: {
      ...outcome.value,
      previousState: "red",
      transition: "sustained_red",
      failCount: 2,
    },
  },
};
const concurrent = await Promise.all(
  Array.from({ length: 8 }, () => apply(second)),
);
assert.ok(
  concurrent.every((r) => r.status === 200),
  JSON.stringify(concurrent),
);
assert.equal(concurrent.filter((r) => !r.data.replay).length, 1);
assert.equal((await list("status"))[0].fail_count, 2);
assert.equal((await list("status_history")).length, 2);
console.log(
  "PASS 8 concurrent same-observation requests commit once; new job with same timestamp increments once",
);
const afterNew = await snapshot();
assert.deepEqual((await apply(input)).data, { replay: true, outcome });
assert.deepEqual(await snapshot(), afterNew);
console.log("PASS old replay after newer job changes nothing");
const thirdJob = await ok(collection("probe_jobs"), "POST", {
  probe_key: key,
  status: "done",
});
const third = { ...second, jobId: thirdJob.id };
const beforeStale = await snapshot(thirdJob.id);
assert.equal((await apply(third)).data.data.code, "basis_conflict");
assert.deepEqual(await snapshot(thirdJob.id), beforeStale);
console.log("PASS stale prepared basis rejects without effects");
// An absent-row history fallback is an observation in its own right. A later
// status row must not make its replay take the now-available overlay route.
const fallbackKey = key + "-fallback";
const fallbackJob = await ok(collection("probe_jobs"), "POST", {
  probe_key: fallbackKey,
  status: "done",
});
const fallbackOutcome = {
  kind: "write",
  value: {
    previousState: null,
    newState: "error",
    errorStatePrev: null,
    transition: "error",
    firstFailureAt: null,
    failCount: 0,
    persisted: false,
  },
};
const fallback = {
  ...input,
  jobId: fallbackJob.id,
  key: fallbackKey,
  route: "history",
  status: null,
  history: { ...history, key: fallbackKey, transition: "error" },
  outcome: fallbackOutcome,
};
assert.equal((await apply(fallback)).status, 200);
const later = await ok(collection("status"), "POST", {
  ...values,
  key: fallbackKey,
});
const beforeFallbackReplay = await ok(collection("status") + "/" + later.id);
assert.deepEqual(
  (
    await apply({
      ...fallback,
      route: "overlay",
      status: { mode: "patch", values: { signal: { changed: true } } },
      outcome: {
        kind: "overlay",
        value: { applied: true, state: "red", historyPersisted: true },
      },
    })
  ).data,
  { replay: true, outcome: fallbackOutcome },
);
assert.deepEqual(
  await ok(collection("status") + "/" + later.id),
  beforeFallbackReplay,
);
console.log(
  "PASS history fallback replay preserves original outcome after baseline appears",
);
// Different keys of the same job append against the transaction's current row.
const multiJob = await ok(collection("probe_jobs"), "POST", {
  probe_key: key,
  status: "done",
});
const multiInputs = [0, 1].map((n) => ({
  ...input,
  jobId: multiJob.id,
  key: key + "-multi" + n,
  status: { mode: "upsert", values: { ...values, key: key + "-multi" + n } },
  history: { ...history, key: key + "-multi" + n },
}));
assert.ok(
  (await Promise.all(multiInputs.map(apply))).every((r) => r.status === 200),
);
assert.equal(
  Object.keys(
    (await ok(collection("probe_jobs") + "/" + multiJob.id))
      .result_observation_receipts,
  ).length,
  2,
);
console.log("PASS concurrent different keys preserve both job receipts");
// Fill the actual 2 MiB field near its cap on this private job. The next
// legitimate receipt must fail validation and roll back status/history.
const schema = await ok("/api/collections/probe_jobs");
assert.equal(
  schema.schema.find((f) => f.name === "result_observation_receipts").options
    .maxSize,
  2097152,
);
await ok(collection("probe_jobs") + "/" + thirdJob.id, "PATCH", {
  result_observation_receipts: { padding: "x".repeat(2097050) },
});
const current = (await list("status"))[0];
const capInput = {
  ...third,
  basis: basisOf(current),
  status: { mode: "upsert", values: { ...values, fail_count: 3 } },
};
const beforeCap = await snapshot(thirdJob.id);
assert.equal((await apply(capInput)).status, 500);
assert.deepEqual(await snapshot(thirdJob.id), beforeCap);
console.log(
  "PASS actual 2 MiB receipt schema validation failure rolls back all effects",
);
// Proxy receives the committed upstream reply but drops it before forwarding.

const lossJob = await ok(collection("probe_jobs"), "POST", {
  probe_key: key,
  status: "done",
});
const lossKey = key + "-lost-response";
const lostInput = {
  ...input,
  jobId: lossJob.id,
  key: lossKey,
  status: { mode: "upsert", values: { ...values, key: lossKey } },
  history: { ...history, key: lossKey },
};
let upstream;
const proxy = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  upstream = await request(
    "/api/fleet/observations/apply",
    "POST",
    JSON.parse(Buffer.concat(chunks)),
  );
  res.destroy();
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
try {
  await assert.rejects(
    fetch(`http://127.0.0.1:${proxy.address().port}`, {
      method: "POST",
      body: JSON.stringify(lostInput),
    }),
  );
  assert.equal(upstream.status, 200);
  assert.equal(upstream.data.replay, false);
  assert.deepEqual((await apply(lostInput)).data, { replay: true, outcome });
  const rows = await ok(
    collection("status_history") +
      "?filter=" +
      encodeURIComponent(`key = "${lossKey}"`),
  );
  assert.equal(rows.items.length, 1);
} finally {
  await new Promise((resolve) => proxy.close(resolve));
}
console.log(
  "PASS lost post-commit HTTP response retries to original receipt without duplicate history",
);
console.log("ALL REAL POCKETBASE TRANSACTION CHECKS PASSED");
