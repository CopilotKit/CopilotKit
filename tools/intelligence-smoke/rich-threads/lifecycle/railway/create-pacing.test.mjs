import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { creationPacer } from "./create-pacing.mjs";
import { durableJson } from "./journal.mjs";

const workspaceId = "11111111-2222-3333-4444-555555555555";
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "creation-pacing-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const state = { now: 100000, mono: 0, sent: [], sleeps: [], checks: 0 };
  const rateLimits = {
    environmentCreate: { max: 1, windowSeconds: 30 },
    volumeCreate: { max: 1, windowSeconds: 30 },
  };
  const args = {
    directory,
    projectId: "project",
    clock: () => state.now,
    monotonic: () => state.mono,
    sleep: async (ms) => {
      state.sleeps.push(ms);
      state.now += ms;
      state.mono += ms;
    },
    api: {
      request: async () => ({
        id: "project",
        workspaceId,
        subscriptionPlanLimit: { rateLimits },
      }),
    },
  };
  const options = {
    deadline: 1000000,
    check: async () => {
      state.checks++;
    },
  };
  const path = join(directory, `${workspaceId}-environmentCreate.json`);
  const send = async () => {
    const reservation = JSON.parse(await readFile(path, "utf8"));
    assert.equal(reservation.status, "reserved");
    assert.equal(reservation.referenceAt, state.now);
    state.sent.push(state.now);
    return "created";
  };
  return { state, args, options, path, send, rateLimits };
}

test("each environment create waits the reported window plus cushion before its intent", async (t) => {
  const f = await fixture(t);
  const pace = creationPacer(f.args);
  assert.equal(await pace("createEnvironment", f.options, f.send), "created");
  await pace("createEnvironment", f.options, f.send);
  assert.deepEqual(f.state.sent, [132000, 164000]);
  assert.ok(f.state.sleeps.every((ms) => ms <= 1000));
  assert.equal(JSON.parse(await readFile(f.path, "utf8")).status, "settled");
});

test("restart with pending reservation waits a full window and never replays old send", async (t) => {
  const f = await fixture(t);
  await durableJson(f.path, {
    version: 1,
    workspaceId,
    operation: "createEnvironment",
    referenceAt: 110000,
    status: "reserved",
  });
  await creationPacer(f.args)("createEnvironment", f.options, f.send);
  assert.deepEqual(f.state.sent, [142000]);
});

test("interruption during wait sends nothing; restart cannot bypass cooldown", async (t) => {
  const f = await fixture(t);
  const stop = {
    ...f.options,
    check: async () => {
      if (f.state.now >= 105000) throw Error("interrupted");
    },
  };
  await assert.rejects(
    creationPacer(f.args)("createEnvironment", stop, f.send),
    /interrupted/,
  );
  assert.deepEqual(f.state.sent, []);
  assert.equal(JSON.parse(await readFile(f.path, "utf8")).status, "reserved");
  await creationPacer(f.args)("createEnvironment", f.options, f.send);
  assert.deepEqual(f.state.sent, [137000]);
});

test("unknown send result is propagated once and still consumes cooldown", async (t) => {
  const f = await fixture(t);
  const pace = creationPacer(f.args);
  let calls = 0;
  await assert.rejects(
    pace("createEnvironment", f.options, async () => {
      calls++;
      throw Error("unknown outcome");
    }),
    /unknown outcome/,
  );
  assert.equal(calls, 1);
  await creationPacer(f.args)("createEnvironment", f.options, f.send);
  assert.deepEqual(f.state.sent, [164000]);
});

test("wall clock jump cannot shorten real elapsed cooldown", async (t) => {
  const f = await fixture(t);
  const sleep = f.args.sleep;
  f.args.sleep = async (ms) => {
    await sleep(ms);
    if (f.state.mono === 1000) f.state.now += 200000;
  };
  await creationPacer(f.args)("createEnvironment", f.options, f.send);
  assert.equal(f.state.mono, 32000);
});

test("clock rollback retains the durable reference and waits longer", async (t) => {
  const f = await fixture(t);
  const sleep = f.args.sleep;
  f.args.sleep = async (ms) => {
    await sleep(ms);
    if (f.state.mono === 1000) f.state.now -= 5000;
  };
  await creationPacer(f.args)("createEnvironment", f.options, f.send);
  assert.equal(f.state.mono, 37000);
  assert.deepEqual(f.state.sent, [132000]);
});

test("invalid limits, corrupt ledger, and insufficient lifetime fail before send", async (t) => {
  const f = await fixture(t);
  f.rateLimits.environmentCreate.windowSeconds = 0;
  await assert.rejects(
    creationPacer(f.args)("createEnvironment", f.options, f.send),
    /Invalid creation rate window/,
  );
  f.rateLimits.environmentCreate.windowSeconds = 30;
  await assert.rejects(
    creationPacer(f.args)(
      "createEnvironment",
      { ...f.options, deadline: 110000 },
      f.send,
    ),
    /Insufficient lifetime/,
  );
  await durableJson(f.path, {
    version: 1,
    workspaceId,
    operation: "createEnvironment",
    referenceAt: "bad",
    status: "reserved",
  });
  await assert.rejects(
    creationPacer(f.args)("createEnvironment", f.options, f.send),
  );
  assert.deepEqual(f.state.sent, []);
});

test("volume limit is applied independently; unlisted service operation stays unchanged", async (t) => {
  const f = await fixture(t);
  f.rateLimits.volumeCreate.windowSeconds = 40;
  const pace = creationPacer(f.args);
  await pace("createVolume", f.options, async () =>
    f.state.sent.push(f.state.now),
  );
  assert.deepEqual(f.state.sent, [142000]);
  await pace("createService", f.options, async () =>
    f.state.sent.push(f.state.now),
  );
  assert.deepEqual(f.state.sent, [142000, 142000]);
});
