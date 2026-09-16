import { vi } from "vitest";
import React from "react";
import { act, render } from "@testing-library/react";
import type { AgentSubscriber } from "@ag-ui/client";
import { useAgentNodeName } from "../use-agent-nodename";
import { useLangGraphInterrupt } from "../use-langgraph-interrupt";

// The one subscriber the hook under test registers, captured so tests can
// drive AG-UI events without a live agent.
let subscriber: AgentSubscriber | null = null;
const unsubscribe = vi.fn();

const mockAgent = {
  subscribe: vi.fn((s: AgentSubscriber) => {
    subscriber = s;
    return { unsubscribe };
  }),
};

// Captured from the `useInterrupt` call `useLangGraphInterrupt` makes.
let interruptArgs: any = null;

vi.mock("../../../v2", () => ({
  useAgent: vi.fn(() => ({ agent: mockAgent })),
  useInterrupt: vi.fn((args: any) => {
    interruptArgs = args;
  }),
  useCopilotChatConfiguration: vi.fn(() => ({
    agentId: "default",
    threadId: "thread-1",
  })),
}));

function emitStepStarted(stepName: string) {
  subscriber?.onStepStartedEvent?.({ event: { stepName } } as any);
}

function emitRunFinished(outcome: "success" | "interrupt") {
  subscriber?.onRunFinishedEvent?.({
    outcome,
  } as any);
}

beforeEach(() => {
  subscriber = null;
  interruptArgs = null;
  vi.clearAllMocks();
});

describe("useAgentNodeName", () => {
  it("re-renders consumers on every node transition", () => {
    const renderedNodeNames: string[] = [];

    const Component: React.FC = () => {
      renderedNodeNames.push(useAgentNodeName("default"));
      return null;
    };

    render(<Component />);

    // Nothing else here triggers a render, so every entry after the first
    // exists only because the node change itself scheduled one.
    act(() => emitStepStarted("call_model_node"));
    act(() => emitStepStarted("process_feedback_node"));
    act(() => emitRunFinished("success"));

    expect(renderedNodeNames).toEqual([
      "start",
      "call_model_node",
      "process_feedback_node",
      "end",
    ]);
  });

  it("reports 'end' when a run errors", () => {
    const renderedNodeNames: string[] = [];
    const Component: React.FC = () => {
      renderedNodeNames.push(useAgentNodeName("default"));
      return null;
    };

    render(<Component />);
    act(() => emitStepStarted("call_model_node"));
    act(() => {
      subscriber?.onRunErrorEvent?.({} as any);
    });

    expect(renderedNodeNames.at(-1)).toBe("end");
  });

  it("resets to 'start' when a new run begins", () => {
    const renderedNodeNames: string[] = [];
    const Component: React.FC = () => {
      renderedNodeNames.push(useAgentNodeName("default"));
      return null;
    };

    render(<Component />);
    act(() => emitStepStarted("call_model_node"));
    expect(renderedNodeNames.at(-1)).toBe("call_model_node");

    act(() => {
      subscriber?.onRunStartedEvent?.({} as any);
    });
    expect(renderedNodeNames.at(-1)).toBe("start");
  });

  it("keeps the active node after a standard interrupt", () => {
    const renderedNodeNames: string[] = [];
    const Component: React.FC = () => {
      renderedNodeNames.push(useAgentNodeName("default"));
      return null;
    };

    render(<Component />);
    act(() => emitStepStarted("process_feedback_node"));
    act(() => emitRunFinished("interrupt"));

    expect(renderedNodeNames.at(-1)).toBe("process_feedback_node");
  });

  it("keeps the active node after a legacy interrupt", () => {
    const renderedNodeNames: string[] = [];
    const Component: React.FC = () => {
      renderedNodeNames.push(useAgentNodeName("default"));
      return null;
    };

    render(<Component />);
    act(() => emitStepStarted("process_feedback_node"));
    act(() => {
      subscriber?.onCustomEvent?.({
        event: {
          name: "on_interrupt",
          value: { question: "Continue?" },
        },
      } as any);
    });
    act(() => emitRunFinished("success"));

    expect(renderedNodeNames.at(-1)).toBe("process_feedback_node");
  });

  it("unsubscribes on unmount", () => {
    const Component: React.FC = () => {
      useAgentNodeName("default");
      return null;
    };

    const { unmount } = render(<Component />);
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("useLangGraphInterrupt agentMetadata", () => {
  // Regression coverage for #1426: RUN_FINISHED must not replace the active
  // node with "end" before the enabled predicate reads agent metadata.
  it("carries the agent, thread, and current node", () => {
    let captured: any = null;

    const Component: React.FC = () => {
      useLangGraphInterrupt({
        enabled: ({ agentMetadata }) => {
          captured = agentMetadata;
          return true;
        },
        render: () => "interrupt",
      });
      return null;
    };

    render(<Component />);

    act(() => emitStepStarted("process_feedback_node"));
    act(() => emitRunFinished("interrupt"));
    act(() => {
      interruptArgs.enabled({ value: {} });
    });

    expect(captured).toEqual({
      agentName: "default",
      threadId: "thread-1",
      nodeName: "process_feedback_node",
    });
  });
});
