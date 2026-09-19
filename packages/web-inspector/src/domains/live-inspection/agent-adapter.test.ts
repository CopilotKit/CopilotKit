import { AbstractAgent, EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeAgentMessages,
  subscribeToAgent,
  syncAgentMessages,
  syncAgentState,
} from "./agent-adapter.js";
import { createLiveInspectionState } from "./state.js";

class TestAgent extends AbstractAgent {
  run(): never {
    throw new Error("TestAgent does not run");
  }
}

describe("live agent adapter", () => {
  it("normalizes message content and tool calls", () => {
    const messages = normalizeAgentMessages([
      {
        id: "message-1",
        role: "assistant",
        content: [{ text: "Hello " }, { text: "world" }],
        toolCalls: [
          {
            id: "call-1",
            function: { name: "lookup", arguments: '{"topic":"docs"}' },
          },
        ],
      },
      null,
    ]);

    expect(messages).toEqual([
      {
        id: "message-1",
        role: "assistant",
        contentText: "Hello world",
        contentRaw: [{ text: "Hello " }, { text: "world" }],
        toolCalls: [
          {
            id: "call-1",
            toolName: "lookup",
            status: undefined,
            function: { name: "lookup", arguments: '{"topic":"docs"}' },
          },
        ],
        toolCallId: undefined,
        activityType: undefined,
      },
    ]);
    expect(normalizeAgentMessages({})).toBeNull();
  });

  it("forwards lifecycle events through the injected recorder", async () => {
    const state = createLiveInspectionState();
    const agent = new TestAgent({ agentId: "alpha" });
    const recordEvent = vi.fn();
    subscribeToAgent(state, agent, {
      recordEvent,
      requestUpdate: vi.fn(),
      refreshTools: vi.fn(),
      refreshThreads: vi.fn(),
      canRefreshThreads: () => false,
    });
    const subscriber = agent.subscribers.at(-1);
    if (!subscriber) {
      throw new Error("The adapter did not subscribe to the agent.");
    }
    const input: RunAgentInput = {
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
    };
    const params = {
      agent,
      input,
      messages: agent.messages,
      state: agent.state,
    };
    const started = {
      type: EventType.STEP_STARTED,
      stepName: "prepare",
    } as const;
    const finished = {
      type: EventType.STEP_FINISHED,
      stepName: "prepare",
    } as const;

    await subscriber.onStepStartedEvent?.({ ...params, event: started });
    await subscriber.onStepFinishedEvent?.({ ...params, event: finished });

    expect(recordEvent.mock.calls).toEqual([
      ["alpha", "STEP_STARTED", started],
      ["alpha", "STEP_FINISHED", finished],
    ]);
  });

  it("syncs messages, thread versions, and direct state changes", () => {
    const state = createLiveInspectionState();
    const requestUpdate = vi.fn();
    const agent = new TestAgent({
      agentId: "alpha",
      threadId: "thread-1",
      initialMessages: [{ id: "message-1", role: "user", content: "Hello" }],
      initialState: { count: 1 },
    });

    syncAgentMessages(state, agent, requestUpdate);
    syncAgentState(state, agent, requestUpdate);

    expect(state.agentMessages.get("alpha")?.[0]?.contentText).toBe("Hello");
    expect(state.liveMessageVersion.get("thread-1")).toBe(1);
    expect(state.agentStates.get("alpha")).toEqual({ count: 1 });

    agent.state = { count: 2 };
    syncAgentState(state, agent, requestUpdate);
    syncAgentMessages(state, agent, requestUpdate);

    expect(state.agentStates.get("alpha")).toEqual({ count: 2 });
    expect(state.liveMessageVersion.get("thread-1")).toBe(2);
    expect(requestUpdate).toHaveBeenCalledTimes(4);
  });
});
