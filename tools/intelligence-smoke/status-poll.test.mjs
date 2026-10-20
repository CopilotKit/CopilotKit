import assert from "node:assert/strict";
import test from "node:test";
import { pollRunStatus } from "./status-poll.mjs";

function harness(sequence, duration = 60000) {
  let now = 0;
  const waits = [],
    timeouts = [];
  return {
    waits,
    timeouts,
    options: {
      id: "run-test",
      deadline: duration,
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      request: async (timeout) => {
        timeouts.push(timeout);
        const value = sequence.shift();
        if (value instanceof Error) throw value;
        return value;
      },
    },
  };
}
const response = (status, value) => ({
  status,
  ok: status === 200,
  json: async () => value,
  body: { cancel: async () => {} },
});
const transient = () =>
  new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
const done = { id: "run-test", status: "interrupted-cleaned" };
test("503 during restart recovers to interrupted-cleaned", async () => {
  const h = harness([response(503), response(200, done)]);
  assert.deepEqual(await pollRunStatus(h.options), done);
  assert.deepEqual(h.waits, [1000]);
});
test("transport and body interruptions recover; valid response resets backoff", async () => {
  const bodyError = response(200);
  bodyError.json = async () => {
    throw transient();
  };
  const h = harness([
    transient(),
    bodyError,
    response(200, { id: "run-test", status: "running" }),
    transient(),
    response(200, done),
  ]);
  await pollRunStatus(h.options);
  assert.deepEqual(h.waits, [1000, 2000, 10000, 1000]);
});
test("absolute deadline bounds request timeout and retry sleeps", async () => {
  const h = harness([response(503), response(503)], 1500);
  await assert.rejects(pollRunStatus(h.options), /still active/);
  assert.deepEqual(h.waits, [1000, 500]);
  assert.deepEqual(h.timeouts, [1500, 500]);
});
for (const bad of [
  response(401),
  response(404),
  response(400),
  response(200, { id: "other", status: "passed" }),
  response(200, { id: "run-test", status: "mystery" }),
  new TypeError("redirect refused"),
  new Error("TLS", { cause: { code: "CERT_HAS_EXPIRED" } }),
  {
    ...response(200),
    json: async () => {
      throw new SyntaxError("invalid JSON");
    },
  },
]) {
  test(
    "permanent status/transport/schema errors are not retried " +
      String(bad.status ?? bad.message),
    async () => {
      const h = harness([bad, response(200, done)]);
      await assert.rejects(pollRunStatus(h.options));
      assert.deepEqual(h.waits, []);
    },
  );
}

test("trigger sends POST once and downloads evidence after restart recovery", async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const dir = await mkdtemp(join(tmpdir(), "status-trigger-"));
  try {
    const preload = join(dir, "fetch.mjs");
    await writeFile(
      preload,
      `
      import assert from 'node:assert/strict';
      import {writeFile} from 'node:fs/promises';
      let posts=0,status=0;
      globalThis.fetch=async (url, options)=>{
        const path=url.pathname;
        if(path==='/runs') { posts++; return Response.json({id:'run-test',statusUrl:'/runs/run-test',resultsUrl:'/results/run-test/'}); }
        if(path==='/runs/run-test') {
          if(status++===0) return new Response('',{status:503});
          return Response.json({id:'run-test',status:'interrupted-cleaned',cleanup:'passed',deadlineExceeded:false,crashReached:true});
        }
        assert.equal(path,'/results/run-test/manifest');
        assert.equal(posts,1);
        await writeFile(${JSON.stringify(join(dir, "proof"))},'evidence requested');
        return Response.json({files:[]});
      };`,
    );
    await promisify(execFile)(
      process.execPath,
      [
        "--import",
        preload,
        "tools/intelligence-smoke/rich-threads/trigger.mjs",
        "--mode=crash-recovery",
        `--output=${join(dir, "output")}`,
      ],
      {
        env: {
          ...process.env,
          RICH_RUNNER_URL: "https://runner.example",
          RICH_RUNNER_TOKEN: "x".repeat(32),
        },
      },
    );
    assert.equal(
      await readFile(join(dir, "proof"), "utf8"),
      "evidence requested",
    );
    assert.equal(
      JSON.parse(
        await readFile(join(dir, "output/runner-receipt.json"), "utf8"),
      ).status,
      "interrupted-cleaned",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
