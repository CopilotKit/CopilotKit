import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CopilotKit } from "../copilotkit";
import { useCopilotContext } from "../../../context/copilot-context";
import { useCopilotChatConfiguration, useAgent } from "../../../v2";
import type { CopilotKitProps } from "../copilotkit-props";
import type { AbstractAgent } from "@ag-ui/client";

/**
 * Probe that reads hasExplicitThreadId from the CopilotChatConfigurationProvider
 * that the v1 <CopilotKit> bridge renders. This is the surface CopilotChat
 * itself reads from to gate /connect and the welcome screen.
 */
function ExplicitProbe() {
  const config = useCopilotChatConfiguration();
  return (
    <>
      <div data-testid="explicit">{String(config?.hasExplicitThreadId)}</div>
      <div data-testid="threadId">{config?.threadId ?? ""}</div>
    </>
  );
}

/**
 * Exposes the v1 context's setThreadId so tests can drive the
 * auto → explicit transition from outside React.
 */
function SetThreadIdButton({ nextId }: { nextId: string }) {
  const { setThreadId } = useCopilotContext();
  return (
    <button data-testid="setThread" onClick={() => setThreadId(nextId)}>
      set
    </button>
  );
}

// `agents__unsafe_dev_only` isn't declared on v1 CopilotKitProps but is
// forwarded via spread to the v2 provider underneath. Cast once here rather
// than every render.
type V1Props = CopilotKitProps & {
  agents__unsafe_dev_only?: Record<string, unknown>;
};
const CopilotKitAny = CopilotKit as unknown as React.FC<V1Props>;

/**
 * Regression coverage for fix/welcome-not-showing-at-all at the v1 bridge
 * boundary. The v1 <CopilotKit> wrapper pipes a ThreadsProvider-minted UUID
 * through as `threadId`, but that UUID is NOT a caller choice — the bridge
 * must mark it as non-explicit so downstream consumers don't treat it as a
 * real backend thread. These tests verify the signal makes it all the way
 * through to CopilotChatConfigurationProvider.
 */
describe("v1 <CopilotKit> bridge → hasExplicitThreadId", () => {
  // Silence the in-dev/test "missing runtimeUrl" warning — we pass publicApiKey.
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("is false on mount when no threadId prop is supplied", () => {
    render(
      <CopilotKitAny publicApiKey="test-key">
        <ExplicitProbe />
      </CopilotKitAny>,
    );

    // ThreadsProvider auto-minted the UUID — it's not a caller-picked thread.
    expect(screen.getByTestId("explicit").textContent).toBe("false");
    // threadId still resolves to a value (mock-thread-id from setupTests),
    // but downstream consumers must NOT treat it as real.
    expect(screen.getByTestId("threadId").textContent).toBe("mock-thread-id");
  });

  it("is true when threadId prop is supplied to <CopilotKit>", () => {
    render(
      <CopilotKitAny publicApiKey="test-key" threadId="caller-thread">
        <ExplicitProbe />
      </CopilotKitAny>,
    );

    expect(screen.getByTestId("explicit").textContent).toBe("true");
    expect(screen.getByTestId("threadId").textContent).toBe("caller-thread");
  });

  it("flips from false to true after setThreadId() is called on the v1 context", () => {
    render(
      <CopilotKitAny publicApiKey="test-key">
        <ExplicitProbe />
        <SetThreadIdButton nextId="user-picked-thread" />
      </CopilotKitAny>,
    );

    expect(screen.getByTestId("explicit").textContent).toBe("false");

    act(() => {
      screen.getByTestId("setThread").click();
    });

    expect(screen.getByTestId("threadId").textContent).toBe(
      "user-picked-thread",
    );
    expect(screen.getByTestId("explicit").textContent).toBe("true");
  });
});

/**
 * Regression coverage for issue #5041 (and #4739) at the customer-facing
 * surface: a threadId prop on <CopilotKit> must end up on the underlying
 * agent so that ProxiedCopilotRuntimeAgent ships it in /agent/run,
 * /agent/connect, /agent/stop. The cloning-revert in May 2026 broke this
 * for headless useAgent and V1 chat; CopilotChatConfigurationProvider got
 * the value but useAgent never copied it down onto agent.threadId.
 */
describe("v1 <CopilotKit> → useAgent → agent.threadId", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  function AgentProbe({
    onCapture,
  }: {
    onCapture: (agent: AbstractAgent) => void;
  }) {
    const { agent } = useAgent({ agentId: "default" });
    React.useEffect(() => {
      onCapture(agent);
    });
    return null;
  }

  it("sets agent.threadId to the explicit threadId from the <CopilotKit> prop", () => {
    let captured: AbstractAgent | null = null;
    render(
      <CopilotKitAny publicApiKey="test-key" threadId="customer-thread-id">
        <AgentProbe onCapture={(agent) => (captured = agent)} />
      </CopilotKitAny>,
    );

    expect(captured).not.toBeNull();
    expect((captured as unknown as AbstractAgent).threadId).toBe(
      "customer-thread-id",
    );
  });

  it("leaves the agent's auto-minted threadId untouched when no threadId prop is supplied", () => {
    // Without an explicit threadId, the ThreadsProvider mints a placeholder
    // UUID that's marked non-explicit. The agent should keep its own
    // constructor-generated UUID rather than adopt the placeholder, so the
    // backend isn't asked to look up a thread it never created.
    let captured: AbstractAgent | null = null;
    render(
      <CopilotKitAny publicApiKey="test-key">
        <AgentProbe onCapture={(agent) => (captured = agent)} />
      </CopilotKitAny>,
    );

    expect(captured).not.toBeNull();
    expect((captured as unknown as AbstractAgent).threadId).toBeTruthy();
    expect((captured as unknown as AbstractAgent).threadId).not.toBe(
      "mock-thread-id",
    );
  });
});
