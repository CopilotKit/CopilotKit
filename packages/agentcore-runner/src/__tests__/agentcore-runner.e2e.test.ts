/**
 * End-to-end integration tests for AgentCoreRunner.
 *
 * These tests wire a ScriptedAgent (mimicking the AG-UI event stream that
 * AgentCore produces — including the pathological cases the runner exists
 * to paper over) through the real InMemoryAgentRunner machinery, then assert
 * the runner's run()/connect() outputs downstream.
 *
 * If these pass, the published package behaves correctly when consumed by
 * a real CopilotRuntime + HttpAgent stack pointed at AWS AgentCore, without
 * requiring AWS, Docker, or a browser.
 */
import { describe, it, expect } from "vitest";
import { EMPTY, firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";
import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type Message,
  type MessagesSnapshotEvent,
  type RunAgentInput,
  type RunFinishedEvent,
  type RunStartedEvent,
  type ToolCallResultEvent,
} from "@ag-ui/client";
import type {
  AgentRunnerConnectRequest,
  AgentRunnerRunRequest,
} from "@copilotkit/runtime/v2";
import { AgentCoreRunner } from "..";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface ScriptedAgentCallbacks {
  onEvent: (args: { event: BaseEvent }) => void | Promise<void>;
  onRunStartedEvent?: () => void | Promise<void>;
}

class ScriptedAgent extends AbstractAgent {
  constructor(private readonly script: BaseEvent[] = []) {
    super();
  }

  async runAgent(
    input: RunAgentInput,
    callbacks: ScriptedAgentCallbacks,
  ): Promise<void> {
    const runStarted: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    };
    await callbacks.onEvent({ event: runStarted });
    await callbacks.onRunStartedEvent?.();
    for (const event of this.script) await callbacks.onEvent({ event });
    const hasRunFinished = this.script.some(
      (e) => e.type === EventType.RUN_FINISHED,
    );
    if (!hasRunFinished) {
      const runFinished: RunFinishedEvent = {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      };
      await callbacks.onEvent({ event: runFinished });
    }
  }

  clone(): AbstractAgent {
    return new ScriptedAgent([...this.script]);
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

function makeRunInput(
  threadId: string,
  runId: string,
  messages: Message[] = [],
): RunAgentInput {
  return {
    threadId,
    runId,
    parentRunId: undefined,
    state: {},
    messages,
    tools: [],
    context: [],
    forwardedProps: undefined,
  };
}

async function collect(
  obs: ReturnType<AgentCoreRunner["run"] | AgentCoreRunner["connect"]>,
): Promise<BaseEvent[]> {
  return firstValueFrom(obs.pipe(toArray()));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentCoreRunner e2e", () => {
  it("emits empty snapshot when connect() is called before any run()", async () => {
    const runner = new AgentCoreRunner();
    const request: AgentRunnerConnectRequest = { threadId: "fresh-thread" };

    const events = await collect(runner.connect(request));

    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.MESSAGES_SNAPSHOT,
      EventType.RUN_FINISHED,
    ]);
    expect((events[1] as MessagesSnapshotEvent).messages).toEqual([]);
  });

  it("passes text-only run events through unchanged", async () => {
    const runner = new AgentCoreRunner();
    const threadId = "thread-text";
    const runRequest: AgentRunnerRunRequest = {
      threadId,
      agent: new ScriptedAgent([
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: "m-1",
          role: "assistant",
        },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "m-1",
          delta: "hello",
        },
        { type: EventType.TEXT_MESSAGE_END, messageId: "m-1" },
      ] as BaseEvent[]),
      input: makeRunInput(threadId, "run-0", [
        { id: "u-1", role: "user", content: "hi" } as Message,
      ]),
    };

    const runEvents = await collect(runner.run(runRequest));

    const textContent = runEvents.find(
      (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
    );
    expect(textContent).toBeDefined();
    expect(runEvents.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("synthesises TOOL_CALL_RESULT events before replayed MESSAGES_SNAPSHOT on reconnect", async () => {
    const runner = new AgentCoreRunner();
    const threadId = "thread-replay";

    // Simulate AgentCore's memory replay: during run(), the remote emits a
    // MESSAGES_SNAPSHOT that contains assistant messages with toolCalls,
    // but *no* corresponding TOOL_CALL_RESULT events. This is the exact
    // shape the runner is designed to compensate for.
    const replayedSnapshot: MessagesSnapshotEvent = {
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [
        { id: "u-1", role: "user", content: "what is the weather?" },
        {
          id: "a-1",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tc-1",
              type: "function",
              function: { name: "getWeather", arguments: "{}" },
            },
          ],
        },
      ] as Message[],
    };

    await collect(
      runner.run({
        threadId,
        agent: new ScriptedAgent([replayedSnapshot as BaseEvent]),
        input: makeRunInput(threadId, "run-0"),
      }),
    );

    const connectEvents = await collect(runner.connect({ threadId }));

    const snapshotIndex = connectEvents.findIndex(
      (e) => e.type === EventType.MESSAGES_SNAPSHOT,
    );
    expect(snapshotIndex).toBeGreaterThan(-1);

    const toolResults = connectEvents.filter(
      (e): e is ToolCallResultEvent => e.type === EventType.TOOL_CALL_RESULT,
    );
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].toolCallId).toBe("tc-1");

    const toolResultIndex = connectEvents.findIndex(
      (e) => e.type === EventType.TOOL_CALL_RESULT,
    );
    expect(toolResultIndex).toBeLessThan(snapshotIndex);
  });

  it("does not synthesise TOOL_CALL_RESULT events for assistant messages without tool calls", async () => {
    const runner = new AgentCoreRunner();
    const threadId = "thread-no-tools";

    const replayedSnapshot: MessagesSnapshotEvent = {
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [
        { id: "u-1", role: "user", content: "hi" },
        { id: "a-1", role: "assistant", content: "hello!" },
      ] as Message[],
    };

    await collect(
      runner.run({
        threadId,
        agent: new ScriptedAgent([replayedSnapshot as BaseEvent]),
        input: makeRunInput(threadId, "run-0"),
      }),
    );

    const connectEvents = await collect(runner.connect({ threadId }));
    const toolResults = connectEvents.filter(
      (e) => e.type === EventType.TOOL_CALL_RESULT,
    );
    expect(toolResults).toEqual([]);
  });
});
