import React from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { useCopilotKit } from "../v2/context";
import { useAgent } from "../v2/hooks/use-agent";
import { CopilotChatConfigurationProvider } from "../v2/providers/CopilotChatConfigurationProvider";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";

vi.mock("../v2/context", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

/**
 * Contract-level regression coverage for the threadId-propagation invariant.
 *
 * Lives at the package root (src/__tests__) rather than next to any one
 * implementation site on purpose: the previous regression (issue #5041, root
 * cause shared with #4739) slipped through because the original coverage
 * (use-agent-thread-isolation.test.tsx, 333 lines) lived next to the
 * per-thread-cloning feature and was deleted alongside it in May 2026 when
 * cloning was reverted. The threadId-propagation invariant survived the
 * feature change but its tests didn't.
 *
 * The invariant under test: a caller-supplied threadId (via <CopilotKit>,
 * <ThreadsProvider>, or <CopilotChatConfigurationProvider>) MUST end up on
 * the underlying agent's `threadId` field, because ProxiedCopilotRuntimeAgent
 * uses that field to address /agent/run, /agent/connect, /agent/stop. Without
 * it the agent ships its own auto-minted UUID and the backend sees a different
 * thread than the app code reads via useThreads/useCopilotChatConfiguration.
 *
 * This file should outlive any specific implementation strategy (cloning,
 * effect-based sync, prop drilling, context bridge). If you change the
 * mechanism, keep this contract.
 */
describe("useAgent → agent.threadId sync from chat configuration", () => {
  let mockCopilotkit: {
    getAgent: ReturnType<typeof vi.fn>;
    runtimeUrl: string | undefined;
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
    runtimeTransport: string;
    headers: Record<string, string>;
    agents: Record<string, AbstractAgent>;
    applyHeadersToAgent: (agent: AbstractAgent) => void;
    subscribeToAgentWithOptions: (
      agent: AbstractAgent,
      subscriber: any,
    ) => { unsubscribe: () => void };
  };

  beforeEach(() => {
    mockCopilotkit = {
      getAgent: vi.fn(() => undefined),
      runtimeUrl: "http://localhost:3000/api/copilotkit",
      runtimeConnectionStatus:
        CopilotKitCoreRuntimeConnectionStatus.Disconnected,
      runtimeTransport: "rest",
      headers: {},
      agents: {},
      // Additive stand-in for core's merge (core headers ON TOP of the
      // agent's own). These tests only assert threadId propagation and never
      // remove a header, so this approximation is sufficient; it does NOT
      // model core's frozen construction-time baseline.
      applyHeadersToAgent: (agent) => {
        const target = agent as { headers?: Record<string, string> };
        if (target.headers) {
          target.headers = { ...target.headers, ...mockCopilotkit.headers };
        }
      },
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

  it("sets agent.threadId from CopilotChatConfigurationProvider when explicit", () => {
    // The agent's threadId is mutable state outside React's render tracking,
    // so we assert against the captured reference rather than rendered DOM —
    // mutating agent.threadId after commit doesn't trigger a re-render, but
    // downstream consumers (HTTP run/connect/stop, syncDelegate) read it
    // imperatively at call time, which is the actual contract the fix repairs.
    const callerThreadId = "caller-supplied-thread-id";
    let capturedAgent: AbstractAgent | null = null;

    function Probe() {
      const { agent } = useAgent({ agentId: "test-agent" });
      capturedAgent = agent;
      return null;
    }

    render(
      <CopilotChatConfigurationProvider threadId={callerThreadId}>
        <Probe />
      </CopilotChatConfigurationProvider>,
    );

    expect(capturedAgent).not.toBeNull();
    expect(capturedAgent!.threadId).toBe(callerThreadId);
  });

  it("does NOT overwrite the auto-minted threadId when hasExplicitThreadId is false", () => {
    // Mirrors the v1 CopilotKit bridge: ThreadsProvider auto-mints a UUID, the
    // bridge forwards it but marks it non-explicit so downstream consumers
    // don't treat the placeholder as a real backend thread.
    const placeholderThreadId = "placeholder-from-threads-provider";
    let capturedAgent: AbstractAgent | null = null;

    function Probe() {
      const { agent } = useAgent({ agentId: "test-agent" });
      capturedAgent = agent;
      return null;
    }

    render(
      <CopilotChatConfigurationProvider
        threadId={placeholderThreadId}
        hasExplicitThreadId={false}
      >
        <Probe />
      </CopilotChatConfigurationProvider>,
    );

    expect(capturedAgent).not.toBeNull();
    expect(capturedAgent!.threadId).not.toBe(placeholderThreadId);
    // AbstractAgent's constructor auto-mints a UUID; just confirm it's a
    // non-empty string distinct from the placeholder.
    expect(capturedAgent!.threadId).toBeTruthy();
  });

  it("re-syncs agent.threadId when the configuration's threadId changes", () => {
    let capturedAgent: AbstractAgent | null = null;

    function Probe() {
      const { agent } = useAgent({ agentId: "test-agent" });
      capturedAgent = agent;
      return null;
    }

    const { rerender } = render(
      <CopilotChatConfigurationProvider threadId="first-thread">
        <Probe />
      </CopilotChatConfigurationProvider>,
    );

    expect(capturedAgent!.threadId).toBe("first-thread");

    act(() => {
      rerender(
        <CopilotChatConfigurationProvider threadId="second-thread">
          <Probe />
        </CopilotChatConfigurationProvider>,
      );
    });

    // Same agent instance (provisional cache keeps reference stable), updated threadId
    expect(capturedAgent!.threadId).toBe("second-thread");
  });

  it("is a no-op when no CopilotChatConfigurationProvider is in scope", () => {
    // Headless / pure-v2 use without any configuration provider — useAgent
    // should leave the agent's auto-minted threadId alone instead of throwing.
    let capturedAgent: AbstractAgent | null = null;

    function Probe() {
      const { agent } = useAgent({ agentId: "test-agent" });
      capturedAgent = agent;
      return null;
    }

    expect(() => render(<Probe />)).not.toThrow();
    expect(capturedAgent).not.toBeNull();
    expect(capturedAgent!.threadId).toBeTruthy();
  });
});
