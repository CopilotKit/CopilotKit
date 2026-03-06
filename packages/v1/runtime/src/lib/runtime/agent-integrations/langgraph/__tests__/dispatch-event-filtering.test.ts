import { EventType } from "@ag-ui/client";
import { LangGraphAgent } from "../agent";

function createAgent() {
  const agent = new LangGraphAgent({
    graphId: "test-graph",
    url: "http://localhost:8000",
  });

  const events: any[] = [];
  (agent as any).subscriber = { next: (e: any) => events.push(e) };
  (agent as any).activeRun = {
    id: "run-1",
    threadId: "thread-1",
    hasFunctionStreaming: false,
  };
  (agent as any).messagesInProcess = {};

  return { agent, events };
}

function makeTextEvent(
  type: EventType,
  metadata: Record<string, any>,
  messageId = "msg-1",
) {
  return {
    type,
    messageId,
    ...(type === EventType.TEXT_MESSAGE_CONTENT ? { delta: "hello" } : {}),
    ...(type === EventType.TEXT_MESSAGE_START ? { role: "assistant" } : {}),
    rawEvent: { metadata },
  };
}

describe("dispatchEvent emit-messages filtering", () => {
  it("suppresses message events when copilotkit:emit-messages is false", () => {
    const { agent, events } = createAgent();

    const result = agent.dispatchEvent(
      makeTextEvent(EventType.TEXT_MESSAGE_START, {
        "copilotkit:emit-messages": false,
      }) as any,
    );

    expect(result).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("passes message events when copilotkit:emit-messages is true", () => {
    const { agent, events } = createAgent();

    const result = agent.dispatchEvent(
      makeTextEvent(EventType.TEXT_MESSAGE_START, {
        "copilotkit:emit-messages": true,
      }) as any,
    );

    expect(result).toBe(true);
    expect(events).toHaveLength(1);
  });

  it("clears messagesInProcess when suppressing message events", () => {
    const { agent } = createAgent();

    // Simulate parent class having set a stale message record
    (agent as any).messagesInProcess["run-1"] = {
      id: "msg-1",
      toolCallId: null,
      toolCallName: null,
    };

    agent.dispatchEvent(
      makeTextEvent(EventType.TEXT_MESSAGE_START, {
        "copilotkit:emit-messages": false,
      }) as any,
    );

    expect((agent as any).messagesInProcess["run-1"]).toBeNull();
  });

  it("does NOT clear messagesInProcess when emit-messages is true", () => {
    const { agent } = createAgent();

    const staleRecord = {
      id: "msg-1",
      toolCallId: null,
      toolCallName: null,
    };
    (agent as any).messagesInProcess["run-1"] = staleRecord;

    agent.dispatchEvent(
      makeTextEvent(EventType.TEXT_MESSAGE_CONTENT, {
        "copilotkit:emit-messages": true,
      }) as any,
    );

    // Record should still be there (not cleared)
    expect((agent as any).messagesInProcess["run-1"]).toBe(staleRecord);
  });

  it("clears messagesInProcess on TEXT_MESSAGE_END suppression (the cross-node leak scenario)", () => {
    const { agent } = createAgent();

    // Orchestrator node set a message in progress, then its events get suppressed.
    // The END event must also clear the tracking state.
    (agent as any).messagesInProcess["run-1"] = {
      id: "msg-orchestrator",
      toolCallId: null,
      toolCallName: null,
    };

    agent.dispatchEvent(
      makeTextEvent(
        EventType.TEXT_MESSAGE_END,
        { "copilotkit:emit-messages": false },
        "msg-orchestrator",
      ) as any,
    );

    expect((agent as any).messagesInProcess["run-1"]).toBeNull();
  });
});

describe("dispatchEvent emit-tool-calls filtering", () => {
  it("suppresses tool events when copilotkit:emit-tool-calls is false", () => {
    const { agent, events } = createAgent();

    const result = agent.dispatchEvent({
      type: EventType.TOOL_CALL_START,
      toolCallId: "tc-1",
      toolCallName: "search",
      parentMessageId: "msg-1",
      rawEvent: { metadata: { "copilotkit:emit-tool-calls": false } },
    } as any);

    expect(result).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("passes tool events when copilotkit:emit-tool-calls is true", () => {
    const { agent, events } = createAgent();

    const result = agent.dispatchEvent({
      type: EventType.TOOL_CALL_START,
      toolCallId: "tc-1",
      toolCallName: "search",
      parentMessageId: "msg-1",
      rawEvent: { metadata: { "copilotkit:emit-tool-calls": true } },
    } as any);

    expect(result).toBe(true);
    expect(events).toHaveLength(1);
  });
});
