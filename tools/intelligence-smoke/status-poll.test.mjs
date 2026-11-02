import assert from "node:assert/strict";
import test from "node:test";
import { pollRunStatus } from "./status-poll.mjs";
import { reportCleanupVerified } from "./rich-threads/cleanup-verdict.mjs";

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

const completeCleanup = {
  runId: "lifecycle-test",
  status: "passed",
  activeResourcesAbsent: true,
  physicalDeletionComplete: true,
  retainedVolumes: [],
  verifiedAt: "2026-10-19T12:00:02.000Z",
  deadlineExceeded: false,
};
const pendingInstance = {
  id: "attachment",
  volumeId: "volume",
  environmentId: "environment",
  serviceId: null,
  mountPath: "/data",
  isPendingDeletion: true,
};
const pendingCleanup = {
  ...completeCleanup,
  status: "passed-pending-provider-deletion",
  physicalDeletionComplete: false,
  retainedVolumes: [
    {
      volumeId: "volume",
      projectId: "project",
      environmentId: "environment",
      serviceId: "service",
      mountPath: "/data",
      firstVerifiedAt: "2026-10-19T12:00:01.000Z",
      retentionDeadlineAt: "2026-10-21T12:00:01.000Z",
      overdue: false,
      receipt: {
        volumeId: "volume",
        projectId: "project",
        environmentId: "environment",
        startedAt: "2026-10-19T12:00:00.000Z",
        requestSent: true,
        outcome: "unknown",
      },
      evidence: {
        state: "pending-detached",
        observedAt: "2026-10-19T12:00:01.000Z",
        volumeId: "volume",
        projectId: "project",
        environmentId: "environment",
        instances: [pendingInstance],
        environmentReferences: [],
        inspectedEnvironmentIds: [],
        inventoryComplete: true,
      },
    },
  ],
};
const acknowledgedWithoutInstances = structuredClone(pendingCleanup);
Object.assign(acknowledgedWithoutInstances.retainedVolumes[0].receipt, {
  outcome: "acknowledged",
  response: true,
  returnedAt: "2026-10-19T12:00:00.500Z",
});
Object.assign(acknowledgedWithoutInstances.retainedVolumes[0].evidence, {
  instances: [],
  inspectedEnvironmentIds: ["environment"],
});
test("accepts acknowledged retained volumes with no remaining attachments or references", () => {
  assert.equal(
    reportCleanupVerified({
      cleanup: "passed-pending-provider-deletion",
      cleanupEvidence: [acknowledgedWithoutInstances],
    }),
    true,
  );
});
for (const invalid of [
  { name: "unknown deletion", receipt: { outcome: "unknown" } },
  { name: "pending deletion", receipt: { outcome: "pending" } },
  { name: "refused deletion", receipt: { response: false } },
  { name: "unsent deletion", receipt: { requestSent: false } },
  { name: "missing acknowledgement time", receipt: { returnedAt: null } },
  {
    name: "remaining environment reference",
    evidence: { environmentReferences: [pendingInstance] },
  },
  { name: "incomplete inventory", evidence: { inventoryComplete: false } },
  {
    name: "remaining service attachment",
    evidence: { instances: [{ ...pendingInstance, serviceId: "service" }] },
  },
]) {
  test(`rejects retained volume proof with ${invalid.name}`, () => {
    const cleanup = structuredClone(acknowledgedWithoutInstances);
    Object.assign(cleanup.retainedVolumes[0].receipt, invalid.receipt);
    Object.assign(cleanup.retainedVolumes[0].evidence, invalid.evidence);
    assert.equal(
      reportCleanupVerified({
        cleanup: "passed-pending-provider-deletion",
        cleanupEvidence: [cleanup],
      }),
      false,
    );
  });
}
for (const cleanup of [completeCleanup, pendingCleanup]) {
  test(`waits for cleanup recovery on the same failed run: ${cleanup.status}`, async () => {
    const failed = {
      id: "run-test",
      status: "failed",
      exitCode: 1,
      cleanup: "failed",
      deadlineExceeded: false,
    };
    const recovered = {
      ...failed,
      status: "interrupted-cleaned",
      cleanup: cleanup.status,
      cleanupEvidence: [cleanup],
    };
    const h = harness([response(200, failed), response(200, recovered)]);
    assert.deepEqual(await pollRunStatus(h.options), recovered);
    assert.deepEqual(h.waits, [10000]);
  });
}
test("cleanup recovery cannot extend the original deadline", async () => {
  const failed = {
    id: "run-test",
    status: "failed",
    cleanup: "failed",
    deadlineExceeded: false,
  };
  const h = harness([response(200, failed), response(200, failed)], 15000);
  await assert.rejects(pollRunStatus(h.options), /still active/);
  assert.deepEqual(h.waits, [10000, 5000]);
  assert.deepEqual(h.timeouts, [15000, 5000]);
});
test("cleanup past its lifetime is returned without waiting", async () => {
  const failed = {
    id: "run-test",
    status: "failed",
    cleanup: "failed",
    deadlineExceeded: true,
  };
  const h = harness([response(200, failed)]);
  assert.deepEqual(await pollRunStatus(h.options), failed);
  assert.deepEqual(h.waits, []);
});
for (const cleanupCase of [
  {
    name: "physical absence",
    cleanup: completeCleanup,
    status: "passed",
    accepted: true,
  },
  {
    name: "verified pending detachment",
    cleanup: pendingCleanup,
    status: "passed-pending-provider-deletion",
    accepted: true,
  },
  {
    name: "acknowledged deletion without attachment records",
    cleanup: acknowledgedWithoutInstances,
    status: "passed-pending-provider-deletion",
    accepted: true,
  },
  {
    name: "status without evidence",
    cleanup: undefined,
    status: "passed",
    accepted: false,
  },
  {
    name: "pending marker without evidence",
    cleanup: { ...pendingCleanup, retainedVolumes: [] },
    status: "passed-pending-provider-deletion",
    accepted: false,
  },
  {
    name: "failed browser with recovered cleanup",
    cleanup: pendingCleanup,
    status: "passed-pending-provider-deletion",
    accepted: false,
    recovering: true,
  },
])
  test(`trigger sends POST once and retains evidence: ${cleanupCase.name}`, async () => {
    const { mkdtemp, writeFile, readFile, rm } =
      await import("node:fs/promises");
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
          assert.equal(options.method ?? 'GET','GET');
          if(status++===0) return new Response('',{status:503});
          if(${!!cleanupCase.recovering} && status===2) return Response.json({id:'run-test',status:'failed',cleanup:'failed',deadlineExceeded:false,exitCode:1});
          return Response.json({id:'run-test',status:'interrupted-cleaned',cleanup:${JSON.stringify(cleanupCase.status)},cleanupEvidence:${JSON.stringify(cleanupCase.cleanup ? [cleanupCase.cleanup] : null)},deadlineExceeded:false,crashReached:true,exitCode:1});
        }
        assert.equal(path,'/results/run-test/manifest');
        assert.equal(posts,1);
        await writeFile(${JSON.stringify(join(dir, "proof"))},'evidence requested');
        return Response.json({files:[]});
      };`,
      );
      const execution = promisify(execFile)(
        process.execPath,
        [
          "--import",
          preload,
          "tools/intelligence-smoke/rich-threads/trigger.mjs",
          `--mode=${cleanupCase.recovering ? "single" : "crash-recovery"}`,
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
      if (cleanupCase.accepted) {
        const result = await execution;
        assert.match(
          result.stdout,
          cleanupCase.status === "passed"
            ? /physical deletion verified/
            : /physical deletion pending provider removal/,
        );
      } else
        await assert.rejects(
          execution,
          cleanupCase.recovering
            ? /Hosted run did not pass/
            : /Hosted active-resource cleanup not verified/,
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
