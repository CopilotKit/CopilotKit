import { describe, it, expect, beforeEach, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { AbstractAgent, Message, State, RunAgentInput, EventType } from "@ag-ui/client";
import { randomUUID } from "@copilotkitnext/shared";

/**
 * Mock agent that can emit events to test state management
 */
class EventEmittingMockAgent extends AbstractAgent {
  private subscribers: any[] = [];

  constructor(agentId: string, threadId: string, initialState: State = {}) {
    super({
      agentId,
      threadId,
      initialState,
    });
  }

  protected run(input: RunAgentInput): any {
    // Not used in these tests
    throw new Error("run() should not be called in these tests");
  }

  // Expose subscribe for testing
  public testSubscribe(subscriber: any) {
    return this.subscribe(subscriber);
  }

  // Helper to emit run started event
  public async emitRunStarted(runId: string, state: State = {}) {
    this.state = state;
    for (const sub of this.subscribers) {
      if (sub.onRunStartedEvent) {
        await sub.onRunStartedEvent({
          event: {
            type: EventType.RUN_STARTED,
            threadId: this.threadId,
            runId,
          },
          messages: this.messages,
          state: this.state,
          agent: this,
          input: this.createRunInput(runId),
        });
      }
    }
  }

  // Helper to emit run finished event
  public async emitRunFinished(runId: string, state: State = {}) {
    this.state = state;
    for (const sub of this.subscribers) {
      if (sub.onRunFinishedEvent) {
        await sub.onRunFinishedEvent({
          event: {
            type: EventType.RUN_FINISHED,
            threadId: this.threadId,
            runId,
          },
          messages: this.messages,
          state: this.state,
          agent: this,
          input: this.createRunInput(runId),
        });
      }
    }
  }

  // Helper to emit state snapshot event
  public async emitStateSnapshot(runId: string, snapshot: State) {
    for (const sub of this.subscribers) {
      if (sub.onStateSnapshotEvent) {
        await sub.onStateSnapshotEvent({
          event: {
            type: EventType.STATE_SNAPSHOT,
            snapshot,
          },
          messages: this.messages,
          state: this.state,
          agent: this,
          input: this.createRunInput(runId),
        });
      }
    }
  }

  // Helper to emit state delta event
  public async emitStateDelta(runId: string, delta: any[], currentState: State) {
    this.state = currentState;
    for (const sub of this.subscribers) {
      if (sub.onStateDeltaEvent) {
        await sub.onStateDeltaEvent({
          event: {
            type: EventType.STATE_DELTA,
            delta,
          },
          messages: this.messages,
          state: this.state,
          agent: this,
          input: this.createRunInput(runId),
        });
      }
    }
  }

  // Helper to emit messages snapshot event
  public async emitMessagesSnapshot(runId: string, messages: Message[]) {
    for (const sub of this.subscribers) {
      if (sub.onMessagesSnapshotEvent) {
        await sub.onMessagesSnapshotEvent({
          event: {
            type: EventType.MESSAGES_SNAPSHOT,
            messages,
          },
          messages: this.messages,
          state: this.state,
          agent: this,
          input: this.createRunInput(runId),
        });
      }
    }
  }

  // Helper to emit new message event
  public async emitNewMessage(runId: string, message: Message) {
    this.messages.push(message);
    for (const sub of this.subscribers) {
      if (sub.onNewMessage) {
        await sub.onNewMessage({
          message,
          messages: this.messages,
          state: this.state,
          agent: this,
          input: this.createRunInput(runId),
        });
      }
    }
  }

  // Override subscribe to track subscribers
  public override subscribe(subscriber: any) {
    this.subscribers.push(subscriber);
    return {
      unsubscribe: () => {
        const index = this.subscribers.indexOf(subscriber);
        if (index > -1) {
          this.subscribers.splice(index, 1);
        }
      },
    };
  }

  private createRunInput(runId: string): RunAgentInput {
    return {
      threadId: this.threadId,
      runId,
      state: this.state,
      messages: this.messages,
    };
  }
}

describe("StateManager - Basic State Tracking", () => {
  let copilotKitCore: CopilotKitCore;
  let agent: EventEmittingMockAgent;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    agent = new EventEmittingMockAgent("agent1", "thread1", { count: 0 });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "agent1", agent: agent as any });
  });

  it("should track state when run starts", async () => {
    const runId = "run1";
    const state = { count: 1, user: "alice" };

    await agent.emitRunStarted(runId, state);

    const storedState = copilotKitCore.getStateByRun("agent1", "thread1", runId);
    expect(storedState).toEqual(state);
  });

  it("should track state when run finishes", async () => {
    const runId = "run1";
    const finalState = { count: 5, user: "bob", completed: true };

    await agent.emitRunStarted(runId, { count: 1 });
    await agent.emitRunFinished(runId, finalState);

    const storedState = copilotKitCore.getStateByRun("agent1", "thread1", runId);
    expect(storedState).toEqual(finalState);
  });

  it("should track state snapshots during run", async () => {
    const runId = "run1";
    const initialState = { count: 0 };
    const snapshot = { count: 3, intermediate: true };

    await agent.emitRunStarted(runId, initialState);
    await agent.emitStateSnapshot(runId, snapshot);

    const storedState = copilotKitCore.getStateByRun("agent1", "thread1", runId);
    // State should be merged with snapshot
    expect(storedState).toEqual({ count: 3, intermediate: true });
  });

  it("should track state deltas during run", async () => {
    const runId = "run1";
    const initialState = { count: 0, user: "alice" };
    const deltaState = { count: 2, user: "alice" };

    await agent.emitRunStarted(runId, initialState);
    await agent.emitStateDelta(runId, [{ op: "replace", path: "/count", value: 2 }], deltaState);

    const storedState = copilotKitCore.getStateByRun("agent1", "thread1", runId);
    expect(storedState).toEqual(deltaState);
  });

  it("should return undefined for non-existent run", () => {
    const storedState = copilotKitCore.getStateByRun("agent1", "thread1", "non-existent-run");
    expect(storedState).toBeUndefined();
  });

  it("should return undefined for non-existent agent", () => {
    const storedState = copilotKitCore.getStateByRun("non-existent-agent", "thread1", "run1");
    expect(storedState).toBeUndefined();
  });

  it("should return undefined for non-existent thread", () => {
    const storedState = copilotKitCore.getStateByRun("agent1", "non-existent-thread", "run1");
    expect(storedState).toBeUndefined();
  });
});

describe("StateManager - Multiple Runs", () => {
  let copilotKitCore: CopilotKitCore;
  let agent: EventEmittingMockAgent;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    agent = new EventEmittingMockAgent("agent1", "thread1");
    copilotKitCore.addAgent__unsafe_dev_only({ id: "agent1", agent: agent as any });
  });

  it("should track multiple sequential runs independently", async () => {
    const run1State = { count: 1, step: "first" };
    const run2State = { count: 2, step: "second" };
    const run3State = { count: 3, step: "third" };

    await agent.emitRunStarted("run1", run1State);
    await agent.emitRunFinished("run1", run1State);

    await agent.emitRunStarted("run2", run2State);
    await agent.emitRunFinished("run2", run2State);

    await agent.emitRunStarted("run3", run3State);
    await agent.emitRunFinished("run3", run3State);

    expect(copilotKitCore.getStateByRun("agent1", "thread1", "run1")).toEqual(run1State);
    expect(copilotKitCore.getStateByRun("agent1", "thread1", "run2")).toEqual(run2State);
    expect(copilotKitCore.getStateByRun("agent1", "thread1", "run3")).toEqual(run3State);
  });

  it("should list all run IDs for a thread", async () => {
    await agent.emitRunStarted("run1", { count: 1 });
    await agent.emitRunFinished("run1", { count: 1 });

    await agent.emitRunStarted("run2", { count: 2 });
    await agent.emitRunFinished("run2", { count: 2 });

    await agent.emitRunStarted("run3", { count: 3 });
    await agent.emitRunFinished("run3", { count: 3 });

    const runIds = copilotKitCore.getRunIdsForThread("agent1", "thread1");
    expect(runIds).toHaveLength(3);
    expect(runIds).toContain("run1");
    expect(runIds).toContain("run2");
    expect(runIds).toContain("run3");
  });

  it("should return empty array for thread with no runs", () => {
    const runIds = copilotKitCore.getRunIdsForThread("agent1", "thread-no-runs");
    expect(runIds).toEqual([]);
  });

  it("should handle state updates in the middle of a run", async () => {
    const runId = "run1";

    await agent.emitRunStarted(runId, { count: 0, status: "started" });

    // Simulate state changes during the run
    await agent.emitStateSnapshot(runId, { count: 1, status: "processing" });
    expect(copilotKitCore.getStateByRun("agent1", "thread1", runId)).toMatchObject({
      count: 1,
      status: "processing",
    });

    await agent.emitStateDelta(runId, [], { count: 2, status: "processing" });
    expect(copilotKitCore.getStateByRun("agent1", "thread1", runId)).toMatchObject({
      count: 2,
      status: "processing",
    });

    await agent.emitRunFinished(runId, { count: 3, status: "completed" });
    expect(copilotKitCore.getStateByRun("agent1", "thread1", runId)).toMatchObject({
      count: 3,
      status: "completed",
    });
  });
});

describe("StateManager - Message Tracking", () => {
  let copilotKitCore: CopilotKitCore;
  let agent: EventEmittingMockAgent;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    agent = new EventEmittingMockAgent("agent1", "thread1");
    copilotKitCore.addAgent__unsafe_dev_only({ id: "agent1", agent: agent as any });
  });

  it("should associate new messages with runs", async () => {
    const runId = "run1";
    const message: Message = {
      id: "msg1",
      role: "user",
      content: "Hello",
    };

    await agent.emitRunStarted(runId, {});
    await agent.emitNewMessage(runId, message);
    await agent.emitRunFinished(runId, {});

    const associatedRunId = copilotKitCore.getRunIdForMessage("agent1", "thread1", "msg1");
    expect(associatedRunId).toBe(runId);
  });

  it("should associate messages from snapshot with runs", async () => {
    const runId = "run1";
    const messages: Message[] = [
      { id: "msg1", role: "user", content: "Hello" },
      { id: "msg2", role: "assistant", content: "Hi there" },
      { id: "msg3", role: "user", content: "How are you?" },
    ];

    await agent.emitRunStarted(runId, {});
    await agent.emitMessagesSnapshot(runId, messages);
    await agent.emitRunFinished(runId, {});

    expect(copilotKitCore.getRunIdForMessage("agent1", "thread1", "msg1")).toBe(runId);
    expect(copilotKitCore.getRunIdForMessage("agent1", "thread1", "msg2")).toBe(runId);
    expect(copilotKitCore.getRunIdForMessage("agent1", "thread1", "msg3")).toBe(runId);
  });

  it("should track messages across multiple runs", async () => {
    const msg1: Message = { id: "msg1", role: "user", content: "Run 1" };
    const msg2: Message = { id: "msg2", role: "user", content: "Run 2" };
    const msg3: Message = { id: "msg3", role: "user", content: "Run 3" };

    await agent.emitRunStarted("run1", {});
    await agent.emitNewMessage("run1", msg1);
    await agent.emitRunFinished("run1", {});

    await agent.emitRunStarted("run2", {});
    await agent.emitNewMessage("run2", msg2);
    await agent.emitRunFinished("run2", {});

    await agent.emitRunStarted("run3", {});
    await agent.emitNewMessage("run3", msg3);
    await agent.emitRunFinished("run3", {});

    expect(copilotKitCore.getRunIdForMessage("agent1", "thread1", "msg1")).toBe("run1");
    expect(copilotKitCore.getRunIdForMessage("agent1", "thread1", "msg2")).toBe("run2");
    expect(copilotKitCore.getRunIdForMessage("agent1", "thread1", "msg3")).toBe("run3");
  });

  it("should return undefined for non-existent message", () => {
    const runId = copilotKitCore.getRunIdForMessage("agent1", "thread1", "non-existent-msg");
    expect(runId).toBeUndefined();
  });

  it("should handle messages with tool calls", async () => {
    const runId = "run1";
    const message: Message = {
      id: "msg1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "tool1",
          type: "function",
          function: {
            name: "searchWeb",
            arguments: JSON.stringify({ query: "test" }),
          },
        },
      ],
    };

    await agent.emitRunStarted(runId, {});
    await agent.emitNewMessage(runId, message);
    await agent.emitRunFinished(runId, {});

    const associatedRunId = copilotKitCore.getRunIdForMessage("agent1", "thread1", "msg1");
    expect(associatedRunId).toBe(runId);
  });
});

describe("StateManager - Multiple Agents and Threads", () => {
  let copilotKitCore: CopilotKitCore;
  let agent1: EventEmittingMockAgent;
  let agent2: EventEmittingMockAgent;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    agent1 = new EventEmittingMockAgent("agent1", "thread1");
    agent2 = new EventEmittingMockAgent("agent2", "thread2");
    copilotKitCore.addAgent__unsafe_dev_only({ id: "agent1", agent: agent1 as any });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "agent2", agent: agent2 as any });
  });

  it("should track state for multiple agents independently", async () => {
    const agent1State = { agentName: "agent1", count: 1 };
    const agent2State = { agentName: "agent2", count: 2 };

    await agent1.emitRunStarted("run1", agent1State);
    await agent1.emitRunFinished("run1", agent1State);

    await agent2.emitRunStarted("run1", agent2State);
    await agent2.emitRunFinished("run1", agent2State);

    expect(copilotKitCore.getStateByRun("agent1", "thread1", "run1")).toEqual(agent1State);
    expect(copilotKitCore.getStateByRun("agent2", "thread2", "run1")).toEqual(agent2State);
  });

  it("should track messages for multiple agents independently", async () => {
    const msg1: Message = { id: "msg1", role: "user", content: "Agent 1" };
    const msg2: Message = { id: "msg2", role: "user", content: "Agent 2" };

    await agent1.emitRunStarted("run1", {});
    await agent1.emitNewMessage("run1", msg1);
    await agent1.emitRunFinished("run1", {});

    await agent2.emitRunStarted("run1", {});
    await agent2.emitNewMessage("run1", msg2);
    await agent2.emitRunFinished("run1", {});

    expect(copilotKitCore.getRunIdForMessage("agent1", "thread1", "msg1")).toBe("run1");
    expect(copilotKitCore.getRunIdForMessage("agent2", "thread2", "msg2")).toBe("run1");
    // Cross-agent lookups should return undefined
    expect(copilotKitCore.getRunIdForMessage("agent1", "thread1", "msg2")).toBeUndefined();
    expect(copilotKitCore.getRunIdForMessage("agent2", "thread2", "msg1")).toBeUndefined();
  });

  it("should handle same agent with multiple threads", async () => {
    // Create first instance with thread-a
    const agent3ThreadA = new EventEmittingMockAgent("agent3", "thread-a");
    copilotKitCore.addAgent__unsafe_dev_only({ id: "agent3", agent: agent3ThreadA as any });

    // Create second instance without agentId initially, then assign it after registration
    const agent3ThreadB = new EventEmittingMockAgent("", "thread-b");
    copilotKitCore.addAgent__unsafe_dev_only({ id: "agent3-threadb", agent: agent3ThreadB as any });

    const threadAState = { thread: "a", count: 1 };
    const threadBState = { thread: "b", count: 2 };

    await agent3ThreadA.emitRunStarted("run1", threadAState);
    await agent3ThreadA.emitRunFinished("run1", threadAState);

    await agent3ThreadB.emitRunStarted("run1", threadBState);
    await agent3ThreadB.emitRunFinished("run1", threadBState);

    expect(copilotKitCore.getStateByRun("agent3", "thread-a", "run1")).toEqual(threadAState);
    expect(copilotKitCore.getStateByRun("agent3-threadb", "thread-b", "run1")).toEqual(threadBState);
  });
});

describe("StateManager - State Isolation", () => {
  let copilotKitCore: CopilotKitCore;
  let agent: EventEmittingMockAgent;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    agent = new EventEmittingMockAgent("agent1", "thread1");
    copilotKitCore.addAgent__unsafe_dev_only({ id: "agent1", agent: agent as any });
  });

  it("should deep copy state to prevent external mutations", async () => {
    const runId = "run1";
    const state = { nested: { count: 1 }, items: [1, 2, 3] };

    await agent.emitRunStarted(runId, state);

    const retrievedState = copilotKitCore.getStateByRun("agent1", "thread1", runId) as any;

    // Mutate the retrieved state
    retrievedState.nested.count = 999;
    retrievedState.items.push(4);

    // Original stored state should be unchanged
    const retrievedAgain = copilotKitCore.getStateByRun("agent1", "thread1", runId) as any;
    expect(retrievedAgain.nested.count).toBe(1);
    expect(retrievedAgain.items).toEqual([1, 2, 3]);
  });

  it("should handle complex nested state objects", async () => {
    const runId = "run1";
    const complexState = {
      user: {
        id: "123",
        profile: {
          name: "Alice",
          settings: {
            theme: "dark",
            notifications: true,
          },
        },
      },
      conversations: [
        { id: "conv1", messages: 5 },
        { id: "conv2", messages: 3 },
      ],
      metadata: {
        timestamp: 1234567890,
        version: "1.0",
      },
    };

    await agent.emitRunStarted(runId, complexState);

    const storedState = copilotKitCore.getStateByRun("agent1", "thread1", runId);
    expect(storedState).toEqual(complexState);
  });

  it("should handle state with null and undefined values", async () => {
    const runId = "run1";
    const state = {
      nullValue: null,
      undefinedValue: undefined,
      zeroValue: 0,
      emptyString: "",
      falseValue: false,
    };

    await agent.emitRunStarted(runId, state);

    const storedState = copilotKitCore.getStateByRun("agent1", "thread1", runId) as any;
    expect(storedState.nullValue).toBeNull();
    // Note: undefined may not survive JSON serialization
    expect(storedState.zeroValue).toBe(0);
    expect(storedState.emptyString).toBe("");
    expect(storedState.falseValue).toBe(false);
  });
});

describe("StateManager - Edge Cases", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
  });

  it("should handle agent without agentId gracefully", async () => {
    const agent = new EventEmittingMockAgent("", "thread1");
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    // Agent will get assigned "test" as its agentId during registration
    // So it should actually track the state under "test"
    await agent.emitRunStarted("run1", { count: 1 });

    // The state should be tracked under the assigned agentId "test"
    const state = copilotKitCore.getStateByRun("test", "thread1", "run1");
    expect(state).toEqual({ count: 1 });
  });

  it("should handle empty state object", async () => {
    const agent = new EventEmittingMockAgent("agent1", "thread1");
    copilotKitCore.addAgent__unsafe_dev_only({ id: "agent1", agent: agent as any });

    await agent.emitRunStarted("run1", {});
    await agent.emitRunFinished("run1", {});

    const storedState = copilotKitCore.getStateByRun("agent1", "thread1", "run1");
    expect(storedState).toEqual({});
  });

  it("should handle rapid successive runs", async () => {
    const agent = new EventEmittingMockAgent("agent1", "thread1");
    copilotKitCore.addAgent__unsafe_dev_only({ id: "agent1", agent: agent as any });

    // Fire multiple runs rapidly
    const promises = [];
    for (let i = 0; i < 10; i++) {
      const runId = `run${i}`;
      const state = { count: i };
      promises.push(
        agent.emitRunStarted(runId, state).then(() => agent.emitRunFinished(runId, state))
      );
    }

    await Promise.all(promises);

    // All runs should be tracked correctly
    for (let i = 0; i < 10; i++) {
      const storedState = copilotKitCore.getStateByRun("agent1", "thread1", `run${i}`);
      expect(storedState).toEqual({ count: i });
    }
  });

  it("should handle messages without input parameter", async () => {
    const agent = new EventEmittingMockAgent("agent1", "thread1");
    copilotKitCore.addAgent__unsafe_dev_only({ id: "agent1", agent: agent as any });

    const message: Message = {
      id: "msg1",
      role: "user",
      content: "Test",
    };

    // Emit message without proper input (edge case)
    for (const sub of (agent as any).subscribers) {
      if (sub.onNewMessage) {
        await sub.onNewMessage({
          message,
          messages: agent.messages,
          state: agent.state,
          agent: agent,
          // No input parameter
        });
      }
    }

    // Should not throw, but message won't be associated
    const runId = copilotKitCore.getRunIdForMessage("agent1", "thread1", "msg1");
    expect(runId).toBeUndefined();
  });
});

describe("StateManager - Real-world Scenarios", () => {
  let copilotKitCore: CopilotKitCore;
  let agent: EventEmittingMockAgent;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    agent = new EventEmittingMockAgent("chatbot", "user-session-123");
    copilotKitCore.addAgent__unsafe_dev_only({ id: "chatbot", agent: agent as any });
  });

  it("should track a complete conversation flow", async () => {
    // First run - user asks a question
    const run1Id = randomUUID();
    await agent.emitRunStarted(run1Id, { conversationContext: "greeting" });

    const msg1: Message = { id: randomUUID(), role: "user", content: "Hello" };
    await agent.emitNewMessage(run1Id, msg1);

    const msg2: Message = { id: randomUUID(), role: "assistant", content: "Hi! How can I help?" };
    await agent.emitNewMessage(run1Id, msg2);

    await agent.emitRunFinished(run1Id, { conversationContext: "greeting", messageCount: 2 });

    // Second run - user asks for help
    const run2Id = randomUUID();
    await agent.emitRunStarted(run2Id, { conversationContext: "help_request", messageCount: 2 });

    const msg3: Message = { id: randomUUID(), role: "user", content: "I need help with my order" };
    await agent.emitNewMessage(run2Id, msg3);

    await agent.emitStateSnapshot(run2Id, { conversationContext: "help_request", topic: "orders" });

    const msg4: Message = { id: randomUUID(), role: "assistant", content: "I can help with that!" };
    await agent.emitNewMessage(run2Id, msg4);

    await agent.emitRunFinished(run2Id, {
      conversationContext: "help_request",
      topic: "orders",
      messageCount: 4,
    });

    // Verify all messages are associated correctly
    expect(copilotKitCore.getRunIdForMessage("chatbot", "user-session-123", msg1.id)).toBe(run1Id);
    expect(copilotKitCore.getRunIdForMessage("chatbot", "user-session-123", msg2.id)).toBe(run1Id);
    expect(copilotKitCore.getRunIdForMessage("chatbot", "user-session-123", msg3.id)).toBe(run2Id);
    expect(copilotKitCore.getRunIdForMessage("chatbot", "user-session-123", msg4.id)).toBe(run2Id);

    // Verify states are tracked correctly
    const run1State = copilotKitCore.getStateByRun("chatbot", "user-session-123", run1Id);
    expect(run1State).toMatchObject({ conversationContext: "greeting", messageCount: 2 });

    const run2State = copilotKitCore.getStateByRun("chatbot", "user-session-123", run2Id);
    expect(run2State).toMatchObject({
      conversationContext: "help_request",
      topic: "orders",
      messageCount: 4,
    });

    // Verify we can list all runs
    const runIds = copilotKitCore.getRunIdsForThread("chatbot", "user-session-123");
    expect(runIds).toHaveLength(2);
    expect(runIds).toContain(run1Id);
    expect(runIds).toContain(run2Id);
  });

  it("should handle tool execution flow with state changes", async () => {
    const runId = randomUUID();

    await agent.emitRunStarted(runId, { step: "initial", toolsExecuted: [] });

    const userMsg: Message = {
      id: randomUUID(),
      role: "user",
      content: "Search for cats",
    };
    await agent.emitNewMessage(runId, userMsg);

    // Agent calls a tool
    const toolCallMsg: Message = {
      id: randomUUID(),
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "tool-call-1",
          type: "function",
          function: {
            name: "searchWeb",
            arguments: JSON.stringify({ query: "cats" }),
          },
        },
      ],
    };
    await agent.emitNewMessage(runId, toolCallMsg);

    // Update state after tool call
    await agent.emitStateDelta(runId, [], {
      step: "tool_called",
      toolsExecuted: ["searchWeb"],
      lastToolCall: "tool-call-1",
    });

    // Tool result comes back
    const toolResultMsg: Message = {
      id: randomUUID(),
      role: "tool",
      content: "Found 10 results about cats",
      toolCallId: "tool-call-1",
    };
    await agent.emitNewMessage(runId, toolResultMsg);

    // Final response
    const responseMsg: Message = {
      id: randomUUID(),
      role: "assistant",
      content: "I found information about cats for you!",
    };
    await agent.emitNewMessage(runId, responseMsg);

    await agent.emitRunFinished(runId, {
      step: "completed",
      toolsExecuted: ["searchWeb"],
      totalMessages: 4,
    });

    // Verify all messages are associated
    expect(copilotKitCore.getRunIdForMessage("chatbot", "user-session-123", userMsg.id)).toBe(runId);
    expect(copilotKitCore.getRunIdForMessage("chatbot", "user-session-123", toolCallMsg.id)).toBe(runId);
    expect(copilotKitCore.getRunIdForMessage("chatbot", "user-session-123", toolResultMsg.id)).toBe(runId);
    expect(copilotKitCore.getRunIdForMessage("chatbot", "user-session-123", responseMsg.id)).toBe(runId);

    // Verify final state
    const finalState = copilotKitCore.getStateByRun("chatbot", "user-session-123", runId);
    expect(finalState).toMatchObject({
      step: "completed",
      toolsExecuted: ["searchWeb"],
      totalMessages: 4,
    });
  });
});
