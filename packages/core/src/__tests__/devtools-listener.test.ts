import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AbstractAgent, EventType, State, RunAgentInput } from "@ag-ui/client";
import { DevtoolsListener } from "../core/devtools-listener.js";
import { devtoolsClient } from "@copilotkit/devtools-client";

/**
 * Test agent that exposes subscribers for event injection testing.
 */
class TestAgent extends AbstractAgent {
  constructor(agentId: string) {
    super({ agentId, threadId: "thread-1", initialState: {} });
  }

  protected run(_input: RunAgentInput): any {
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

describe("DevtoolsListener", () => {
  let agent: TestAgent;
  let listener: DevtoolsListener;
  let subscriber: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    agent = new TestAgent("test-agent");

    subscriber = {
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
    it("expands into full AG-UI event sequence", () => {
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
    it("expands into full AG-UI event sequence", () => {
      devtoolsClient.emit("custom-event", {
        agentId: "test-agent",
        name: "my-event",
        value: { foo: "bar" },
      });

      expect(subscriber.onRunStartedEvent).toHaveBeenCalledOnce();
      expect(subscriber.onCustomEvent).toHaveBeenCalledOnce();
      expect(subscriber.onRunFinishedEvent).toHaveBeenCalledOnce();
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
      (agent as any).isRunning = true;

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
  });
});
