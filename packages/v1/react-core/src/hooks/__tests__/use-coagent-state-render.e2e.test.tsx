import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { useCoAgentStateRender } from "../use-coagent-state-render";
import { CoAgentStateRenderBridge } from "../use-coagent-state-render-bridge";
import { useCopilotChatInternal } from "../use-copilot-chat_internal";
import { CoAgentStateRendersProvider, CopilotContext, useCoAgentStateRenders } from "../../context";
import type { Claim } from "../use-coagent-state-render-bridge.helpers";
import { createTestCopilotContext } from "../../test-helpers/copilot-context";

type TestMessage = {
  id: string;
  role: "user" | "assistant" | "system" | string;
  content?: string;
};

type TestAgentSubscriber = {
  onStateChanged?: (args?: { state?: Record<string, unknown> }) => void;
  onStepStartedEvent?: (args: { event: { stepName: string } }) => void;
  onStepFinishedEvent?: (args: { event: { stepName: string } }) => void;
};

const mockAgent = {
  messages: [] as TestMessage[],
  state: {},
  isRunning: true,
  subscribe: jest.fn(),
  setMessages: jest.fn(),
  setState: jest.fn(),
  addMessage: jest.fn(),
  abortRun: jest.fn(),
  runAgent: jest.fn(),
};

let lastSubscriber: TestAgentSubscriber | null = null;

jest.mock("@copilotkitnext/react", () => ({
  useAgent: jest.fn(() => ({ agent: mockAgent })),
  useCopilotKit: jest.fn(() => ({
    copilotkit: {
      connectAgent: jest.fn(),
      getRunIdForMessage: jest.fn(),
      runAgent: jest.fn(),
      clearSuggestions: jest.fn(),
      addSuggestionsConfig: jest.fn(),
      reloadSuggestions: jest.fn(),
    },
  })),
  useCopilotChatConfiguration: jest.fn(() => ({ agentId: "test-agent" })),
  useRenderCustomMessages: jest.fn(() => undefined),
  useSuggestions: jest.fn(() => ({ suggestions: [], isLoading: false })),
}));

jest.mock("../../components/toast/toast-provider", () => ({
  useToast: () => ({
    setBannerError: jest.fn(),
    addToast: jest.fn(),
  }),
}));

jest.mock("../../components/error-boundary/error-utils", () => ({
  useAsyncCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

jest.mock("../use-langgraph-interrupt-render", () => ({
  useLangGraphInterruptRender: jest.fn(() => null),
}));

jest.mock("../use-lazy-tool-renderer", () => ({
  useLazyToolRenderer: jest.fn(() => () => null),
}));

function TestHarness({ snapshot }: { snapshot: string }) {
  useCoAgentStateRender<{ current_step?: string }>({
    name: "test-agent",
    render: ({ state }) => <div data-testid="state">{state.current_step ?? "none"}</div>,
  });

  return (
    <CoAgentStateRenderBridge
      agentId="test-agent"
      message={{ id: "msg-1", role: "assistant" }}
      position="after"
      runId="run-1"
      messageIndex={0}
      messageIndexInRun={0}
      numberOfMessagesInRun={1}
      stateSnapshot={snapshot}
    />
  );
}

function SnapshotHarness({ snapshot, message }: { snapshot: string; message: TestMessage }) {
  useCoAgentStateRender<{ current_step?: string }>({
    name: "test-agent",
    render: ({ state }) => <div data-testid="state">{state.current_step ?? "none"}</div>,
  });

  return (
    <CoAgentStateRenderBridge
      agentId="test-agent"
      message={message}
      position="after"
      runId="run-early"
      messageIndex={0}
      messageIndexInRun={0}
      numberOfMessagesInRun={1}
      stateSnapshot={snapshot}
    />
  );
}

function LiveStateHarness({ message }: { message: Pick<TestMessage, "id" | "role"> }) {
  useCoAgentStateRender<{ current_step?: string }>({
    name: "test-agent",
    render: ({ state }) => <div data-testid="state">{state.current_step ?? "none"}</div>,
  });

  return (
    <CoAgentStateRenderBridge
      agentId="test-agent"
      message={message}
      position="after"
      runId="run-live"
      messageIndex={0}
      messageIndexInRun={0}
      numberOfMessagesInRun={1}
      stateSnapshot={undefined}
    />
  );
}

function NonFirstMessageHarness({ snapshot }: { snapshot: string }) {
  useCoAgentStateRender<{ current_step?: string }>({
    name: "test-agent",
    render: ({ state }) => <div data-testid="state">{state.current_step ?? "none"}</div>,
  });

  return (
    <CoAgentStateRenderBridge
      agentId="test-agent"
      message={{ id: "msg-second", role: "assistant", content: "" }}
      position="after"
      runId="run-non-first"
      messageIndex={1}
      messageIndexInRun={1}
      numberOfMessagesInRun={2}
      stateSnapshot={snapshot}
    />
  );
}

function MultiRunHarness({
  snapshot,
  runId,
  messageId,
  messageIndex,
}: {
  snapshot: string;
  runId: string;
  messageId: string;
  messageIndex: number;
}) {
  useCoAgentStateRender<{ current_step?: string }>({
    name: "test-agent",
    render: ({ state }) => <div data-testid="state">{state.current_step ?? "none"}</div>,
  });

  return (
    <CoAgentStateRenderBridge
      agentId="test-agent"
      message={{ id: messageId, role: "assistant", content: "" }}
      position="after"
      runId={runId}
      messageIndex={messageIndex}
      messageIndexInRun={0}
      numberOfMessagesInRun={1}
      stateSnapshot={snapshot}
    />
  );
}

function ClaimsObserver({ onChange }: { onChange: (claims: Record<string, Claim>) => void }) {
  const { claimsRef } = useCoAgentStateRenders();
  React.useEffect(() => {
    onChange(claimsRef.current as Record<string, Claim>);
  });
  return null;
}

function ChatHarness({ tick }: { tick: number }) {
  useCoAgentStateRender<{ current_step?: string }>({
    name: "test-agent",
    render: ({ state }) => <div data-testid="state">{state.current_step ?? "none"}</div>,
  });

  const { messages } = useCopilotChatInternal();

  return (
    <>
      {messages.map((message) =>
        message.generativeUI ? (
          <div key={message.id} data-testid={`message-${message.id}`}>
            {message.generativeUI()}
          </div>
        ) : null,
      )}
      <div data-testid="tick">{tick}</div>
    </>
  );
}

describe("useCoAgentStateRender", () => {
  beforeEach(() => {
    lastSubscriber = null;
    mockAgent.state = {};
    mockAgent.messages = [];
    mockAgent.subscribe.mockImplementation((subscriber: TestAgentSubscriber) => {
      lastSubscriber = subscriber;
      return { unsubscribe: jest.fn() };
    });
  });

  it("re-renders when state snapshots change", async () => {
    const copilotContextValue = createTestCopilotContext();

    const { rerender } = render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <TestHarness snapshot={JSON.stringify({ current_step: "Processing..." })} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Processing...");
    });

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <TestHarness snapshot={JSON.stringify({ current_step: "Thinking..." })} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Thinking...");
    });
  });

  it("renders snapshots that arrive before assistant text", async () => {
    const copilotContextValue = createTestCopilotContext();

    const baseMessage = { id: "msg-early", role: "assistant", content: "" };

    const { rerender } = render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <SnapshotHarness
            message={baseMessage}
            snapshot={JSON.stringify({ current_step: "Processing..." })}
          />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Processing...");
    });

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <SnapshotHarness
            message={baseMessage}
            snapshot={JSON.stringify({ current_step: "Thinking..." })}
          />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Thinking...");
    });

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <SnapshotHarness
            message={{ ...baseMessage, content: "Hello" }}
            snapshot={JSON.stringify({ current_step: "Finalizing..." })}
          />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Finalizing...");
    });
  });

  it("re-renders from live agent state updates", async () => {
    const copilotContextValue = createTestCopilotContext();

    render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <LiveStateHarness message={{ id: "msg-live", role: "assistant" }} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    mockAgent.state = { current_step: "Processing..." };
    act(() => {
      lastSubscriber?.onStateChanged?.({ state: mockAgent.state });
    });

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Processing...");
    });

    mockAgent.state = { current_step: "Thinking..." };
    act(() => {
      lastSubscriber?.onStateChanged?.({ state: mockAgent.state });
    });

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Thinking...");
    });
  });

  it("renders state snapshots before any assistant message exists", async () => {
    const copilotContextValue = createTestCopilotContext({
      threadId: "thread-1",
      agentSession: null,
    });

    mockAgent.messages = [{ id: "msg-user-1", role: "user", content: "Hi" }];
    mockAgent.isRunning = false;
    mockAgent.state = {};

    const { rerender } = render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    const placeholderTestId = "message-coagent-state-render-test-agent-pending:msg-user-1";
    expect(screen.queryByTestId(placeholderTestId)).toBeNull();

    mockAgent.isRunning = true;
    mockAgent.state = { current_step: "Processing..." };

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={1} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Processing...");
    });

    expect(screen.getByTestId(placeholderTestId)).toBeTruthy();

    const placeholderStep = screen.getByTestId("state").textContent;

    mockAgent.isRunning = false;
    mockAgent.state = {};
    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
    ];

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={2} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId(placeholderTestId)).toBeNull();
      expect(screen.getByTestId("message-msg-assistant-1")).toBeTruthy();
      expect(screen.getByTestId("state").textContent).toBe("none");
    });
  });

  it("does not render placeholder until the agent is running or has state", async () => {
    const copilotContextValue = createTestCopilotContext({
      threadId: "thread-1",
      agentSession: null,
    });

    mockAgent.messages = [{ id: "msg-user-1", role: "user", content: "Hi" }];
    mockAgent.isRunning = false;
    mockAgent.state = {};

    render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId("message-coagent-state-render-test-agent-pending:msg-user-1"),
      ).toBeNull();
    });
  });

  it("renders for non-first messages in a run", async () => {
    const copilotContextValue = createTestCopilotContext();

    render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <NonFirstMessageHarness snapshot={JSON.stringify({ current_step: "Processing..." })} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Processing...");
    });
  });

  it("falls back to legacy renderer when renderCustomMessages throws", async () => {
    const { useRenderCustomMessages } = jest.requireMock("@copilotkitnext/react");
    useRenderCustomMessages.mockImplementationOnce(() => () => {
      throw new Error("boom");
    });

    const copilotContextValue = createTestCopilotContext({
      threadId: "thread-1",
      agentSession: null,
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
    ];
    mockAgent.isRunning = true;
    mockAgent.state = { current_step: "Processing..." };

    render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Processing...");
    });
  });

  it("prefers legacy renderer over renderCustomMessages when both exist", async () => {
    const { useRenderCustomMessages } = jest.requireMock("@copilotkitnext/react");
    const renderCustomSpy = jest.fn(() => null);
    useRenderCustomMessages.mockImplementationOnce(() => renderCustomSpy);

    const copilotContextValue = createTestCopilotContext({
      threadId: "thread-1",
      agentSession: null,
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
    ];
    mockAgent.isRunning = true;
    mockAgent.state = { current_step: "Processing..." };

    render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Processing...");
    });

    expect(renderCustomSpy).not.toHaveBeenCalled();
  });

  it("renders empty state when agent state clears after completion", async () => {
    const copilotContextValue = createTestCopilotContext({
      threadId: "thread-1",
      agentSession: null,
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
    ];
    mockAgent.isRunning = true;
    mockAgent.state = { current_step: "Processing..." };

    const { rerender } = render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Processing...");
    });

    mockAgent.isRunning = false;
    mockAgent.state = {};

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={1} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("none");
    });
  });

  it("allows independent renders across different runs with the same snapshot", async () => {
    const copilotContextValue = createTestCopilotContext();

    const snapshot = JSON.stringify({ current_step: "Processing..." });

    render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <MultiRunHarness snapshot={snapshot} runId="run-1" messageId="msg-1" messageIndex={0} />
          <MultiRunHarness snapshot={snapshot} runId="run-2" messageId="msg-2" messageIndex={1} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      const nodes = screen.getAllByTestId("state");
      expect(nodes).toHaveLength(2);
      expect(nodes[0].textContent).toBe("Processing...");
      expect(nodes[1].textContent).toBe("Processing...");
    });
  });

  it("lets newer assistant messages claim even if snapshot matches", async () => {
    const copilotContextValue = createTestCopilotContext();

    const snapshot = JSON.stringify({ current_step: "Processing..." });

    render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <MultiRunHarness snapshot={snapshot} runId="run-1" messageId="msg-1" messageIndex={0} />
          <MultiRunHarness snapshot={snapshot} runId="run-1" messageId="msg-2" messageIndex={1} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      const nodes = screen.getAllByTestId("state");
      expect(nodes).toHaveLength(2);
      expect(nodes[0].textContent).toBe("Processing...");
      expect(nodes[1].textContent).toBe("Processing...");
    });
  });

  it("locks older claims when a newer message claims", async () => {
    const copilotContextValue = createTestCopilotContext();

    const snapshot = JSON.stringify({ current_step: "Processing..." });
    let latestClaims: Record<string, Claim> = {};

    render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ClaimsObserver onChange={(claims) => (latestClaims = claims)} />
          <MultiRunHarness snapshot={snapshot} runId="run-1" messageId="msg-1" messageIndex={0} />
          <MultiRunHarness snapshot={snapshot} runId="run-1" messageId="msg-2" messageIndex={1} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(latestClaims["msg-1"]).toBeTruthy();
      expect(latestClaims["msg-2"]).toBeTruthy();
      expect(latestClaims["msg-1"].locked).toBe(true);
    });
  });

  it("keeps older message snapshots stable when a new run starts", async () => {
    const copilotContextValue = createTestCopilotContext();

    const snapshot = JSON.stringify({ current_step: "Processing..." });
    let latestClaims: Record<string, Claim> = {};

    const { rerender } = render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ClaimsObserver onChange={(claims) => (latestClaims = claims)} />
          <MultiRunHarness snapshot={snapshot} runId="run-1" messageId="msg-1" messageIndex={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(latestClaims["msg-1"]?.stateSnapshot?.current_step).toBe("Processing...");
    });

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ClaimsObserver onChange={(claims) => (latestClaims = claims)} />
          <MultiRunHarness snapshot={snapshot} runId="run-1" messageId="msg-1" messageIndex={0} />
          <MultiRunHarness snapshot={snapshot} runId="run-2" messageId="msg-2" messageIndex={1} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(latestClaims["msg-1"]?.stateSnapshot?.current_step).toBe("Processing...");
      expect(latestClaims["msg-2"]?.stateSnapshot?.current_step).toBe("Processing...");
    });
  });

  it("does not overwrite a previous run snapshot when a new run has different state", async () => {
    const copilotContextValue = createTestCopilotContext();

    const snapshotRun1 = JSON.stringify({ current_step: "Processing..." });
    const snapshotRun2 = JSON.stringify({ current_step: "Finalizing..." });
    let latestClaims: Record<string, Claim> = {};

    const { rerender } = render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ClaimsObserver onChange={(claims) => (latestClaims = claims)} />
          <MultiRunHarness
            snapshot={snapshotRun1}
            runId="run-1"
            messageId="msg-1"
            messageIndex={0}
          />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(latestClaims["msg-1"]?.stateSnapshot?.current_step).toBe("Processing...");
    });

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ClaimsObserver onChange={(claims) => (latestClaims = claims)} />
          <MultiRunHarness
            snapshot={snapshotRun1}
            runId="run-1"
            messageId="msg-1"
            messageIndex={0}
          />
          <MultiRunHarness
            snapshot={snapshotRun2}
            runId="run-2"
            messageId="msg-2"
            messageIndex={1}
          />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(latestClaims["msg-1"]?.stateSnapshot?.current_step).toBe("Processing...");
      expect(latestClaims["msg-2"]?.stateSnapshot?.current_step).toBe("Finalizing...");
    });
  });

  it("locks a claim when newer agent messages exist", async () => {
    const copilotContextValue = createTestCopilotContext();

    const snapshot = JSON.stringify({ current_step: "Processing..." });
    let latestClaims: Record<string, Claim> = {};

    mockAgent.messages = [
      { id: "msg-1", role: "assistant", content: "" },
      { id: "msg-2", role: "assistant", content: "" },
    ];

    render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ClaimsObserver onChange={(claims) => (latestClaims = claims)} />
          <MultiRunHarness snapshot={snapshot} runId="run-1" messageId="msg-1" messageIndex={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(latestClaims["msg-1"]).toBeTruthy();
      expect(latestClaims["msg-1"].locked).toBe(true);
    });
  });

  it("does not update a locked claim from new agent state", async () => {
    const copilotContextValue = createTestCopilotContext({
      threadId: "thread-1",
      agentSession: null,
    });

    let latestClaims: Record<string, Claim> = {};
    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
    ];
    mockAgent.isRunning = true;
    mockAgent.state = { current_step: "First" };

    const { rerender } = render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ClaimsObserver onChange={(claims) => (latestClaims = claims)} />
          <ChatHarness tick={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(latestClaims["msg-assistant-1"]?.stateSnapshot?.current_step).toBe("First");
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
      { id: "msg-user-2", role: "user", content: "Next" },
    ];
    mockAgent.state = { current_step: "Second" };

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ClaimsObserver onChange={(claims) => (latestClaims = claims)} />
          <ChatHarness tick={1} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(latestClaims["msg-assistant-1"]?.stateSnapshot?.current_step).toBe("First");
    });
  });

  it("renders new run snapshots instead of reusing the previous run state", async () => {
    const copilotContextValue = createTestCopilotContext({
      threadId: "thread-1",
      agentSession: null,
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
    ];
    mockAgent.isRunning = true;
    mockAgent.state = { current_step: "First run" };

    const { rerender } = render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("First run");
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
      { id: "msg-user-2", role: "user", content: "Next" },
    ];
    mockAgent.isRunning = true;
    mockAgent.state = { current_step: "Second run" };

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={1} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      const stateNodes = screen.getAllByTestId("state");
      const values = stateNodes.map((node) => node.textContent);
      expect(values).toContain("Second run");
    });
  });

  it("does not reuse latest cached snapshot for a new run placeholder before snapshots arrive", async () => {
    const copilotContextValue = createTestCopilotContext({
      threadId: "thread-1",
      agentSession: null,
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
    ];
    mockAgent.isRunning = true;
    mockAgent.state = { current_step: "First run" };

    const { rerender } = render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("First run");
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
      { id: "msg-user-2", role: "user", content: "Next" },
    ];
    mockAgent.isRunning = true;
    mockAgent.state = {};

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={1} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      const placeholder = screen.getByTestId(
        "message-coagent-state-render-test-agent-pending:msg-user-2",
      );
      expect(placeholder.textContent).toContain("none");
    });
  });

  it("does not show the previous snapshot for a new assistant message before its snapshot arrives", async () => {
    const copilotContextValue = createTestCopilotContext({
      threadId: "thread-1",
      agentSession: null,
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
    ];
    mockAgent.isRunning = true;
    mockAgent.state = { current_step: "First run" };

    const { rerender } = render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      const message = screen.getByTestId("message-msg-assistant-1");
      expect(within(message).getByTestId("state").textContent).toBe("First run");
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
      { id: "msg-user-2", role: "user", content: "Next" },
      { id: "msg-assistant-2", role: "assistant", content: "" },
    ];
    mockAgent.isRunning = true;
    mockAgent.state = {};

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={1} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      const message = screen.getByTestId("message-msg-assistant-2");
      expect(within(message).getByTestId("state").textContent).toBe("none");
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
      { id: "msg-user-2", role: "user", content: "Next" },
      { id: "msg-assistant-2", role: "assistant", content: "", state: "{\"current_step\":\"Second run\"}" },
    ];

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={2} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      const message = screen.getByTestId("message-msg-assistant-2");
      expect(within(message).getByTestId("state").textContent).toBe("Second run");
    });
  });

  it("does not show previous live state for a new run before the run updates state", async () => {
    const copilotContextValue = createTestCopilotContext({
      threadId: "thread-1",
      agentSession: null,
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
    ];
    mockAgent.isRunning = true;
    mockAgent.state = { current_step: "First run" };

    const { rerender } = render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      const message = screen.getByTestId("message-msg-assistant-1");
      expect(within(message).getByTestId("state").textContent).toBe("First run");
    });

    mockAgent.messages = [
      { id: "msg-user-1", role: "user", content: "Hi" },
      { id: "msg-assistant-1", role: "assistant", content: "" },
      { id: "msg-user-2", role: "user", content: "Next" },
      { id: "msg-assistant-2", role: "assistant", content: "" },
    ];
    mockAgent.isRunning = true;
    // live state still shows the previous run
    mockAgent.state = { current_step: "First run" };

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={1} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      const message = screen.getByTestId("message-msg-assistant-2");
      expect(within(message).getByTestId("state").textContent).toBe("none");
    });

    mockAgent.state = { current_step: "Second run" };
    act(() => {
      lastSubscriber?.onStateChanged?.({ state: mockAgent.state });
    });

    await waitFor(() => {
      const message = screen.getByTestId("message-msg-assistant-2");
      expect(within(message).getByTestId("state").textContent).toBe("Second run");
    });
  });

  it("renders an explicit empty state snapshot", async () => {
    const copilotContextValue = createTestCopilotContext({
      threadId: "thread-1",
      agentSession: null,
    });

    mockAgent.messages = [
      {
        id: "msg-user-1",
        role: "user",
        content: "Hi",
      },
      {
        id: "msg-assistant-1",
        role: "assistant",
        content: "",
        state: "{\"current_step\":\"Processing...\"}",
      },
    ];
    mockAgent.isRunning = true;
    mockAgent.state = { current_step: "Processing..." };

    const { rerender } = render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={0} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      const message = screen.getByTestId("message-msg-assistant-1");
      expect(within(message).getByTestId("state").textContent).toBe("Processing...");
    });

    mockAgent.messages = [
      {
        id: "msg-user-1",
        role: "user",
        content: "Hi",
      },
      {
        id: "msg-assistant-1",
        role: "assistant",
        content: "",
        state: "{}",
      },
    ];

    rerender(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <ChatHarness tick={1} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      const message = screen.getByTestId("message-msg-assistant-1");
      expect(within(message).getByTestId("state").textContent).toBe("none");
    });
  });

  it("renders an empty live state update", async () => {
    const copilotContextValue = createTestCopilotContext();

    render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <LiveStateHarness message={{ id: "msg-live-empty", role: "assistant" }} />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    mockAgent.state = { current_step: "Processing..." };
    act(() => {
      lastSubscriber?.onStateChanged?.({ state: mockAgent.state });
    });

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("Processing...");
    });

    mockAgent.state = {};
    act(() => {
      lastSubscriber?.onStateChanged?.({ state: mockAgent.state });
    });

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("none");
    });
  });
});
