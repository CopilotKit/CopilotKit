import React from "react";
import { render } from "@testing-library/react";
import { renderHook } from "../../../test-helpers/render-hook";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AbstractAgent,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import { useAgent } from "../use-agent";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { Observable } from "rxjs";

vi.mock("../../providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

/**
 * A minimal mock agent whose clone() returns a NEW instance and copies
 * messages from the source. This is essential for testing per-thread
 * isolation — each clone must be a distinct object that starts with the
 * source's state so that cloneForThread's setMessages([]) / setState({})
 * calls are meaningful (not vacuously true on an already-empty clone).
 */
class CloneableAgent extends AbstractAgent {
  clone(): CloneableAgent {
    const cloned = new CloneableAgent();
    cloned.agentId = this.agentId;
    // Copy messages so cloneForThread's setMessages([]) actually clears state
    cloned.setMessages([...this.messages]);
    return cloned;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable();
  }
}

describe("useAgent thread isolation", () => {
  let mockCopilotkit: {
    getAgent: ReturnType<typeof vi.fn>;
    runtimeUrl: string | undefined;
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
    runtimeTransport: string;
    headers: Record<string, string>;
    agents: Record<string, AbstractAgent>;
    subscribeToAgentWithOptions: (
      agent: AbstractAgent,
      subscriber: any,
    ) => { unsubscribe: () => void };
  };

  let registeredAgent: CloneableAgent;

  beforeEach(() => {
    registeredAgent = new CloneableAgent();
    registeredAgent.agentId = "my-agent";

    mockCopilotkit = {
      getAgent: vi.fn((id: string) =>
        id === "my-agent" ? registeredAgent : undefined,
      ),
      runtimeUrl: "http://localhost:3000/api/copilotkit",
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      runtimeTransport: "rest",
      headers: {},
      agents: { "my-agent": registeredAgent },
      subscribeToAgentWithOptions: (agent, subscriber) =>
        agent.subscribe(subscriber),
    };

    mockUseCopilotKit.mockReturnValue({
      copilotkit: mockCopilotkit,
      executingToolCallIds: new Set(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns different agent instances for different threadIds with the same agentId", () => {
    const agents: Record<string, AbstractAgent> = {};

    function TrackerA() {
      const { agent } = useAgent({ agentId: "my-agent", threadId: "thread-a" });
      agents["a"] = agent;
      return null;
    }

    function TrackerB() {
      const { agent } = useAgent({ agentId: "my-agent", threadId: "thread-b" });
      agents["b"] = agent;
      return null;
    }

    render(
      <>
        <TrackerA />
        <TrackerB />
      </>,
    );

    expect(agents["a"]).toBeDefined();
    expect(agents["b"]).toBeDefined();
    expect(agents["a"]).not.toBe(agents["b"]);
  });

  it("returns the same cached instance for the same (agentId, threadId) across re-renders", () => {
    const instances: AbstractAgent[] = [];

    function Tracker() {
      const { agent } = useAgent({ agentId: "my-agent", threadId: "thread-x" });
      instances.push(agent);
      return null;
    }

    const { rerender } = render(<Tracker />);
    rerender(<Tracker />);

    expect(instances.length).toBe(2);
    expect(instances[0]).toBe(instances[1]);
  });

  it("returns the shared registry agent when no threadId is provided (backward compat)", () => {
    let captured: AbstractAgent | undefined;

    function Tracker() {
      const { agent } = useAgent({ agentId: "my-agent" });
      captured = agent;
      return null;
    }

    render(<Tracker />);
    expect(captured).toBe(registeredAgent);
  });

  it("isolates messages between thread-specific agents", () => {
    // Pre-populate the source agent so CloneableAgent.clone() copies the
    // message into each clone — this makes cloneForThread's setMessages([])
    // meaningful rather than vacuously true on an already-empty clone.
    registeredAgent.addMessage({
      id: "source-msg",
      role: "user",
      content: "pre-existing on source",
    });

    const agents: Record<string, AbstractAgent> = {};

    function TrackerA() {
      const { agent } = useAgent({ agentId: "my-agent", threadId: "thread-a" });
      agents["a"] = agent;
      return null;
    }

    function TrackerB() {
      const { agent } = useAgent({ agentId: "my-agent", threadId: "thread-b" });
      agents["b"] = agent;
      return null;
    }

    render(
      <>
        <TrackerA />
        <TrackerB />
      </>,
    );

    // Both clones should start empty even though the source had a message —
    // cloneForThread must have called setMessages([]) on each clone.
    expect(agents["a"]!.messages).toHaveLength(0);
    expect(agents["b"]!.messages).toHaveLength(0);

    // Adding a message to thread A must not affect thread B
    agents["a"]!.addMessage({
      id: "msg-1",
      role: "user",
      content: "hello from thread A",
    });

    expect(agents["a"]!.messages).toHaveLength(1);
    expect(agents["b"]!.messages).toHaveLength(0);
  });

  it("sets threadId on cloned agents", () => {
    const agents: Record<string, AbstractAgent> = {};

    function TrackerA() {
      const { agent } = useAgent({ agentId: "my-agent", threadId: "thread-a" });
      agents["a"] = agent;
      return null;
    }

    function TrackerB() {
      const { agent } = useAgent({ agentId: "my-agent", threadId: "thread-b" });
      agents["b"] = agent;
      return null;
    }

    render(
      <>
        <TrackerA />
        <TrackerB />
      </>,
    );

    expect(agents["a"]!.threadId).toBe("thread-a");
    expect(agents["b"]!.threadId).toBe("thread-b");
  });

  it("invalidates stale clone when the registry agent is replaced", () => {
    // Simulates reconnect / hot-reload: copilotkit.agents holds a new object.
    const { result, rerender } = renderHook(
      ({ tid }: { tid: string }) =>
        useAgent({ agentId: "my-agent", threadId: tid }),
      { initialProps: { tid: "thread-a" } },
    );

    const firstClone = result.current.agent;
    expect(firstClone).not.toBe(registeredAgent); // it's a clone

    // Replace the registry agent
    const replacementAgent = new CloneableAgent();
    replacementAgent.agentId = "my-agent";

    mockCopilotkit.agents = { "my-agent": replacementAgent };
    mockCopilotkit.getAgent.mockImplementation((id: string) =>
      id === "my-agent" ? replacementAgent : undefined,
    );
    mockUseCopilotKit.mockReturnValue({
      copilotkit: { ...mockCopilotkit },
      executingToolCallIds: new Set(),
    });

    rerender({ tid: "thread-a" });

    const secondClone = result.current.agent;
    expect(secondClone).not.toBe(firstClone); // stale clone was invalidated
    expect(secondClone).not.toBe(replacementAgent); // still a clone, not the source
  });

  it("switching threadId returns a fresh clone; switching back returns the cached one", () => {
    const { result, rerender } = renderHook(
      ({ tid }: { tid: string }) =>
        useAgent({ agentId: "my-agent", threadId: tid }),
      { initialProps: { tid: "thread-a" } },
    );

    const cloneA = result.current.agent;

    rerender({ tid: "thread-b" });
    const cloneB = result.current.agent;
    expect(cloneB).not.toBe(cloneA);

    // Switching back to thread-a should return the originally cached clone
    rerender({ tid: "thread-a" });
    expect(result.current.agent).toBe(cloneA);
  });

  it("uses a fresh clone with correct threadId when provisional transitions to real agent", () => {
    // Start in Disconnected state — a provisional is created
    mockCopilotkit.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Disconnected;
    mockCopilotkit.getAgent.mockReturnValue(undefined);
    mockCopilotkit.agents = {};
    mockUseCopilotKit.mockReturnValue({
      copilotkit: { ...mockCopilotkit },
      executingToolCallIds: new Set(),
    });

    const { result, rerender } = renderHook(() =>
      useAgent({ agentId: "my-agent", threadId: "thread-a" }),
    );

    const provisional = result.current.agent;
    expect(provisional.threadId).toBe("thread-a");

    // Real agent appears (runtime connected and agent registered)
    mockCopilotkit.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connected;
    mockCopilotkit.getAgent.mockImplementation((id: string) =>
      id === "my-agent" ? registeredAgent : undefined,
    );
    mockCopilotkit.agents = { "my-agent": registeredAgent };
    mockUseCopilotKit.mockReturnValue({
      copilotkit: { ...mockCopilotkit },
      executingToolCallIds: new Set(),
    });

    rerender();

    const realClone = result.current.agent;
    expect(realClone).not.toBe(provisional); // provisional replaced by real clone
    expect(realClone).not.toBe(registeredAgent); // it's a clone, not the source
    expect(realClone.threadId).toBe("thread-a");
  });

  it("uses composite key for provisional agents when threadId is provided", () => {
    // Put runtime in Disconnected state so provisionals are created
    mockCopilotkit.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Disconnected;
    mockCopilotkit.getAgent.mockReturnValue(undefined);
    mockCopilotkit.agents = {};

    const agents: Record<string, AbstractAgent> = {};

    function TrackerA() {
      const { agent } = useAgent({ agentId: "my-agent", threadId: "thread-a" });
      agents["a"] = agent;
      return null;
    }

    function TrackerB() {
      const { agent } = useAgent({ agentId: "my-agent", threadId: "thread-b" });
      agents["b"] = agent;
      return null;
    }

    render(
      <>
        <TrackerA />
        <TrackerB />
      </>,
    );

    expect(agents["a"]).not.toBe(agents["b"]);
    expect(agents["a"]!.threadId).toBe("thread-a");
    expect(agents["b"]!.threadId).toBe("thread-b");
  });
});
