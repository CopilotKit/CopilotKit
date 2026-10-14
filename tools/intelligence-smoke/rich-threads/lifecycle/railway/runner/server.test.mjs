import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { runnerServer } from "./server.mjs";
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
