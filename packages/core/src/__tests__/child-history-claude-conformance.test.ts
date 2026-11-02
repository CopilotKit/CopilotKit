import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  Message,
  MessagesSnapshotEvent,
  RunAgentInput,
  RunStartedEvent,
} from "@ag-ui/client";
import { from } from "rxjs";
import { CopilotKitCore } from "../core";

// Events emitted by the published live emitter for a scripted Claude SDK
// delegation stream (root Task call → subagent text, WebSearch call and result
// → delegation result → root answer). They are recorded output, not hand-written
// shapes; see `source` in the fixture.
const fixture = JSON.parse(
  readFileSync(
    join(__dirname, "fixtures", "claude-agent-sdk-child-events.json"),
    "utf8",
  ),
) as { source: string; scenarios: { delegation: BaseEvent[] } };
const recorded = fixture.scenarios.delegation;
const runStarted = recorded[0] as RunStartedEvent & { input: RunAgentInput };
const rootSnapshot = recorded.find(
  (e) => e.type === EventType.MESSAGES_SNAPSHOT,
) as MessagesSnapshotEvent;
const DELEGATION = "toolu_task_1";

class RecordedClaudeAgent extends AbstractAgent {
  events: BaseEvent[] = [];
  constructor() {
    super({
      agentId: "claude",
      threadId: runStarted.threadId,
      initialMessages: structuredClone(runStarted.input.messages),
    });
  }
  run() {
    return from(structuredClone(this.events));
  }
}

// The import loader persists the saved child tree right after the first
// RUN_STARTED. Here it only establishes ownership of the recorded delegation.
const importedOwner: BaseEvent = {
  type: EventType.CUSTOM,
  name: "cpki.child_histories",
  value: {
    version: 1,
    histories: [
      {
        namespace: ["agent-1"],
        name: "general-purpose",
        parentToolCallIds: [DELEGATION],
        runs: [],
      },
    ],
  },
} as BaseEvent;

const byId = (messages: readonly Message[]) =>
  [...messages].sort((a, b) => a.id.localeCompare(b.id));

/** Root messages the plain AG-UI client builds from the recorded stream alone. */
async function emitterRootMessages() {
  const bare = new RecordedClaudeAgent();
  bare.events = recorded;
  await bare.runAgent({ runId: runStarted.runId });
  return bare.messages;
}

function setup(events: BaseEvent[]) {
  const agent = new RecordedClaudeAgent();
  agent.events = events;
  const core = new CopilotKitCore({});
  core.setAgents__unsafe_dev_only({ [agent.agentId!]: agent });
  const current = () => core.ɵchildHistories.get(agent, agent.threadId);
  const play = () => agent.runAgent({ runId: runStarted.runId });
  return { agent, current, play };
}

it("merges the real emitter's child stream into the owning history without touching root messages", async () => {
  const { agent, current, play } = setup([
    recorded[0]!,
    importedOwner,
    ...recorded.slice(1),
  ]);
  await play();

  // Root model input is exactly what the emitter itself streamed: the same
  // messages as its MESSAGES_SNAPSHOT, in the order the AG-UI client keeps.
  expect(agent.messages).toEqual(await emitterRootMessages());
  expect(byId(agent.messages)).toEqual(byId(rootSnapshot.messages));

  const snapshot = current();
  expect(snapshot.error).toBeUndefined();
  expect(snapshot.histories).toHaveLength(1);
  const child = snapshot.histories[0]!;
  expect(child.namespace).toEqual(["agent-1"]);
  expect(child.parentToolCallIds).toEqual([DELEGATION]);
  expect(child.messages).toHaveLength(3);
  // Text and tool_use records sharing msg_child_1 combine into one message.
  expect(child.messages).toEqual(
    expect.arrayContaining([
      {
        id: "msg_child_1",
        role: "assistant",
        content: "Searching for flights.",
        toolCalls: [
          {
            id: "toolu_search_1",
            type: "function",
            function: {
              name: "WebSearch",
              arguments: JSON.stringify({ query: "flights to Lisbon" }),
            },
          },
        ],
      },
      {
        id: "msg_child_2",
        role: "assistant",
        content: "Best option: TAP 09:40 for 312 EUR.",
      },
      {
        id: "toolu_search_1-result",
        role: "tool",
        toolCallId: "toolu_search_1",
        content: "TAP 09:40, 312 EUR",
      },
    ]),
  );
  // The root delegation result (parent_tool_use_id: null) stays in the root.
  expect(
    child.messages.some(
      (m) => m.role === "tool" && m.toolCallId === DELEGATION,
    ),
  ).toBe(false);

  // Child call names match the emitter's own (MCP-prefix-stripped) root names.
  const rootCalls = new Map(
    rootSnapshot.messages.flatMap((m) =>
      m.role === "assistant"
        ? (m.toolCalls ?? []).map((c) => [c.id, c.function.name] as const)
        : [],
    ),
  );
  for (const m of child.messages)
    if (m.role === "assistant")
      for (const call of m.toolCalls ?? [])
        expect(call.function.name).toBe(rootCalls.get(call.id));

  // Every mirrored child message the emitter put in the root stream is
  // recorded for suppression, and nothing else is.
  expect([...child.rootMessageIds].sort()).toEqual([
    "msg_child_1",
    "msg_child_2",
  ]);
  for (const id of child.rootMessageIds)
    expect(
      agent.messages.find(
        (m: Message) => m.id === id && m.role === "assistant",
      ),
    ).toBeDefined();
});

it("is idempotent when the recorded run is replayed again", async () => {
  const { current, play } = setup([
    recorded[0]!,
    importedOwner,
    ...recorded.slice(1),
  ]);
  await play();
  const first = structuredClone(current().histories);
  await play();
  expect(current().histories).toEqual(first);
});

it("shows no child region for a live-only stream, because nothing owns the delegation", async () => {
  // @ag-ui/claude-agent-sdk@0.0.8 emits no `claude-sdk-native-child`
  // interrupts, so without an imported snapshot no history ever owns the
  // delegation. The child stays visible only through the emitter's root mirror.
  const { agent, current, play } = setup(recorded);
  await play();
  expect(current().histories).toEqual([]);
  expect(agent.messages).toEqual(await emitterRootMessages());
});
