import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { useAgent } from "../use-agent";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../__tests__/utils/test-helpers";

/**
 * Regression coverage for #5000: `agent.subscribe()` used to throw
 * "Cannot read properties of undefined (reading 'subscribers')" when called on
 * mount while the runtime was still connecting, because there was no
 * fully-constructed agent to subscribe to and no signal telling consumers when
 * it was safe. `useAgent` now always returns a fully-constructed agent
 * (provisional while connecting) and exposes an `isReady` flag.
 */
describe("useAgent subscribe / isReady (#5000)", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    // Preserve jsdom's real window/document (needed by testing-library's
    // waitFor) while ensuring `window` is defined so the runtime connects
    // instead of taking the SSR early-return.
    (globalThis as { window?: unknown }).window =
      (globalThis as { window?: unknown }).window ?? {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("subscribe() in an effect does not throw while the runtime is connecting", async () => {
    // fetch never resolves → runtime stays Connecting → provisional agent
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as any;
    let caught: Error | null = null;

    function TestComponent() {
      const { agent, isReady } = useAgent({ agentId: "test-agent" });
      React.useEffect(() => {
        try {
          const sub = agent.subscribe({ onRunFinalized: () => {} });
          return () => sub.unsubscribe();
        } catch (e) {
          caught = e as Error;
        }
      }, [agent]);
      return <div data-testid="ready">{String(isReady)}</div>;
    }

    render(
      <CopilotKitProvider runtimeUrl="http://localhost:59999/x">
        <TestComponent />
      </CopilotKitProvider>,
    );

    const el = await screen.findByTestId("ready");
    await new Promise((r) => setTimeout(r, 0));

    expect(caught).toBeNull();
    // Provisional agent while connecting → not ready yet.
    expect(el.textContent).toBe("false");
  });

  it("subscribe() during render does not throw while the runtime is connecting", async () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as any;
    let caught: Error | null = null;

    function TestComponent() {
      const { agent } = useAgent({ agentId: "test-agent" });
      try {
        agent.subscribe({ onRunFinalized: () => {} });
      } catch (e) {
        caught = e as Error;
      }
      return <div data-testid="ok">{agent.agentId}</div>;
    }

    render(
      <CopilotKitProvider runtimeUrl="http://localhost:59999/x">
        <TestComponent />
      </CopilotKitProvider>,
    );

    await screen.findByTestId("ok");
    expect(caught).toBeNull();
  });

  it("isReady flips false -> true once the runtime syncs, swapping the provisional agent for the real one", async () => {
    const runtimeInfo = {
      version: "1.0.0",
      audioFileTranscriptionEnabled: false,
      agents: {
        "test-agent": {
          name: "test-agent",
          description: "Test agent",
          capabilities: {},
        },
      },
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => runtimeInfo,
    }) as any;

    const readyValues: boolean[] = [];
    const subscribedAgents: unknown[] = [];

    function TestComponent() {
      const { agent, isReady } = useAgent({ agentId: "test-agent" });
      readyValues.push(isReady);
      React.useEffect(() => {
        // Only subscribe once the real agent is bound (the reporter's pattern).
        if (!isReady) return;
        subscribedAgents.push(agent);
        const sub = agent.subscribe({ onRunFinalized: () => {} });
        return () => sub.unsubscribe();
      }, [agent, isReady]);
      return <div data-testid="ready">{String(isReady)}</div>;
    }

    render(
      <CopilotKitProvider runtimeUrl="http://localhost:3000/api">
        <TestComponent />
      </CopilotKitProvider>,
    );

    const el = await screen.findByTestId("ready");
    // First render is the provisional (connecting) agent.
    expect(readyValues[0]).toBe(false);

    // After the runtime /info sync resolves, isReady becomes true.
    await waitFor(() => expect(el.textContent).toBe("true"));

    // The guarded effect only ever subscribed to the real (ready) agent.
    expect(subscribedAgents.length).toBeGreaterThan(0);
  });

  it("isReady is true and subscribe() works for a locally-registered agent", async () => {
    const agent = new MockStepwiseAgent();
    let caught: Error | null = null;

    function TestComponent() {
      const { agent: hookAgent, isReady } = useAgent();
      React.useEffect(() => {
        try {
          const sub = hookAgent.subscribe({ onRunFinalized: () => {} });
          return () => sub.unsubscribe();
        } catch (e) {
          caught = e as Error;
        }
      }, [hookAgent]);
      return <div data-testid="ready">{String(isReady)}</div>;
    }

    renderWithCopilotKit({ agent, children: <TestComponent /> });

    const el = await screen.findByTestId("ready");
    await new Promise((r) => setTimeout(r, 0));
    expect(el.textContent).toBe("true");
    expect(caught).toBeNull();
  });
});
