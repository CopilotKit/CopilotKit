import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AbstractAgent, EventType, RunAgentInput, BaseEvent } from "@ag-ui/client";
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

function createMockSubscriber(): AgentSubscriber & Record<string, ReturnType<typeof vi.fn>> {
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

      const contentCall = subscriber.onReasoningMessageContentEvent.mock.calls[0][0];
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
      expect(secondSub.onTextMessageContentEvent.mock.calls[0][0].textMessageBuffer).toBe("should reach all");
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
});
