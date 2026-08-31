/**
 * `thread.resume` echoes the originating interrupt back to the agent as
 * `forwardedProps.command.interruptEvent`.
 *
 * WHY: channels only ever sent `command = { resume }`. LangGraph needs nothing
 * more — it correlates by `thread_id` — so the gap was invisible. Other AG-UI
 * bridges correlate by ids carried IN the interrupt: `@ag-ui/mastra` gates its
 * resume on `command.interruptEvent` and needs `{toolCallId, runId}` from it. A
 * resume without it is not an error there, it is a SILENT no-op: the run proceeds
 * as an ordinary new turn and the suspended tool never completes.
 *
 * The value is treated as opaque — channels does not parse or reshape it, it just
 * hands back what the agent sent. That keeps this framework-agnostic.
 *
 * The last test is the compatibility guarantee: when no interrupt value was
 * captured, the wire shape is byte-identical to before.
 */
import type { AgentSubscriber, RunAgentParameters } from "@ag-ui/client";
import { Button } from "@copilotkit/channels-ui";
import { afterEach, expect, test } from "vitest";
import { createChannel } from "./create-channel.js";
import { MemoryStore } from "./state/memory-store.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import type { FakeAgentScriptStep } from "./testing/fake-agent.js";

const activeChannels: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(activeChannels.splice(0).map((channel) => channel.stop()));
});

/** The correlation-bearing shape a Mastra-style bridge sends and requires back. */
const MASTRA_LIKE_VALUE = {
  type: "mastra_suspend",
  toolCallId: "call_abc123",
  runId: "run_xyz789",
  suspendPayload: {
    kind: "confirm_create_thing",
    action: "Create thing: widget",
  },
};

/**
 * Records the `RunAgentParameters` of every run so the wire shape is assertable.
 *
 * `clone()` is overridden for two reasons, both enforced by createChannel's
 * clone guard: `FakeAgent.clone()` returns a base `FakeAgent` (which would strip
 * this recorder entirely), and every turn runs on a fresh clone — so `params`
 * must be SHARED, not copied, or the resume run's parameters land on an instance
 * the test never sees.
 */
class RecordingAgent extends FakeAgent {
  params: Array<RunAgentParameters | undefined>;
  private readonly script0: FakeAgentScriptStep[];

  constructor(
    script: FakeAgentScriptStep[],
    params: Array<RunAgentParameters | undefined> = [],
  ) {
    super(script);
    this.script0 = script;
    this.params = params;
  }

  override clone(): RecordingAgent {
    const cloned = new RecordingAgent(this.script0, this.params);
    cloned.threadId = this.threadId;
    cloned.agentId = this.agentId;
    return cloned;
  }

  override async runAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ) {
    this.params.push(parameters);
    return super.runAgent(parameters, subscriber);
  }
}

type Command = { resume?: unknown; interruptEvent?: unknown } | undefined;

/** The `forwardedProps.command` of the first run that carried one. */
function sentCommand(agent: RecordingAgent): Command {
  for (const p of agent.params) {
    const command = (p?.forwardedProps as { command?: Command } | undefined)
      ?.command;
    if (command) return command;
  }
  return undefined;
}

function firstActionId(adapter: FakeAdapter): string {
  const button = adapter.posted.flat().find((node) => node.type === "button");
  const action = button?.props.onClick as { id?: unknown } | undefined;
  if (typeof action?.id !== "string") throw new Error("missing action id");
  return action.id;
}

/**
 * Drives one interrupt → picker → click → resume cycle.
 * `interruptValue: undefined` emits a named custom event with NO value, which is
 * how the "nothing captured" case is reached.
 */
async function runCycle(interruptValue: unknown) {
  const adapter = new FakeAdapter();
  const state = new MemoryStore();
  // Interrupt on the FIRST run only. Clones restart the script (the shift happens
  // on the clone, not the original), so without this shared counter the resume run
  // would interrupt again — re-storing the value straight after the resume consumed
  // it, and quietly invalidating the one-use assertion below.
  const runs = { count: 0 };
  const agent = new RecordingAgent([
    (subscriber) => {
      if (runs.count++ === 0) {
        subscriber.onCustomEvent?.({
          event: { name: "approval", value: interruptValue },
        } as never);
      }
      subscriber.onRunFinishedEvent?.({ event: {} } as never);
    },
  ]);

  function Approval() {
    return (
      <Button
        value={{ approved: true }}
        onClick={async ({ thread }) => {
          await thread.resume({ approved: true });
        }}
      >
        Approve
      </Button>
    );
  }

  const channel = createChannel({
    name: "approvals",
    identifyUser: "platform",
    adapters: [adapter],
    agent,
    components: [Approval],
    store: { adapter: state },
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent();
  });
  channel.onInterrupt("approval", async ({ thread }) => {
    await thread.post(<Approval />);
  });
  await channel.ɵruntime.start();
  activeChannels.push({ stop: () => channel.ɵruntime.stop() });

  await adapter.getSink().onTurn({
    conversationKey: "thread-1",
    replyTarget: {},
    userText: "start",
    platform: "fake",
    actor: { id: "alice", kind: "human", name: "Alice" },
  });

  return { adapter, agent, state, Approval };
}

async function click(adapter: FakeAdapter): Promise<void> {
  await adapter.getSink().onInteraction({
    id: firstActionId(adapter),
    conversationKey: "thread-1",
    replyTarget: {},
    eventId: "click-1",
    actor: { id: "alice", kind: "human", name: "Alice" },
  });
}

test("resume echoes the captured interrupt value as command.interruptEvent", async () => {
  const { adapter, agent } = await runCycle(MASTRA_LIKE_VALUE);
  await click(adapter);

  const command = sentCommand(agent);
  expect(command).toBeDefined();
  expect(command?.resume).toEqual({ approved: true });
  // Opaque round-trip: byte-for-byte what the agent sent, not a reshaped subset.
  expect(command?.interruptEvent).toEqual(MASTRA_LIKE_VALUE);
});

test("the interrupt value is persisted, so a resume can survive a restart", async () => {
  const { state } = await runCycle(MASTRA_LIKE_VALUE);
  // In the DURABLE store, not process memory — the click can arrive in a later
  // process, which is the entire point of the interrupt path over awaitChoice.
  await expect(state.kv.get("interruptevent:thread-1")).resolves.toEqual(
    MASTRA_LIKE_VALUE,
  );
});

test("the retained value is one-use: consumed by the resume that sends it", async () => {
  const { adapter, state } = await runCycle(MASTRA_LIKE_VALUE);
  await click(adapter);
  // Matches the one-use continuation the resume already claims: a replayed click
  // must not resurrect a spent resume.
  await expect(
    state.kv.get("interruptevent:thread-1"),
  ).resolves.toBeUndefined();
});

test("omits interruptEvent entirely when no value was captured", async () => {
  const { adapter, agent } = await runCycle(undefined);
  await click(adapter);

  const command = sentCommand(agent);
  expect(command?.resume).toEqual({ approved: true });
  // The compatibility guarantee: not `interruptEvent: undefined` — absent. The
  // serialized command is identical to what channels sent before this change,
  // so agents that never carry correlation data see no difference at all.
  expect(command).not.toHaveProperty("interruptEvent");
  expect(Object.keys(command ?? {})).toEqual(["resume"]);
});
