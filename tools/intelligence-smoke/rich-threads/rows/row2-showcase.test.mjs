import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  readMastraStore,
  readStrandsStore,
  createNativeReader,
} from "../row2/showcase-store.mjs";
import {
  nativeInventory,
  inventoryObservations,
} from "../row2/showcase-content.mjs";
import { compareCapture } from "../row2/assertions.mjs";
import { frameworkSource } from "../row2/framework-source.mjs";
import { nativeInterruptObservations } from "../row2/tool-controls.mjs";
import { createServices } from "../row2/services.mjs";

async function ownedDirectory(t) {
  const root = await mkdtemp(join(tmpdir(), "row2-showcase-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("Mastra reads separate workflow DB and resource memory without exporting other runs", async (t) => {
  const root = await ownedDirectory(t);
  const location = join(root, "memory.db"),
    workflowLocation = join(root, "workflow.db");
  const identity = {
    location,
    workflowLocation,
    threadId: "fresh",
    resourceId: "owner",
    runIds: ["run1"],
  };
  const before = await readMastraStore(identity);
  assert.deepEqual(before.records, {
    messages: [],
    threads: [],
    resources: [],
    checkpoints: [],
  });
  const memory = new DatabaseSync(location);
  memory.exec(
    "CREATE TABLE mastra_messages (id TEXT, thread_id TEXT, content TEXT, createdAt TEXT); CREATE TABLE mastra_resources (id TEXT, workingMemory TEXT)",
  );
  memory
    .prepare("INSERT INTO mastra_messages VALUES (?,?,?,?)")
    .run(
      "m1",
      "fresh",
      JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
      "2026",
    );
  memory
    .prepare("INSERT INTO mastra_resources VALUES (?,?)")
    .run("owner", '{"notes":["retained"]}');
  memory.close();
  const workflows = new DatabaseSync(workflowLocation);
  workflows.exec(
    "CREATE TABLE mastra_workflow_snapshot (run_id TEXT, resourceId TEXT, snapshot BLOB)",
  );
  const insert = workflows.prepare(
    "INSERT INTO mastra_workflow_snapshot VALUES (?,?,jsonb(?))",
  );
  insert.run(
    "run1",
    null,
    '{"status":"suspended","context":{"payload":{"topic":"meeting"}}}',
  );
  insert.run("unrelated", "someone-else", '{"private":"must not export"}');
  workflows.close();
  const after = await readMastraStore(identity);
  assert.equal(after.records.messages[0].content.parts[0].text, "hello");
  assert.equal(after.records.checkpoints.length, 1);
  assert.equal(after.records.checkpoints[0].snapshot.status, "suspended");
  assert.deepEqual(nativeInventory("mastra", after).states[0].value, {
    notes: ["retained"],
  });
  await assert.rejects(
    readMastraStore({ ...identity, workflowLocation: ":memory:" }),
    /durable/,
  );
  assert.throws(() => createNativeReader("adk", {}), /not implemented/);
});

test("Strands reads whole owned envelope, sidecars and pending execution, rejects path escape", async (t) => {
  const root = await ownedDirectory(t);
  const identity = { location: root, threadId: "fresh", agentId: "agent" };
  assert.deepEqual((await readStrandsStore(identity)).records, {});
  const directory = join(root, "fresh/scopes/agent/agent/snapshots");
  await mkdir(directory, { recursive: true });
  const envelope = {
    data: {
      messages: [
        {
          role: "user",
          content: [
            { image: { format: "png", source: { bytes: "aGVsbG8=" } } },
          ],
          metadata: {
            custom: {
              "ag-ui": {
                attachments: [
                  { index: 0, type: "image", filename: "original.png" },
                ],
              },
            },
          },
        },
      ],
      interrupts: {
        activated: true,
        pendingToolExecution: {
          assistantMessageData: {
            role: "assistant",
            content: [
              {
                toolUse: {
                  toolUseId: "c1",
                  name: "approve",
                  input: { amount: 37 },
                },
              },
            ],
          },
        },
      },
    },
    appData: { notes: ["saved"] },
  };
  await writeFile(
    join(directory, "snapshot_latest.json"),
    JSON.stringify(envelope),
  );
  const snapshot = await readStrandsStore(identity);
  assert.deepEqual(Object.values(snapshot.records), [envelope]);
  const inventory = nativeInventory("strands-typescript", snapshot);
  assert.equal(inventory.items[0].value.filename, "original.png");
  assert.equal(inventory.items[1].value.id, "c1");
  assert.deepEqual(inventory.states[0].value, { notes: ["saved"] });
  await assert.rejects(
    readStrandsStore({ ...identity, threadId: "../other" }),
    /identifier/,
  );
});

function richCapture() {
  const messages = [
    { role: "user", content: "draw chart" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "c1",
          function: { name: "pie_chart", arguments: '{"values":[3,7]}' },
        },
      ],
    },
    { role: "tool", toolCallId: "c1", content: '{"chart":{"values":[3,7]}}' },
  ];
  const snapshot = {
    kind: "sqlite",
    location: "/owned/memory.db",
    records: {
      messages: [
        {
          role: "user",
          content: { parts: [{ type: "text", text: "draw chart" }] },
        },
        {
          role: "assistant",
          content: {
            parts: [
              {
                type: "tool-invocation",
                toolInvocation: {
                  toolCallId: "c1",
                  toolName: "pie_chart",
                  args: { values: [3, 7] },
                  result: { chart: { values: [3, 7] } },
                },
              },
            ],
          },
        },
      ],
    },
  };
  return { messages, snapshot };
}
function inspect(value) {
  const result = inventoryObservations({
    framework: "mastra",
    snapshot: value.snapshot,
    messages: value.messages,
    scenarioId: "charts",
    witnesses: [{ category: "chart-pie", pointer: "/messages/1" }],
  });
  return compareCapture({
    identity: { threadId: "fresh" },
    before: { records: {} },
    after: {
      ...value.snapshot,
      records: { ...value.snapshot.records, inspection: result.projection },
    },
    observations: result.observations,
    provenance: {
      input: "input.json",
      events: "events.json",
      fixture: "showcase",
    },
  });
}

test("rich tool comparisons detect dropped/changed/duplicated calls and do not certify unwitnessed controls", () => {
  assert.ok(inspect(richCapture()).every((check) => check.status === "passed"));
  for (const mutate of [
    (value) => {
      value.snapshot.records.messages[1].content.parts[0].toolInvocation.args.values.reverse();
    },
    (value) => {
      delete value.snapshot.records.messages[1].content.parts[0].toolInvocation
        .result;
    },
    (value) => {
      value.snapshot.records.messages.push(
        structuredClone(value.snapshot.records.messages[1]),
      );
    },
  ]) {
    const value = richCapture();
    mutate(value);
    assert.ok(inspect(value).some((check) => check.status === "failed"));
  }
  const value = richCapture();
  const result = inventoryObservations({
    ...value,
    framework: "mastra",
    scenarioId: "missing",
    witnesses: [
      { category: "frontend-pending", pointer: "/messages/0" },
      { category: "reasoning", pointer: "/messages/0" },
    ],
  });
  assert.equal(result.observations.length, 1);
});

test("framework boundary reconstruction preserves rich calls, result IDs and state deltas across resumed inputs", () => {
  const input = {
    threadId: "fresh",
    runId: "r1",
    state: { notes: [] },
    messages: [{ id: "u1", role: "user", content: "chart" }],
  };
  const events = [
    {
      type: "TOOL_CALL_START",
      toolCallId: "c1",
      toolCallName: "pie_chart",
      parentMessageId: "a1",
    },
    { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '{"values":' },
    { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: "[3,7]}" },
    {
      type: "STATE_DELTA",
      delta: [{ op: "add", path: "/notes/-", value: "retained" }],
    },
  ];
  const first = frameworkSource([{ input, events }]);
  const resumed = frameworkSource([
    { input, events },
    {
      input: {
        ...input,
        runId: "r2",
        state: first.state,
        messages: [
          ...first.messages,
          {
            id: "result",
            role: "tool",
            toolCallId: "c1",
            content: '{"rendered":true}',
          },
        ],
      },
      events: [
        { type: "TEXT_MESSAGE_START", messageId: "a2", role: "assistant" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "a2", delta: "Done" },
      ],
    },
  ]);
  assert.deepEqual(
    resumed.messages.map((message) => message.id),
    ["u1", "a1", "result", "a2"],
  );
  assert.equal(
    resumed.messages[1].toolCalls[0].function.arguments,
    '{"values":[3,7]}',
  );
  assert.deepEqual(resumed.state, { notes: ["retained"] });
  assert.deepEqual(input.state, { notes: [] });
  assert.throws(
    () => frameworkSource([{ input, events: [...events, events[0]] }]),
    /Duplicate/,
  );
  assert.throws(
    () =>
      frameworkSource([
        {
          input,
          events: [
            {
              type: "STATE_DELTA",
              delta: [{ op: "add", path: "/__proto__/bad", value: true }],
            },
          ],
        },
      ]),
    /Unsafe/,
  );
});

test("Mastra suspend and requireApproval inspect different native payloads and detect changed resume metadata", () => {
  for (const approval of [false, true]) {
    const payload = approval
      ? {
          type: "mastra_tool_approval",
          toolName: "approve",
          args: { amount: 37 },
        }
      : {
          type: "mastra_tool_suspend",
          toolName: "schedule",
          suspendPayload: {
            topic: "review",
            slots: [{ label: "Tomorrow", iso: "2027-01-01" }],
          },
        };
    const suspension = approval
      ? {
          requireToolApproval: {
            toolCallId: "c1",
            toolName: payload.toolName,
            args: payload.args,
          },
        }
      : {
          toolCallId: "c1",
          toolName: payload.toolName,
          toolCallSuspended: payload.suspendPayload,
        };
    const snapshot = {
      kind: "sqlite",
      location: "/owned/workflow.db",
      records: {
        checkpoints: [
          {
            run_id: "r1",
            snapshot: {
              status: "suspended",
              context: { executionWorkflow: { suspendPayload: suspension } },
            },
          },
        ],
      },
    };
    const events = [
      {
        type: "RUN_FINISHED",
        runId: "r1",
        outcome: {
          type: "interrupt",
          interrupts: [
            { id: "i1", toolCallId: "c1", metadata: { mastra: payload } },
          ],
        },
      },
    ];
    const observations = nativeInterruptObservations({
      framework: "mastra",
      snapshot,
      events,
      category: "native-pending",
    });
    const value = {
      identity: { threadId: "fresh" },
      before: { records: {} },
      after: snapshot,
      observations,
      provenance: {
        input: "input.json",
        events: "events.json",
        fixture: "showcase",
      },
    };
    assert.ok(
      compareCapture(value).every((check) => check.status === "passed"),
    );
    snapshot.records.checkpoints[0].snapshot.context.executionWorkflow.suspendPayload =
      {};
    assert.ok(compareCapture(value).some((check) => check.status === "failed"));
  }
});

test("Showcase service reads native absence before sending and rejects an unverified lifecycle", async (t) => {
  const root = await ownedDirectory(t);
  const scope = {
    owner: "owned",
    userId: "user",
    agentId: "agent",
    native: {
      location: join(root, "native.db"),
      workflowLocation: join(root, "native.db"),
      resourceId: "user",
    },
    scenarios: [
      {
        id: "text",
        categories: ["user-text", "assistant-text"],
        steps: [{ kind: "send", prompt: "hello" }],
      },
    ],
  };
  const input = {
    threadId: "fresh",
    runId: "r1",
    messages: [{ id: "u1", role: "user", content: "hello" }],
    state: {},
  };
  let beforeRun;
  let invoked = false;
  const browser = {
    async newThread(options) {
      beforeRun = options.beforeRun;
      return { threadId: "fresh" };
    },
    async send() {
      await beforeRun(input);
      invoked = true;
      const db = new DatabaseSync(scope.native.location);
      try {
        db.exec(
          "CREATE TABLE mastra_messages (id TEXT, thread_id TEXT, content TEXT, createdAt TEXT, role TEXT)",
        );
        const insert = db.prepare(
          "INSERT INTO mastra_messages VALUES (?,?,?,?,?)",
        );
        insert.run(
          "u1",
          "fresh",
          JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
          "1",
          "user",
        );
        insert.run(
          "a1",
          "fresh",
          JSON.stringify({ parts: [{ type: "text", text: "reply" }] }),
          "2",
          "assistant",
        );
      } finally {
        db.close();
      }
    },
    async upload() {},
    async interact() {},
    async snapshot() {
      return { threadId: "fresh", screenshots: [] };
    },
  };
  const capture = {
    async read() {
      return {
        frameworkRuns: [
          {
            input,
            events: [
              {
                type: "TEXT_MESSAGE_START",
                messageId: "a1",
                role: "assistant",
              },
              { type: "TEXT_MESSAGE_CONTENT", messageId: "a1", delta: "reply" },
              { type: "RUN_FINISHED", runId: "r1" },
            ],
          },
        ],
      };
    },
  };
  const args = {
    framework: "mastra",
    scope,
    browser,
    capture,
    outputDir: join(root, "evidence"),
    environment: {
      receipt: {
        owner: "owned",
        resources: [
          { framework: "mastra", role: "native-backend", stores: [root] },
        ],
        cleanScope: { status: "unverified" },
      },
    },
  };
  await assert.rejects(createServices(args), /clean-scope/);
  args.environment.receipt.cleanScope.status = "passed";
  const { services } = await createServices(args);
  const [captured] = await services.row2.captureFresh();
  assert.equal(invoked, true);
  assert.deepEqual(captured.before.records.messages, []);
  assert.ok(
    compareCapture(captured).every((check) => check.status === "passed"),
  );
  captured.before.records.messages.push({ id: "old-thread-data" });
  assert.throws(() => compareCapture(captured), /absent/);
});
