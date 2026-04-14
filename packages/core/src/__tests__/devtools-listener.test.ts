import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AbstractAgent,
  EventType,
  RunAgentInput,
  BaseEvent,
} from "@ag-ui/client";
import type { AgentSubscriber } from "@ag-ui/client";
import { Observable } from "rxjs";
import { DevtoolsListener } from "../core/devtools-listener.js";
import { devtoolsClient } from "@copilotkit/devtools-client";

class TestAgent extends AbstractAgent {
  constructor(agentId: string) {
    super({ agentId, threadId: "thread-1", initialState: {} });
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    throw new Error("not used");
  }
}

function makeAgentsMap(agents: AbstractAgent[]): Record<string, AbstractAgent> {
  const map: Record<string, AbstractAgent> = {};
  for (const agent of agents) {
    if (agent.agentId) map[agent.agentId] = agent;
  }
  return map;
}

function createMockSubscriber(): AgentSubscriber &
  Record<string, ReturnType<typeof vi.fn>> {
  return {
    onRunStartedEvent: vi.fn(),
    onRunFinishedEvent: vi.fn(),
    onToolCallStartEvent: vi.fn(),
    onToolCallArgsEvent: vi.fn(),
    onToolCallEndEvent: vi.fn(),
    onToolCallResultEvent: vi.fn(),
    onTextMessageStartEvent: vi.fn(),
    onTextMessageContentEvent: vi.fn(),
    onTextMessageEndEvent: vi.fn(),
    onReasoningStartEvent: vi.fn(),
    onReasoningMessageStartEvent: vi.fn(),
    onReasoningMessageContentEvent: vi.fn(),
    onReasoningMessageEndEvent: vi.fn(),
    onReasoningEndEvent: vi.fn(),
    onStateSnapshotEvent: vi.fn(),
    onCustomEvent: vi.fn(),
  };
}

describe("DevtoolsListener", () => {
  let agent: TestAgent;
  let listener: DevtoolsListener;
  let subscriber: ReturnType<typeof createMockSubscriber>;

  beforeEach(() => {
    agent = new TestAgent("test-agent");
    subscriber = createMockSubscriber();
    agent.subscribe(subscriber);

    listener = new DevtoolsListener({
      getAgents: () => makeAgentsMap([agent]),
    });
    listener.initialize();
  });

  afterEach(() => {
    listener.destroy();
  });

  describe("tool-call", () => {
    it("expands into full AG-UI event sequence with correct fields", () => {
      devtoolsClient.emit("tool-call", {
        agentId: "test-agent",
        toolName: "search",
        args: { query: "hello" },
        result: "found it",
      });

      expect(subscriber.onRunStartedEvent).toHaveBeenCalledOnce();
      expect(subscriber.onToolCallStartEvent).toHaveBeenCalledOnce();
      expect(subscriber.onToolCallArgsEvent).toHaveBeenCalledOnce();
      expect(subscriber.onToolCallEndEvent).toHaveBeenCalledOnce();
      expect(subscriber.onToolCallResultEvent).toHaveBeenCalledOnce();
      expect(subscriber.onRunFinishedEvent).toHaveBeenCalledOnce();

      const startCall = subscriber.onToolCallStartEvent.mock.calls[0][0];
      expect(startCall.event.toolCallName).toBe("search");

      const argsCall = subscriber.onToolCallArgsEvent.mock.calls[0][0];
      expect(argsCall.toolCallName).toBe("search");
      expect(argsCall.partialToolCallArgs).toEqual({ query: "hello" });
      expect(argsCall.toolCallBuffer).toBe(JSON.stringify({ query: "hello" }));

      const endCall = subscriber.onToolCallEndEvent.mock.calls[0][0];
      expect(endCall.toolCallName).toBe("search");
      expect(endCall.toolCallArgs).toEqual({ query: "hello" });

      const resultCall = subscriber.onToolCallResultEvent.mock.calls[0][0];
      expect(resultCall.event.type).toBe(EventType.TOOL_CALL_RESULT);
      expect(resultCall.event.content).toBe("found it");
      expect(resultCall.event.role).toBe("tool");
      expect(resultCall.event.messageId).toBeDefined();
    });

    it("delivers events in the correct AG-UI sequence order", () => {
      const callOrder: string[] = [];
      const orderingSub: AgentSubscriber = {
        onRunStartedEvent: vi.fn(() => {
          callOrder.push("RUN_STARTED");
        }),
        onToolCallStartEvent: vi.fn(() => {
          callOrder.push("TOOL_CALL_START");
        }),
        onToolCallArgsEvent: vi.fn(() => {
          callOrder.push("TOOL_CALL_ARGS");
        }),
        onToolCallEndEvent: vi.fn(() => {
          callOrder.push("TOOL_CALL_END");
        }),
        onToolCallResultEvent: vi.fn(() => {
          callOrder.push("TOOL_CALL_RESULT");
        }),
        onRunFinishedEvent: vi.fn(() => {
          callOrder.push("RUN_FINISHED");
        }),
      };
      agent.subscribe(orderingSub);

      devtoolsClient.emit("tool-call", {
        agentId: "test-agent",
        toolName: "search",
        args: { query: "hello" },
        result: "found it",
      });

      expect(callOrder).toEqual([
        "RUN_STARTED",
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
        "TOOL_CALL_RESULT",
        "RUN_FINISHED",
      ]);
    });

    it("updates agent.messages with tool call and result messages", () => {
      devtoolsClient.emit("tool-call", {
        agentId: "test-agent",
        toolName: "search",
        args: { query: "hello" },
        result: "found it",
      });

      expect(agent.messages).toHaveLength(2);
      const assistantMsg = agent.messages[0]!;
      expect(assistantMsg.role).toBe("assistant");
      expect((assistantMsg as any).toolCalls).toHaveLength(1);
      expect((assistantMsg as any).toolCalls[0].function.name).toBe("search");

      const toolMsg = agent.messages[1]!;
      expect(toolMsg.role).toBe("tool");
      expect((toolMsg as any).content).toBe("found it");
    });
  });

  describe("text-message", () => {
    it("expands into full AG-UI event sequence", () => {
      devtoolsClient.emit("text-message", {
        agentId: "test-agent",
        content: "Hello world",
      });

      expect(subscriber.onRunStartedEvent).toHaveBeenCalledOnce();
      expect(subscriber.onTextMessageStartEvent).toHaveBeenCalledOnce();
      expect(subscriber.onTextMessageContentEvent).toHaveBeenCalledOnce();
      expect(subscriber.onTextMessageEndEvent).toHaveBeenCalledOnce();
      expect(subscriber.onRunFinishedEvent).toHaveBeenCalledOnce();

      const contentCall = subscriber.onTextMessageContentEvent.mock.calls[0][0];
      expect(contentCall.textMessageBuffer).toBe("Hello world");
    });

    it("delivers events in the correct AG-UI sequence order", () => {
      const callOrder: string[] = [];
      const orderingSub: AgentSubscriber = {
        onRunStartedEvent: vi.fn(() => {
          callOrder.push("RUN_STARTED");
        }),
        onTextMessageStartEvent: vi.fn(() => {
          callOrder.push("TEXT_MESSAGE_START");
        }),
        onTextMessageContentEvent: vi.fn(() => {
          callOrder.push("TEXT_MESSAGE_CONTENT");
        }),
        onTextMessageEndEvent: vi.fn(() => {
          callOrder.push("TEXT_MESSAGE_END");
        }),
        onRunFinishedEvent: vi.fn(() => {
          callOrder.push("RUN_FINISHED");
        }),
      };
      agent.subscribe(orderingSub);

      devtoolsClient.emit("text-message", {
        agentId: "test-agent",
        content: "Hello world",
      });

      expect(callOrder).toEqual([
        "RUN_STARTED",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "RUN_FINISHED",
      ]);
    });

    it("updates agent.messages with assistant message", () => {
      devtoolsClient.emit("text-message", {
        agentId: "test-agent",
        content: "Hello world",
      });

      expect(agent.messages).toHaveLength(1);
      expect(agent.messages[0]!.role).toBe("assistant");
      expect((agent.messages[0] as any).content).toBe("Hello world");
    });
  });

  describe("reasoning", () => {
    it("expands into full AG-UI event sequence", () => {
      devtoolsClient.emit("reasoning", {
        agentId: "test-agent",
        content: "Thinking about this...",
      });

      expect(subscriber.onRunStartedEvent).toHaveBeenCalledOnce();
      expect(subscriber.onReasoningStartEvent).toHaveBeenCalledOnce();
      expect(subscriber.onReasoningMessageStartEvent).toHaveBeenCalledOnce();
      expect(subscriber.onReasoningMessageContentEvent).toHaveBeenCalledOnce();
      expect(subscriber.onReasoningMessageEndEvent).toHaveBeenCalledOnce();
      expect(subscriber.onReasoningEndEvent).toHaveBeenCalledOnce();
      expect(subscriber.onRunFinishedEvent).toHaveBeenCalledOnce();

      const contentCall =
        subscriber.onReasoningMessageContentEvent.mock.calls[0][0];
      expect(contentCall.reasoningMessageBuffer).toBe("Thinking about this...");
    });
  });

  describe("state-snapshot", () => {
    it("expands into full AG-UI event sequence", () => {
      devtoolsClient.emit("state-snapshot", {
        agentId: "test-agent",
        state: { count: 42 },
      });

      expect(subscriber.onRunStartedEvent).toHaveBeenCalledOnce();
      expect(subscriber.onStateSnapshotEvent).toHaveBeenCalledOnce();
      expect(subscriber.onRunFinishedEvent).toHaveBeenCalledOnce();

      const snapshotCall = subscriber.onStateSnapshotEvent.mock.calls[0][0];
      expect(snapshotCall.event.snapshot).toEqual({ count: 42 });
    });

    it("updates agent.state with snapshot", () => {
      devtoolsClient.emit("state-snapshot", {
        agentId: "test-agent",
        state: { count: 42 },
      });

      expect(agent.state).toEqual({ count: 42 });
    });
  });

  describe("custom-event", () => {
    it("expands into full AG-UI event sequence with correct fields", () => {
      devtoolsClient.emit("custom-event", {
        agentId: "test-agent",
        name: "my-event",
        value: { foo: "bar" },
      });

      expect(subscriber.onRunStartedEvent).toHaveBeenCalledOnce();
      expect(subscriber.onCustomEvent).toHaveBeenCalledOnce();
      expect(subscriber.onRunFinishedEvent).toHaveBeenCalledOnce();

      const customCall = subscriber.onCustomEvent.mock.calls[0][0];
      expect(customCall.event.name).toBe("my-event");
      expect(customCall.event.value).toEqual({ foo: "bar" });
    });
  });

  describe("edge cases", () => {
    it("no-ops when agent not found", () => {
      devtoolsClient.emit("tool-call", {
        agentId: "non-existent",
        toolName: "search",
        args: {},
        result: "",
      });

      expect(subscriber.onRunStartedEvent).not.toHaveBeenCalled();
    });

    it("skips run lifecycle when agent is already running", () => {
      agent.isRunning = true;

      devtoolsClient.emit("text-message", {
        agentId: "test-agent",
        content: "injected mid-run",
      });

      expect(subscriber.onRunStartedEvent).not.toHaveBeenCalled();
      expect(subscriber.onTextMessageStartEvent).toHaveBeenCalledOnce();
      expect(subscriber.onTextMessageContentEvent).toHaveBeenCalledOnce();
      expect(subscriber.onTextMessageEndEvent).toHaveBeenCalledOnce();
      expect(subscriber.onRunFinishedEvent).not.toHaveBeenCalled();
    });

    it("does not process events after destroy()", () => {
      listener.destroy();

      devtoolsClient.emit("text-message", {
        agentId: "test-agent",
        content: "should be ignored",
      });

      expect(subscriber.onRunStartedEvent).not.toHaveBeenCalled();
      expect(subscriber.onTextMessageStartEvent).not.toHaveBeenCalled();
    });

    it("is idempotent on double initialize()", () => {
      listener.initialize();

      devtoolsClient.emit("text-message", {
        agentId: "test-agent",
        content: "only once",
      });

      expect(subscriber.onTextMessageContentEvent).toHaveBeenCalledOnce();
    });

    it("continues notifying other subscribers when one throws", () => {
      const throwingSub = createMockSubscriber();
      throwingSub.onTextMessageContentEvent.mockImplementation(() => {
        throw new Error("subscriber crash");
      });
      agent.subscribe(throwingSub);

      const secondSub = createMockSubscriber();
      agent.subscribe(secondSub);

      devtoolsClient.emit("text-message", {
        agentId: "test-agent",
        content: "should reach all",
      });

      expect(throwingSub.onTextMessageContentEvent).toHaveBeenCalledOnce();
      expect(secondSub.onTextMessageContentEvent).toHaveBeenCalledOnce();
      expect(
        secondSub.onTextMessageContentEvent.mock.calls[0][0].textMessageBuffer,
      ).toBe("should reach all");
    });

    it("fires RUN_FINISHED even when a subscriber event handler throws", () => {
      subscriber.onToolCallStartEvent.mockImplementation(() => {
        throw new Error("start handler crash");
      });

      devtoolsClient.emit("tool-call", {
        agentId: "test-agent",
        toolName: "search",
        args: {},
        result: "",
      });

      expect(subscriber.onRunStartedEvent).toHaveBeenCalledOnce();
      expect(subscriber.onRunFinishedEvent).toHaveBeenCalledOnce();
    });
  });

  describe("thread clone resolver", () => {
    it("dispatches state updates to thread clones instead of registry agent", () => {
      const clone1 = new TestAgent("test-agent");
      const clone2 = new TestAgent("test-agent");

      listener.setThreadCloneResolver(() => [clone1, clone2]);

      devtoolsClient.emit("text-message", {
        agentId: "test-agent",
        content: "Hello clones",
      });

      // Clones should receive the message
      expect(clone1.messages).toHaveLength(1);
      expect((clone1.messages[0] as any).content).toBe("Hello clones");
      expect(clone2.messages).toHaveLength(1);
      expect((clone2.messages[0] as any).content).toBe("Hello clones");

      // Registry agent should NOT receive the message (clones take priority)
      expect(agent.messages).toHaveLength(0);
    });

    it("falls back to registry agent when resolver returns empty array", () => {
      listener.setThreadCloneResolver(() => []);

      devtoolsClient.emit("text-message", {
        agentId: "test-agent",
        content: "Fallback message",
      });

      expect(agent.messages).toHaveLength(1);
      expect((agent.messages[0] as any).content).toBe("Fallback message");
    });
  });

  describe("integration: full event sequence ordering", () => {
    it("tool-call subscriber receives all events in exact AG-UI protocol order", () => {
      const events: { type: string; payload: Record<string, unknown> }[] = [];
      const recordingSub: AgentSubscriber = {
        onRunStartedEvent: vi.fn((p: any) => {
          events.push({ type: p.event.type, payload: p.event });
        }),
        onToolCallStartEvent: vi.fn((p: any) => {
          events.push({ type: p.event.type, payload: p.event });
        }),
        onToolCallArgsEvent: vi.fn((p: any) => {
          events.push({ type: p.event.type, payload: p.event });
        }),
        onToolCallEndEvent: vi.fn((p: any) => {
          events.push({ type: p.event.type, payload: p.event });
        }),
        onToolCallResultEvent: vi.fn((p: any) => {
          events.push({ type: p.event.type, payload: p.event });
        }),
        onRunFinishedEvent: vi.fn((p: any) => {
          events.push({ type: p.event.type, payload: p.event });
        }),
      };
      agent.subscribe(recordingSub);

      devtoolsClient.emit("tool-call", {
        agentId: "test-agent",
        toolName: "fetchData",
        args: { url: "https://example.com" },
        result: '{"status":"ok"}',
      });

      // Verify exact sequence
      const types = events.map((e) => e.type);
      expect(types).toEqual([
        EventType.RUN_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.TOOL_CALL_RESULT,
        EventType.RUN_FINISHED,
      ]);

      // Verify toolCallId is consistent across the tool-call events
      const toolCallEvents = events.slice(1, 5);
      const toolCallIds = toolCallEvents.map((e) => e.payload.toolCallId);
      expect(toolCallIds.every((id) => id === toolCallIds[0])).toBe(true);
      expect(toolCallIds[0]).toBeDefined();

      // Verify payload fields
      expect(events[1]!.payload.toolCallName).toBe("fetchData");
      expect(events[3]!.payload.toolCallId).toBe(toolCallIds[0]);
      expect(events[4]!.payload.content).toBe('{"status":"ok"}');
    });

    it("text-message subscriber receives all events in exact AG-UI protocol order", () => {
      const events: { type: string; payload: Record<string, unknown> }[] = [];
      const recordingSub: AgentSubscriber = {
        onRunStartedEvent: vi.fn((p: any) => {
          events.push({ type: p.event.type, payload: p.event });
        }),
        onTextMessageStartEvent: vi.fn((p: any) => {
          events.push({ type: p.event.type, payload: p.event });
        }),
        onTextMessageContentEvent: vi.fn((p: any) => {
          events.push({ type: p.event.type, payload: p.event });
        }),
        onTextMessageEndEvent: vi.fn((p: any) => {
          events.push({ type: p.event.type, payload: p.event });
        }),
        onRunFinishedEvent: vi.fn((p: any) => {
          events.push({ type: p.event.type, payload: p.event });
        }),
      };
      agent.subscribe(recordingSub);

      devtoolsClient.emit("text-message", {
        agentId: "test-agent",
        content: "Integration test message",
      });

      const types = events.map((e) => e.type);
      expect(types).toEqual([
        EventType.RUN_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.RUN_FINISHED,
      ]);

      // Verify messageId is consistent across text message events
      const msgEvents = events.slice(1, 4);
      const messageIds = msgEvents.map((e) => e.payload.messageId);
      expect(messageIds.every((id) => id === messageIds[0])).toBe(true);
      expect(messageIds[0]).toBeDefined();
    });
  });
});
