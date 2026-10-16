import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import {
  initializeInspection as initializeChannel,
  requestInspection,
  inspectionHandler,
  closeInspection,
} from "./inspection-channel.mjs";

async function initializeInspection(context) {
  await mkdir(join(context.controlDirectory, context.runId), {
    recursive: true,
  });
  await writeFile(
    join(context.controlDirectory, context.runId, "journal.json"),
    JSON.stringify({
      runId: context.runId,
      projectId: "project",
      environmentId: "environment",
      expiresAt: context.expiresAt,
      phase: "setup",
    }),
  );
  return initializeChannel(context);
}
test("real HTTP worker roundtrip binds run/request, rejects replay, wrong token and inactive attempt", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "inspection-channel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runId = "rich-channel-test",
    token = "a".repeat(64);
  await initializeInspection({
    controlDirectory: root,
    runId,
    token,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const server = createServer(inspectionHandler({ controlDirectory: root }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/inspection/${runId}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const pending = requestInspection({
    controlDirectory: root,
    runId,
    operation: "readiness",
    input: { target: "database" },
    timeoutMs: 2000,
  });
  let job;
  for (let i = 0; i < 50; i++) {
    const response = await fetch(base + "/poll", { headers });
    job = await response.json();
    if (job.requestId) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(job.operation, "readiness");
  assert.equal(
    (
      await fetch(base + "/poll", {
        headers: { authorization: "Bearer wrong" },
      })
    ).status,
    401,
  );
  const body = {
    runId,
    requestId: job.requestId,
    ok: true,
    result: { ready: true },
  };
  assert.equal(
    (
      await fetch(base + "/result", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, runId: "other" }),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await fetch(base + "/result", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
    ).status,
    200,
  );
  assert.deepEqual(await pending, { ready: true });
  assert.equal(
    (
      await fetch(base + "/result", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
    ).status,
    409,
  );
  await closeInspection({ controlDirectory: root, runId });
  assert.equal((await fetch(base + "/poll", { headers })).status, 401);
});

test("channel refuses arbitrary commands, missing workers and expired credentials", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "inspection-errors-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = { controlDirectory: root, runId: "rich-errors" };
  await initializeInspection({
    ...context,
    token: "b".repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  await assert.rejects(
    requestInspection({
      ...context,
      operation: "shell",
      input: { command: "id" },
    }),
    /operation/,
  );
  await assert.rejects(
    requestInspection({
      ...context,
      operation: "thread-events",
      input: { framework: "mastra", threadId: "id", sql: "SELECT 1" },
    }),
    /input/,
  );
  await assert.rejects(
    requestInspection({
      ...context,
      operation: "readiness",
      input: { target: "database" },
      timeoutMs: 30,
    }),
    /timed out/,
  );
  await closeInspection(context);
  await assert.rejects(
    requestInspection({
      ...context,
      operation: "readiness",
      input: { target: "database" },
    }),
    /inactive/,
  );
});

test("bootstrap is delivered once even to concurrent pollers and cannot reset credentials", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "inspection-claim-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = {
    controlDirectory: root,
    runId: "rich-claim",
    token: "c".repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  await initializeInspection(context);
  await assert.rejects(initializeInspection(context), { code: "EEXIST" });
  const server = createServer(inspectionHandler({ controlDirectory: root }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/inspection/${context.runId}`,
    headers = { authorization: `Bearer ${context.token}` };
  const pending = requestInspection({
    ...context,
    operation: "bootstrap",
    timeoutMs: 500,
  });
  const failure = assert.rejects(pending, /timed out/);
  await new Promise((r) => setTimeout(r, 50));
  const jobs = await Promise.all(
    Array.from(
      { length: 4 },
      async () => await (await fetch(base + "/poll", { headers })).json(),
    ),
  );
  assert.equal(jobs.filter((job) => job.requestId).length, 1);
  await failure;
  await assert.rejects(
    requestInspection({ ...context, operation: "bootstrap", timeoutMs: 100 }),
    /already pending/,
  );
});

test("separate controller process revokes worker access", async (t) => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const root = await mkdtemp(join(tmpdir(), "inspection-process-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = {
    controlDirectory: root,
    runId: "rich-process",
    token: "d".repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  await initializeInspection(context);
  const moduleUrl = new URL("./inspection-channel.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {closeInspection} from ${JSON.stringify(moduleUrl)};await closeInspection(${JSON.stringify(context)});`,
    ],
    { stdio: "pipe" },
  );
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
  await assert.rejects(
    requestInspection({
      ...context,
      operation: "readiness",
      input: { target: "worker" },
    }),
    /inactive/,
  );
});

test("missing or replaced journal denies worker credentials", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "inspection-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = {
    controlDirectory: root,
    runId: "rich-journal",
    token: "e".repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  await initializeInspection(context);
  const path = join(root, context.runId, "journal.json");
  await rm(path);
  await assert.rejects(
    requestInspection({
      ...context,
      operation: "readiness",
      input: { target: "worker" },
    }),
    { code: "ENOENT" },
  );
  await writeFile(
    path,
    JSON.stringify({
      runId: context.runId,
      projectId: "project",
      environmentId: "wrong",
      expiresAt: context.expiresAt,
      phase: "setup",
    }),
  );
  await assert.rejects(
    requestInspection({
      ...context,
      operation: "readiness",
      input: { target: "worker" },
    }),
    /environment mismatch/,
  );
});

test("separate HTTP worker and controller serialize repeated jobs and stop after revocation", async (t) => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const root = await mkdtemp(join(tmpdir(), "inspection-concurrent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = {
    controlDirectory: root,
    runId: "rich-concurrent",
    token: "f".repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  await initializeInspection(context);
  const server = createServer(inspectionHandler(context));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const workerConfig = {
    ...context,
    runnerUrl: `http://127.0.0.1:${server.address().port}`,
  };
  const moduleUrl = new URL("./inspection-worker.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {runInspectionWorker} from ${JSON.stringify(moduleUrl)};try {await runInspectionWorker({config:${JSON.stringify(workerConfig)},execute:async()=>({ready:true})});}catch {process.exitCode=0;}`,
    ],
    { stdio: "pipe" },
  );
  t.after(() => child.kill());
  const exited = once(child, "exit");
  for (let i = 0; i < 12; i++)
    assert.deepEqual(
      await requestInspection({
        ...context,
        operation: "readiness",
        input: { target: "worker" },
        timeoutMs: 3000,
      }),
      { ready: true },
    );
  await closeInspection(context);
  const [code] = await exited;
  assert.equal(code, 0);
  await assert.rejects(
    requestInspection({
      ...context,
      operation: "readiness",
      input: { target: "worker" },
    }),
    /inactive/,
  );
});

test("revocation recovers a filesystem lock abandoned by another process", async (t) => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const root = await mkdtemp(join(tmpdir(), "inspection-dead-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = {
    controlDirectory: root,
    runId: "rich-dead-lock",
    token: "e".repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  await initializeInspection(context);
  const moduleUrl = new URL("./journal.mjs", import.meta.url).href,
    path = join(root, context.runId, "inspection", "state.json.lock");
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {recoveryLock} from ${JSON.stringify(moduleUrl)};await recoveryLock(${JSON.stringify(path)});`,
    ],
    { stdio: "pipe" },
  );
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
  await closeInspection(context);
  await assert.rejects(
    requestInspection({
      ...context,
      operation: "readiness",
      input: { target: "worker" },
    }),
    /inactive/,
  );
});
