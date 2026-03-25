import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AbstractAgent,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useAgent } from "../use-agent";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkitnext/core";
import { Observable } from "rxjs";

vi.mock("@/providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

/**
 * A minimal mock agent whose clone() returns a NEW instance (unlike
 * MockStepwiseAgent which returns `this`). This is essential for testing
 * per-thread isolation — each clone must be a distinct object.
 */
class CloneableAgent extends AbstractAgent {
  clone(): CloneableAgent {
    const cloned = new CloneableAgent();
    cloned.agentId = this.agentId;
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

    // Add a message to thread A
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
