import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useCoAgentStateRender } from "../use-coagent-state-render";
import { CoAgentStateRenderBridge } from "../use-coagent-state-render-bridge";
import {
  CoAgentStateRendersProvider,
  CopilotContext,
  type CopilotContextParams,
} from "../../context";

const mockAgent = {
  state: {},
  isRunning: true,
  subscribe: jest.fn(),
};

let lastSubscriber: any = null;

jest.mock("@copilotkitnext/react", () => ({
  useAgent: jest.fn(() => ({ agent: mockAgent })),
}));

jest.mock("../../components/toast/toast-provider", () => ({
  useToast: () => ({
    setBannerError: jest.fn(),
    addToast: jest.fn(),
  }),
}));

function TestHarness({ snapshot }: { snapshot: string }) {
  useCoAgentStateRender<{ current_step?: string }>({
    name: "test-agent",
    render: ({ state }) => (
      <div data-testid="state">{state.current_step ?? "none"}</div>
    ),
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

function SnapshotHarness({
  snapshot,
  message,
}: {
  snapshot: string;
  message: { id: string; role: string; content?: string };
}) {
  useCoAgentStateRender<{ current_step?: string }>({
    name: "test-agent",
    render: ({ state }) => (
      <div data-testid="state">{state.current_step ?? "none"}</div>
    ),
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

function LiveStateHarness({ message }: { message: { id: string; role: string } }) {
  useCoAgentStateRender<{ current_step?: string }>({
    name: "test-agent",
    render: ({ state }) => (
      <div data-testid="state">{state.current_step ?? "none"}</div>
    ),
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

describe("useCoAgentStateRender", () => {
  beforeEach(() => {
    lastSubscriber = null;
    mockAgent.state = {};
    mockAgent.subscribe.mockImplementation((subscriber: any) => {
      lastSubscriber = subscriber;
      return { unsubscribe: jest.fn() };
    });
  });

  it("re-renders when state snapshots change", async () => {
    const copilotContextValue = {
      chatComponentsCache: { current: { actions: {}, coAgentStateRenders: {} } },
      availableAgents: [],
    } as CopilotContextParams;

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
    const copilotContextValue = {
      chatComponentsCache: { current: { actions: {}, coAgentStateRenders: {} } },
      availableAgents: [],
    } as CopilotContextParams;

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
    const copilotContextValue = {
      chatComponentsCache: { current: { actions: {}, coAgentStateRenders: {} } },
      availableAgents: [],
    } as CopilotContextParams;

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
});
