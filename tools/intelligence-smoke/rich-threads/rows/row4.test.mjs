import assert from "node:assert/strict";
import test from "node:test";
import { aggregate } from "../contract.mjs";
import {
  ContinuationUnavailable,
  fromImportedSource,
  row,
  validateSource,
  verifyContinuation,
} from "./row4.mjs";

function capture(mode = "followup") {
  const mapping = {
    intelligenceId: "imported",
    nativeId: "native-original",
    userId: "user",
    appId: "app",
    agentId: "agent",
    resourceId: "resource",
  };
  const pending = {
    id: "approval",
    callId: "approve",
    checkpointId: "checkpoint-7",
    metadata: { tasks: ["approve"] },
    answer: "yes",
    result: "approved",
  };
  const nativeItems = [
    { id: "u1", kind: "text", role: "user", payload: "Remember cobalt" },
    {
      id: "chart",
      kind: "call",
      payload: { name: "pie_chart", arguments: { values: [3, 7] } },
    },
    {
      id: "chart-result",
      kind: "result",
      callId: "chart",
      payload: { values: [3, 7] },
    },
  ];
  if (mode !== "followup")
    nativeItems.push({
      id: "approve",
      kind: "call",
      payload: { name: "approve", arguments: { amount: 10 } },
    });
  const source = {
    id: "source",
    provenance: "controlled unit fixture, not integration evidence",
    absentBeforeImport: true,
    importEvidence: "cli.json",
    nativeValidationEvidence: "native.json",
    categories: ["user-text", "assistant-text", "chart-pie"],
    nativeItems,
    mapping,
    mode,
    pending,
    prompt: "Recall the saved code and add a note",
    historyTokens: ["cobalt"],
    stateChanges: [["note"]],
  };
  const saved = {
    evidence: "durable.json",
    durable: true,
    items: structuredClone(nativeItems),
    state: { todos: [{ id: "todo-1", title: "pack" }], note: "before" },
    pending: mode === "followup" ? [] : [pending],
  };
  const before = {
    mapping,
    nativeSessionIds: [mapping.nativeId],
    native: structuredClone(saved),
    intelligence: structuredClone(saved),
  };
  const newItems =
    mode === "followup"
      ? [
          { id: "u2", kind: "text", role: "user", payload: source.prompt },
          {
            id: "a2",
            kind: "text",
            role: "assistant",
            payload: "Your code is cobalt; the note is saved.",
          },
        ]
      : [
          {
            id: "approve-result",
            kind: "result",
            callId: "approve",
            payload: "approved",
          },
          {
            id: "a2",
            kind: "text",
            role: "assistant",
            payload: "Approved and saved.",
          },
        ];
  const state = { ...saved.state, note: "after" };
  source.expectedState = structuredClone(state);
  source.nativeState = structuredClone(saved.state);
  const action = {
    mapping,
    runId: "run-2",
    browserEvidence: "screenshot.png",
    events: [{ type: "RUN_FINISHED", runId: "run-2" }],
    newItems,
    state,
    resumedId: pending.id,
    checkpointId: pending.checkpointId,
    answer: pending.answer,
  };
  const after = structuredClone(before);
  for (const store of ["native", "intelligence"]) {
    after[store].items.push(...structuredClone(newItems));
    after[store].state = structuredClone(state);
    after[store].pending = [];
  }
  return structuredClone({ source, before, after, action });
}

for (const mode of ["followup", "frontend-pending", "native-pending"])
  test(`${mode} keeps rich original history and identities in both stores`, () =>
    verifyContinuation(capture(mode)));

const mutations = {
  "changed Intelligence identity": (c) => {
    c.after.mapping.intelligenceId = "new";
  },
  "changed native identity": (c) => {
    c.after.mapping.nativeId = "new";
  },
  "wrong user mapping": (c) => {
    c.after.mapping.userId = "other";
  },
  "new empty native session": (c) => {
    c.after.nativeSessionIds.push("empty");
  },
  "lost native history": (c) => {
    c.after.native.items.shift();
  },
  "reordered imported history": (c) => {
    c.after.intelligence.items.reverse();
  },
  "mutated old rich payload": (c) => {
    c.after.intelligence.items[1].payload.arguments.values = [8];
  },
  "lost old todo state": (c) => {
    c.after.native.state.todos = [];
  },
  "lost emitted assistant": (c) => {
    c.after.native.items.pop();
  },
  "wrong answer despite HTTP success": (c) => {
    c.action.newItems[1].payload = "Hello";
  },
  "RUN_ERROR despite finished event": (c) => {
    c.action.events.unshift({ type: "RUN_ERROR" });
  },
  "missing successful terminal": (c) => {
    c.action.events = [];
  },
  "wrong browser thread": (c) => {
    c.action.mapping.intelligenceId = "other";
  },
  "text only source": (c) => {
    c.source.categories = ["user-text", "assistant-text"];
  },
  "orphan native call": (c) => {
    c.source.nativeItems.pop();
  },
  "orphan native result": (c) => {
    c.source.nativeItems[2].callId = "unknown";
  },
  "duplicate native result": (c) => {
    c.source.nativeItems.push(c.source.nativeItems[2]);
  },
  "fabricated answer dependency": (c) => {
    c.source.historyTokens = ["not-in-history"];
  },
  "answer disclosed by prompt": (c) => {
    c.source.prompt += " cobalt";
  },
  "no browser evidence": (c) => {
    c.action.browserEvidence = "";
  },
  "memory store": (c) => {
    c.before.native.durable = false;
  },
  "root state overwrite permission": (c) => {
    c.source.stateChanges = [[]];
  },
};
for (const [name, mutate] of Object.entries(mutations))
  test(`rejects ${name}`, () => {
    const c = capture();
    mutate(c);
    assert.throws(() => verifyContinuation(c));
  });
for (const mode of ["frontend-pending", "native-pending"]) {
  for (const [name, mutate] of Object.entries({
    "wrong control": (c) => {
      c.action.resumedId = "other";
    },
    "wrong checkpoint": (c) => {
      c.action.checkpointId = "other";
    },
    "pending remains": (c) => {
      c.after.native.pending = [c.source.pending];
    },
    "missing original pending": (c) => {
      c.before.intelligence.pending = [];
    },
    "unpaired result": (c) => {
      c.action.newItems[0].callId = "other";
    },
    "wrong resumed result": (c) => {
      c.action.newItems[0].payload = "rejected";
    },
    "wrong answer": (c) => {
      c.action.answer = "no";
    },
    "missing checkpoint metadata": (c) => {
      c.source.pending.metadata = {};
    },
  }))
    test(`${mode} rejects ${name}`, () => {
      const c = capture(mode);
      mutate(c);
      assert.throws(() => verifyContinuation(c));
    });
}

function context(captures) {
  let active;
  let after = false;
  const artifacts = new Map();
  return {
    framework: "mastra",
    baseline: { source: "unit" },
    fixture: {},
    artifacts,
    writeArtifact: async (name, value) =>
      artifacts.set(name, structuredClone(value)),
    services: {
      continuation: {
        sources: async () => captures.map((c) => c.source),
        read: async (source) => {
          active = captures.find((c) => c.source.id === source.id);
          return after ? active.after : active.before;
        },
        open: async () => {},
        followup: async () => {
          after = true;
          return active.action;
        },
        resume: async () => {
          after = true;
          return active.action;
        },
      },
    },
  };
}
test("partial rich source stays unvalidated and retains before/action/after evidence", async () => {
  const ctx = context([capture()]);
  const report = await row.run(ctx);
  assert.equal(report.status, "unvalidated");
  assert.equal(report.checks[0].status, "passed");
  assert.ok(
    report.limitations.includes("Unvalidated applicable category: audio:data"),
  );
  assert.equal(ctx.artifacts.size, 4);
});
test("malformed source is not blamed on import or continued", async () => {
  const c = capture();
  c.source.nativeItems.pop();
  const ctx = context([c]);
  const report = await row.run(ctx);
  assert.equal(report.status, "unvalidated");
  assert.match(report.checks[0].detail, /Malformed\/native-source limitation/);
  assert.equal(ctx.artifacts.size, 1);
});
test("failure retains all snapshots and fails row", async () => {
  const c = capture();
  c.after.native.items.pop();
  const ctx = context([c]);
  assert.equal((await row.run(ctx)).status, "failed");
  assert.equal(ctx.artifacts.size, 5);
});
test("missing fixture is blocked", async () =>
  assert.equal((await row.run({ services: {} })).status, "blocked"));
test("row3 source contract rejects changed import before row4 starts", () => {
  const c = capture();
  const nativeIdentity = { threadId: "native-original", agentId: "agent" };
  const expected = {
    items: c.source.nativeItems,
    state: c.before.native.state,
    pending: [],
  };
  const source = {
    id: "source",
    provenance: {
      description: "controlled",
      nativeOnly: true,
      durable: true,
      completeCheckpoint: true,
    },
    nativeIdentity,
    coverage: ["user-text", "assistant-text", "chart-pie"],
    expected,
  };
  const native = {
    identity: nativeIdentity,
    rawCheckpoint: { all: "fields" },
    ...expected,
  };
  const imported = { threadId: "imported", nativeIdentity, ...expected };
  const plan = {
    mode: "followup",
    absentBeforeImport: true,
    importEvidence: "cli.json",
    nativeValidationEvidence: "source.json",
  };
  validateSource(fromImportedSource(source, native, imported, plan));
  assert.throws(() =>
    fromImportedSource(source, native, { ...imported, state: {} }, plan),
  );
});

test("setup failure remains blocked with diagnostic evidence", async () => {
  const ctx = context([capture()]);
  ctx.services.continuation.read = async () => {
    throw new ContinuationUnavailable(
      "setup",
      "Owned database connection refused",
    );
  };
  const report = await row.run(ctx);
  assert.equal(report.status, "blocked");
  assert.equal(report.checks[0].status, "blocked");
  assert.equal(ctx.artifacts.get("error-0.json").category, "setup");
});
test("a generic network-looking assertion failure cannot silently become setup", async () => {
  const ctx = context([capture()]);
  ctx.services.continuation.read = async () => {
    throw new Error("connection metadata missing");
  };
  assert.equal((await row.run(ctx)).status, "failed");
});

test("changing an allowed state path still must match the requested outcome", () => {
  const c = capture();
  c.action.state.note = "wrong";
  c.after.native.state.note = "wrong";
  c.after.intelligence.state.note = "wrong";
  assert.throws(() => verifyContinuation(c), /requested outcome/);
});

test("verified title-generation traffic is not a replacement conversation", () => {
  const c = capture();
  c.after.nativeSessionIds.push("title-1");
  c.after.auxiliarySessions = [
    {
      id: "title-1",
      purpose: "title-generation",
      parentNativeId: c.source.mapping.nativeId,
      evidence: "native-title.json",
      items: [{ role: "assistant", content: "Chart discussion" }],
    },
  ];
  verifyContinuation(c);
  c.after.auxiliarySessions[0].items = [];
  assert.throws(() => verifyContinuation(c), /empty native session/);
});

test("matching empty before states cannot conceal loss from the original source", () => {
  const c = capture();
  c.before.native.state = {};
  c.before.intelligence.state = {};
  assert.throws(() => verifyContinuation(c), /Original native state/);
});

test("partial and absent continuation services agree with runner aggregation", async () => {
  for (const ctx of [context([capture()]), { services: {} }]) {
    const report = await row.run(ctx);
    assert.equal(aggregate(report.checks), report.status);
  }
});
test("coverage requires a new tool result and requested state mutation", async () => {
  const c = capture();
  c.source.stateChanges = [];
  c.action.state = structuredClone(c.before.native.state);
  c.after.native.state = structuredClone(c.action.state);
  c.after.intelligence.state = structuredClone(c.action.state);
  const report = await row.run(context([c]));
  assert.ok(
    report.checks.some(
      (check) =>
        check.detail === "No requested state update verified in both stores",
    ),
  );
  assert.ok(
    report.checks.some(
      (check) => check.detail === "No new tool result verified in both stores",
    ),
  );
});
