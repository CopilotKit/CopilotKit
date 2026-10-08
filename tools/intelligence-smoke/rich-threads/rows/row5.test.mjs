import assert from "node:assert/strict";
import test from "node:test";
import {
  row,
  requiredItems,
  assertSurvives,
  assertRestarts,
  assertContinued,
  assertResumed,
} from "./row5.mjs";
import { ownedProcess } from "./row5-process.mjs";

const clone = (value) => structuredClone(value);
const base = () => ({
  identity: {
    intelligenceThreadId: "thread",
    nativeThreadId: "native",
    userId: "user",
    agentId: "agent",
  },
  ...Object.fromEntries(
    ["intelligence", "native"].map((store) => [
      store,
      {
        items: [
          {
            id: "rich",
            parts: [
              {
                type: "image",
                bytes: "YWJj",
                mimeType: "image/png",
                filename: "original.png",
              },
              { type: "a2ui", surfaceId: "first" },
            ],
          },
        ],
        state: {
          todos: [
            { id: "todo1", title: "retain", description: "original state" },
          ],
        },
        controls: [],
      },
    ]),
  ),
});
const receipts = () =>
  [
    "intelligence-api",
    "intelligence-gateway",
    "application-runtime",
    "native-backend",
  ].map((role) => ({
    service: role,
    role,
    owner: "unit",
    before: { instance: "old", store: "durable-fixture" },
    after: { instance: "new", store: "durable-fixture" },
    ready: true,
  }));

test("restart proof rejects missing roles, unchanged processes, wrong owners and new stores", () => {
  assertRestarts(receipts(), "unit");
  assert.throws(
    () => assertRestarts(receipts().slice(1), "unit"),
    /Missing actual restart/,
  );
  for (const mutate of [
    (r) => {
      r[0].after.instance = r[0].before.instance;
    },
    (r) => {
      r[0].owner = "someone-else";
    },
    (r) => {
      r[0].after.store = "replacement-db";
    },
    (r) => {
      r[0].before.store = "memory";
    },
    (r) => {
      r[0].ready = false;
    },
  ]) {
    const r = receipts();
    mutate(r);
    assert.throws(() => assertRestarts(r, "unit"));
  }
});

test("reload proof catches media, filename, UI association, state and identity corruption", () => {
  const original = base();
  assertSurvives(original, clone(original));
  for (const mutate of [
    (s) => {
      s.native.items[0].parts[0].bytes = "ZA==";
    },
    (s) => {
      s.intelligence.items[0].parts[0].filename = "lost.png";
    },
    (s) => {
      s.intelligence.items[0].parts[1].surfaceId = "wrong";
    },
    (s) => {
      s.native.state.todos = [];
    },
    (s) => {
      s.identity.nativeThreadId = "empty-session";
    },
  ]) {
    const after = clone(original);
    mutate(after);
    assert.throws(() => assertSurvives(original, after));
  }
});

test("continuation must save both roles in both stores and retain history and state", () => {
  const before = base();
  const expected = {
    userItem: { id: "u", text: "continue" },
    assistantItem: { id: "a", text: "retained todo" },
    state: before.native.state,
  };
  const after = clone(before);
  for (const store of ["native", "intelligence"])
    after[store].items.push(expected.userItem, expected.assistantItem);
  assertContinued(before, after, expected);
  after.native.items.pop();
  assert.throws(
    () => assertContinued(before, after, expected),
    /assistant item missing/,
  );
});

function pending() {
  const before = base();
  for (const store of ["native", "intelligence"])
    before[store].controls.push({
      id: "interrupt",
      kind: "native",
      status: "pending",
      payload: { question: "approve?" },
    });
  const after = clone(before);
  for (const store of ["native", "intelligence"]) {
    Object.assign(after[store].controls[0], {
      status: "completed",
      result: { approved: true },
      finalResponse: { id: "final", text: "saved" },
    });
    after[store].items.push(after[store].controls[0].finalResponse);
  }
  return {
    before,
    after,
    scenario: { kind: "native-pending", interactionId: "interrupt" },
  };
}

test("resume requires original interaction, cleared pending, result and saved final response", () => {
  const { before, after, scenario } = pending();
  assertResumed(before, after, scenario);
  for (const mutate of [
    (s) => {
      s.native.controls[0].id = "new-interrupt";
    },
    (s) => {
      s.native.controls[0].status = "pending";
    },
    (s) => {
      delete s.intelligence.controls[0].result;
    },
    (s) => {
      s.native.controls[0].result = { approved: false };
    },
    (s) => {
      s.native.items.pop();
    },
  ]) {
    const bad = clone(after);
    mutate(bad);
    assert.throws(() => assertResumed(before, bad, scenario));
  }
});

const projection = (snapshot) => ({
  identity: snapshot.identity,
  ...snapshot.intelligence,
  evidence: ["unit-browser.json"],
});

function fixture() {
  const snapshots = new Map();
  const scenarios = ["fresh", "imported"].flatMap((origin) =>
    [
      "rich",
      "frontend-pending",
      "frontend-completed",
      "native-pending",
      "native-completed",
    ].map((kind) => {
      const id = `${origin}-${kind}`;
      const s = base();
      s.identity.intelligenceThreadId = id;
      s.identity.nativeThreadId = `native-${id}`;
      const scenario = {
        id,
        origin,
        kind,
        interactionId: `${id}-control`,
        provenance: "unit fixture only",
        coverage: requiredItems.map((item) => ({
          item,
          status: "exercised",
          evidence: ["unit-only.json"],
        })),
      };
      if (kind !== "rich") {
        for (const store of ["native", "intelligence"])
          s[store].controls.push({
            id: scenario.interactionId,
            kind: kind.split("-")[0],
            status: kind.endsWith("pending") ? "pending" : "completed",
            payload: "approve",
            ...(kind.endsWith("completed")
              ? { result: true, finalResponse: { id: "done", text: "done" } }
              : {}),
          });
      }
      snapshots.set(id, s);
      return scenario;
    }),
  );
  const artifacts = new Map();
  return {
    scenarios,
    snapshots,
    artifacts,
    context: {
      fixture: { row5: { owner: "unit" } },
      writeArtifact: async (name, value) => artifacts.set(name, value),
      services: {
        row5: {
          prepare: async () => scenarios,
          read: async (s) => snapshots.get(s.id),
          expectedBrowser: async (_s, snapshot) => projection(snapshot),
          open: async (s) => projection(snapshots.get(s.id)),
          restart: async () => receipts(),
          respond: async (scenario) => {
            const s = snapshots.get(scenario.id);
            for (const store of ["native", "intelligence"]) {
              const c = s[store].controls[0];
              Object.assign(c, {
                status: "completed",
                result: true,
                finalResponse: { id: "final", text: "resumed" },
              });
              s[store].items.push(c.finalResponse);
            }
          },
          followup: async (scenario) => {
            const s = snapshots.get(scenario.id);
            const expected = {
              userItem: { id: "u", text: "continue" },
              assistantItem: { id: "a", text: "continued" },
              state: s.native.state,
            };
            for (const store of ["native", "intelligence"])
              s[store].items.push(expected.userItem, expected.assistantItem);
            return expected;
          },
        },
      },
    },
  };
}

test("row orchestrates all ten scenarios and captures pre/post evidence", async () => {
  const f = fixture();
  const report = await row.run(f.context);
  assert.equal(report.status, "passed");
  assert.equal(report.checks.length, 10);
  assert.ok(f.artifacts.has("imported-native-pending-resumed.json"));
  assert.ok(f.artifacts.has("fresh-rich-continued.json"));
  for (const scenario of f.scenarios)
    assert.ok(f.artifacts.has(`${scenario.id}-continued.json`));
  assert.ok(f.artifacts.has("restarts.json"));
});

test("coverage omissions and missing pending controls remain unvalidated", async () => {
  const f = fixture();
  for (const scenario of f.scenarios) scenario.coverage = [];
  assert.equal((await row.run(f.context)).status, "unvalidated");
  const other = fixture();
  other.scenarios.pop();
  assert.equal((await row.run(other.context)).status, "unvalidated");
});

test("completed controls cannot reappear pending after restart", async () => {
  const f = fixture();
  f.context.services.row5.restart = async () => {
    f.snapshots.get(
      "fresh-frontend-completed",
    ).intelligence.controls[0].status = "pending";
    return receipts();
  };
  await assert.rejects(row.run(f.context), /changed across reload or restart/);
});

test("owned process restarts an actual child and cleans it up", async () => {
  const process = ownedProcess({
    owner: "unit",
    service: "owned-child",
    role: "native-backend",
    store: "fixture-file",
    file: globalThis.process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"],
    ready: async () => true,
  });
  try {
    const started = await process.start();
    const receipt = await process.restart();
    assert.equal(receipt.before.instance, started.instance);
    assert.notEqual(receipt.after.instance, started.instance);
  } finally {
    await process.stop();
  }
});

test("owned process bounds a hung readiness callback and stops its child", async () => {
  const owned = ownedProcess({
    owner: "unit",
    service: "hung",
    role: "native-backend",
    store: "fixture-file",
    file: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"],
    timeoutMs: 100,
    ready: () => new Promise(() => {}),
  });
  await assert.rejects(owned.start(), /readiness timed out/);
  await owned.stop();
});

test("owned process reports spawn failure without hanging cleanup", async () => {
  const owned = ownedProcess({
    owner: "unit",
    service: "missing",
    role: "native-backend",
    store: "fixture-file",
    file: "/nonexistent-pni600-executable",
    timeoutMs: 100,
    ready: async () => false,
  });
  await assert.rejects(owned.start(), /ENOENT/);
  await owned.stop();
});

test("row verdict agrees with shared aggregation for incomplete coverage", async () => {
  const { aggregate } = await import("../contract.mjs");
  const f = fixture();
  f.scenarios.splice(0, 1);
  const result = await row.run(f.context);
  assert.equal(result.status, aggregate(result.checks));
  assert.equal(result.status, "unvalidated");
});
