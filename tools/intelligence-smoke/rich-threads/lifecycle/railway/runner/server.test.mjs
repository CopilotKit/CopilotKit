import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { runnerServer, schedulingEnabled } from "./server.mjs";
test("scheduled runs require explicit opt-in and reject misspelled settings", () => {
  assert.equal(schedulingEnabled({}), false);
  assert.equal(
    schedulingEnabled({ RICH_RUNNER_SCHEDULE_ENABLED: "false" }),
    false,
  );
  assert.equal(
    schedulingEnabled({ RICH_RUNNER_SCHEDULE_ENABLED: "true" }),
    true,
  );
  for (const value of ["", "TRUE", "1", "yes"])
    assert.throws(
      () => schedulingEnabled({ RICH_RUNNER_SCHEDULE_ENABLED: value }),
      /true or false/,
    );
});
test("runner API authenticates mutations and bounds retained downloads", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "railway-api-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = "run-11111111-1111-4111-8111-111111111111";
  const dir = join(root, "results", id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "run.json"),
    JSON.stringify({ id, status: "passed" }),
  );
  await writeFile(join(root, "private.json"), "secret");
  const token = "t".repeat(32);
  let starts = 0;
  const server = runnerServer({
    root,
    config: {},
    token,
    scheduler: {
      status: () => ({ busy: false }),
      start: async () => {
        starts++;
        return { accepted: true, id };
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  assert.equal(
    (await fetch(base + "/runs", { method: "POST", body: '{"mode":"single"}' }))
      .status,
    401,
  );
  assert.equal(starts, 0);
  assert.equal(
    (
      await fetch(base + "/runs", {
        method: "POST",
        headers,
        body: '{"mode":"single"}',
      })
    ).status,
    202,
  );
  assert.equal(
    (
      await fetch(base + "/runs", {
        method: "POST",
        headers,
        body: '{"mode":"unknown"}',
      })
    ).status,
    503,
  );
  const manifest = await (
    await fetch(`${base}/results/${id}/manifest`, { headers })
  ).json();
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0].path, "run.json");
  await symlink(join(root, "private.json"), join(dir, "escape"));
  assert.equal(
    (await fetch(`${base}/results/${id}/escape`, { headers })).status,
    503,
  );
  assert.equal(
    (await fetch(`${base}/results/${id}/manifest`, { headers })).status,
    503,
  );
});

test("consumer activation records only the configured URL and current validated digest", async (t) => {
  const { digest, policyDigest } = await import("../distribution.mjs");
  const root = await mkdtemp(join(tmpdir(), "railway-activation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recordsFile = join(root, "records.json");
  const bytes = JSON.stringify({ schemaVersion: 1, runs: [] });
  await writeFile(recordsFile, bytes);
  const endpoint = "https://runner.example/registry";
  const token = "t".repeat(32);
  const server = runnerServer({
    root,
    token,
    scheduler: {},
    config: {
      recordsFile,
      consumers: [
        { transport: "https", consumer: "harness", recordsFile: endpoint },
      ],
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/consumers/harness`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const receipt = {
    reader: "railway-lifecycle-records-v1",
    recordsFile: endpoint,
    sha256: digest(bytes),
    policySha256: policyDigest(),
  };
  const post = (body) =>
    fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal(
    (await post({ ...receipt, recordsFile: "https://other.example/registry" }))
      .status,
    503,
  );
  assert.equal(
    (await post({ ...receipt, sha256: "0".repeat(64) })).status,
    503,
  );
  assert.equal((await post(receipt)).status, 200);
  const saved = await (await fetch(url, { headers })).json();
  assert.equal(saved.recordsFile, endpoint);
  assert.equal(saved.sha256, digest(bytes));
  assert.equal(saved.consumer, "harness");
});
