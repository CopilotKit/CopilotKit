import { EventType } from "@ag-ui/client";
import { LangGraphAgent } from "../agent";
import { CustomEventNames } from "../consts";
import { vi } from "vitest";

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

function makeCustomEvent(name: string, value: any) {
  return {
    type: EventType.CUSTOM,
    name,
    value,
  } as any;
}

/**
 * Mock the parent class's langGraphDefaultMergeState for a single test,
 * using vi.spyOn for automatic cleanup.
 */
function withMockedParentMerge(agent: LangGraphAgent, returnValue: any) {
  const parentProto = Object.getPrototypeOf(Object.getPrototypeOf(agent));
  return vi
    .spyOn(parentProto, "langGraphDefaultMergeState")
    .mockReturnValue(returnValue);
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

// ---------- CopilotKit custom event dispatch ----------

describe("dispatchEvent custom CopilotKit events", () => {
  it("manually_emit_message produces TextMessage event sequence", () => {
    const { agent, events } = createAgent();

    const result = agent.dispatchEvent(
      makeCustomEvent(CustomEventNames.CopilotKitManuallyEmitMessage, {
        message_id: "msg-manual-1",
        message: "Hello from agent",
        role: "assistant",
      }),
    );

    expect(result).toBe(true);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe(EventType.TEXT_MESSAGE_START);
    expect(events[0].messageId).toBe("msg-manual-1");
    expect(events[0].role).toBe("assistant");
    expect(events[1].type).toBe(EventType.TEXT_MESSAGE_CONTENT);
    expect(events[1].delta).toBe("Hello from agent");
    expect(events[2].type).toBe(EventType.TEXT_MESSAGE_END);
    expect(events[2].messageId).toBe("msg-manual-1");
  });

  it("manually_emit_tool_call produces ToolCall event sequence", () => {
    const { agent, events } = createAgent();

    const result = agent.dispatchEvent(
      makeCustomEvent(CustomEventNames.CopilotKitManuallyEmitToolCall, {
        id: "tc-manual-1",
        name: "SearchTool",
        args: { query: "test" },
      }),
    );

    expect(result).toBe(true);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe(EventType.TOOL_CALL_START);
    expect(events[0].toolCallId).toBe("tc-manual-1");
    expect(events[0].toolCallName).toBe("SearchTool");
    expect(events[1].type).toBe(EventType.TOOL_CALL_ARGS);
    expect(events[1].toolCallId).toBe("tc-manual-1");
    expect(events[1].delta).toEqual({ query: "test" });
    expect(events[2].type).toBe(EventType.TOOL_CALL_END);
    expect(events[2].toolCallId).toBe("tc-manual-1");
  });

  it("manually_emit_state produces StateSnapshot event", () => {
    const { agent, events } = createAgent();

    // Mock getStateSnapshot since it depends on thread state
    (agent as any).getStateSnapshot = (state: any) => ({
      values: state.values,
    });

    const result = agent.dispatchEvent(
      makeCustomEvent(
        CustomEventNames.CopilotKitManuallyEmitIntermediateState,
        {
          progress: 75,
        },
      ),
    );

    expect(result).toBe(true);
    expect((agent as any).activeRun.manuallyEmittedState).toEqual({
      progress: 75,
    });
    const snapshotEvents = events.filter(
      (e) => e.type === EventType.STATE_SNAPSHOT,
    );
    expect(snapshotEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("copilotkit_exit produces Exit custom event", () => {
    const { agent, events } = createAgent();

    const result = agent.dispatchEvent(
      makeCustomEvent(CustomEventNames.CopilotKitExit, {}),
    );

    expect(result).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(EventType.CUSTOM);
    // "Exit" is the hardcoded downstream name in agent.ts — not a constant,
    // because it's the value the frontend listens for, not an internal enum.
    expect(events[0].name).toBe("Exit");
    expect(events[0].value).toBe(true);
  });

  it("events without rawEvent pass through to subscriber", () => {
    const { agent, events } = createAgent();

    const result = agent.dispatchEvent({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-no-raw",
      role: "assistant",
    } as any);

    expect(result).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].messageId).toBe("msg-no-raw");
  });
});

// ---------- langGraphDefaultMergeState ----------

describe("langGraphDefaultMergeState", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merges copilotkit actions from ag-ui tools", () => {
    const { agent } = createAgent();
    const tools = [{ name: "tool1" }, { name: "tool2" }];

    withMockedParentMerge(agent, {
      "ag-ui": { tools, context: [] },
      tools: [],
      messages: [],
    });

    const result = agent.langGraphDefaultMergeState({} as any, [], {} as any);
    expect(result.copilotkit).toBeDefined();
    expect(result.copilotkit.actions).toEqual(expect.arrayContaining(tools));
  });

  it("merges copilotkit context from ag-ui", () => {
    const { agent } = createAgent();
    const context = [{ description: "user info", value: "test" }];

    withMockedParentMerge(agent, {
      "ag-ui": { tools: [], context },
      tools: [],
      messages: [],
    });

    const result = agent.langGraphDefaultMergeState({} as any, [], {} as any);
    expect(result.copilotkit.context).toEqual(context);
  });

  it("handles missing ag-ui key without crashing", () => {
    const { agent } = createAgent();

    withMockedParentMerge(agent, { messages: [] });

    const result = agent.langGraphDefaultMergeState({} as any, [], {} as any);
    expect(result.copilotkit).toBeDefined();
    expect(result.copilotkit.actions).toEqual([]);
    expect(result.copilotkit.context).toEqual([]);
  });

  it("deduplicates tools from returnedTools and ag-ui tools", () => {
    const { agent } = createAgent();
    const tool = { name: "SharedTool", id: "shared-1" };

    withMockedParentMerge(agent, {
      "ag-ui": { tools: [tool], context: [] },
      tools: [tool],
      messages: [],
    });

    const result = agent.langGraphDefaultMergeState({} as any, [], {} as any);
    expect(result.copilotkit.actions).toHaveLength(1);
    expect(result.copilotkit.actions[0].name).toBe("SharedTool");
  });
});
