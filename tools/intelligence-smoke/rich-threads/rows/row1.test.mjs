import test from "node:test";
import assert from "node:assert/strict";
import { comparePersistence, verifyJourney, row } from "./row1.mjs";

const capture = () => ({
  threadId: "thread-1",
  userId: "user-1",
  agentId: "agent-1",
  runIds: ["run-1"],
  events: [
    { type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" },
    {
      type: "TOOL_CALL_START",
      toolCallId: "query-1",
      toolCallName: "query_data",
    },
    {
      type: "TOOL_CALL_ARGS",
      toolCallId: "query-1",
      delta: '{"metric":"revenue"}',
    },
    {
      type: "TOOL_CALL_RESULT",
      toolCallId: "query-1",
      content: '{"revenue":42}',
    },
    { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1" },
  ],
  messages: [
    { id: "user-1", role: "user", content: "Fetch revenue" },
    {
      id: "assistant-1",
      role: "assistant",
      toolCalls: [
        { id: "query-1", name: "query_data", args: '{"metric":"revenue"}' },
      ],
    },
    {
      id: "result-1",
      role: "tool",
      toolCallId: "query-1",
      content: '{"revenue":42}',
    },
    { id: "reply-1", role: "assistant", content: "Revenue is 42." },
  ],
  state: { observation: "original" },
  pending: [],
});

test("exact bounded envelope and completed tool journey pass", () => {
  const source = capture();
  assert.equal(comparePersistence(source, structuredClone(source)).events, 5);
  assert.deepEqual(verifyJourney(source), { toolCallIds: ["query-1"] });
});
for (const [name, mutate] of [
  ["missing event", (s) => s.events.splice(2, 1)],
  ["duplicate occurrence", (s) => s.events.push(s.events[2])],
  ["reordered events", (s) => s.events.reverse()],
  ["altered result", (s) => (s.events[3].content = "{}")],
  ["cross-call association", (s) => (s.messages[2].toolCallId = "other-call")],
  ["missing message", (s) => s.messages.shift()],
  ["changed arguments", (s) => (s.messages[1].toolCalls[0].args = "{}")],
  ["lost state field", (s) => delete s.state.observation],
  ["invented pending item", (s) => s.pending.push({ id: "other" })],
  ["wrong thread", (s) => (s.threadId = "other-thread")],
  ["wrong run order", (s) => s.runIds.unshift("other-run")],
])
  test(`detects ${name}`, () => {
    const source = capture(),
      saved = structuredClone(source);
    mutate(saved);
    assert.throws(() => comparePersistence(source, saved));
  });
for (const [name, mutate] of [
  ["model error", (s) => s.events.push({ type: "RUN_ERROR" })],
  ["unfinished run", (s) => s.events.pop()],
  ["missing user", (s) => s.messages.shift()],
  ["missing query", (s) => (s.messages[1].toolCalls = [])],
  ["wrong result association", (s) => (s.messages[2].toolCallId = "other")],
  ["missing reply", (s) => s.messages.pop()],
])
  test(`rejects ${name} even when faithfully persisted`, () => {
    const source = capture();
    mutate(source);
    comparePersistence(source, structuredClone(source));
    assert.throws(() => verifyJourney(source));
  });
test("empty input never establishes fidelity", () => {
  const source = capture();
  source.events = [];
  assert.throws(
    () => comparePersistence(source, structuredClone(source)),
    /No emitted events/,
  );
});
const fixture = { row1: { scenarios: [{ id: "text-query-data" }] } };
test("unavailable browser/runtime is a setup blocker", async () => {
  const result = await row.run({
    fixture,
    services: {
      row1: {
        runFresh: async () => {
          throw Error("ECONNREFUSED");
        },
        readSaved: async () => {
          throw Error("must not read");
        },
      },
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.checks[0].layer, "environment");
});
test("independent reader cannot mutate source to hide corruption", async () => {
  const result = await row.run({
    fixture,
    writeArtifact: async (name) => name,
    services: {
      row1: {
        runFresh: async () => ({ emitted: capture() }),
        readSaved: async (emitted) => {
          emitted.events.splice(2, 1);
          return emitted;
        },
      },
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.checks[0].layer, "intelligence-persistence");
});
