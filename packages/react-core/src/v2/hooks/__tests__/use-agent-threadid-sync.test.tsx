import React from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { useCopilotKit } from "../../context";
import { useAgent } from "../use-agent";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";

vi.mock("../../context", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

/**
 * Regression coverage for issue #5041 (and the same root cause behind #4739):
 * <CopilotKit threadId={x}> flows into CopilotChatConfigurationProvider, but
 * the underlying ProxiedCopilotRuntimeAgent was never having `agent.threadId`
 * set from that value. The AbstractAgent constructor auto-mints a UUID, so
 * outbound /agent/run, /agent/connect, /agent/stop requests carried a UUID
 * that diverged from what app code read via useThreads/useCopilotChatConfig.
 *
 * The fix wires useAgent to sync `agent.threadId` from the chat configuration
 * when `hasExplicitThreadId` is true. This file pins that behavior so the
 * propagation can't silently regress again (as it did when per-thread cloning
 * was removed in May 2026).
 */
describe("useAgent → agent.threadId sync from chat configuration", () => {
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

  beforeEach(() => {
    mockCopilotkit = {
      getAgent: vi.fn(() => undefined),
      runtimeUrl: "http://localhost:3000/api/copilotkit",
      runtimeConnectionStatus:
        CopilotKitCoreRuntimeConnectionStatus.Disconnected,
      runtimeTransport: "rest",
      headers: {},
      agents: {},
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
