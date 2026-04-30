import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChat } from "../CopilotChat";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";

/**
 * Mock agent that records every connectAgent() invocation and resolves
 * immediately with an empty run result. Tracking lives on the class so
 * per-thread clones (from useAgent's WeakMap) share the counter.
 */
class TrackingAgent extends MockStepwiseAgent {
  static connectCalls: Array<{
    threadId: string | undefined;
    agentId: string | undefined;
  }> = [];
  static connectPlans: Array<{
    outcome: "fresh" | "restored" | null;
    deferred?: boolean;
    transientRestoreObserved?: boolean;
    error?: Error;
  }> = [{ outcome: "restored" }];
  static pendingConnectResolvers: Array<() => void> = [];
  public lastConnectRestoreOutcome: "fresh" | "restored" | null = null;

  static reset() {
    TrackingAgent.connectCalls = [];
    TrackingAgent.connectPlans = [{ outcome: "restored" }];
    TrackingAgent.pendingConnectResolvers = [];
  }

  static resolveNextConnect() {
    const resolver = TrackingAgent.pendingConnectResolvers.shift();
    resolver?.();
  }

  async connectAgent(
    _params: unknown,
    _subscriber: unknown,
  ): Promise<{ result: unknown; newMessages: [] }> {
    const plan =
      TrackingAgent.connectPlans.shift() ?? { outcome: "restored" as const };
    this.lastConnectRestoreOutcome = plan.transientRestoreObserved
      ? "restored"
      : plan.outcome;
    TrackingAgent.connectCalls.push({
      threadId: this.threadId,
      agentId: this.agentId,
    });
    if (plan.deferred) {
      await new Promise<void>((resolve) => {
        TrackingAgent.pendingConnectResolvers.push(resolve);
      });
    }
    if (plan.error) {
      this.lastConnectRestoreOutcome = plan.outcome;
      throw plan.error;
    }
    return { result: undefined, newMessages: [] };
  }
}

function CustomViewProbe({
  hasExplicitThreadId,
  isConnecting,
}: {
  hasExplicitThreadId?: boolean;
  isConnecting?: boolean;
}) {
  return (
    <div>
      <div data-testid="custom-explicit">{String(hasExplicitThreadId)}</div>
      <div data-testid="custom-connecting">{String(isConnecting)}</div>
    </div>
  );
}

function renderWithKit(ui: React.ReactNode, agent: TrackingAgent) {
  return render(
    <CopilotKitProvider agents__unsafe_dev_only={{ [DEFAULT_AGENT_ID]: agent }}>
      <div style={{ height: 400 }}>{ui}</div>
    </CopilotKitProvider>,
  );
}

/**
 * Regression coverage for fix/welcome-not-showing-at-all.
 *
 * The underlying bug: the v1 <CopilotKit> wrapper pipes a ThreadsProvider-
 * minted UUID through to CopilotChatConfigurationProvider as `threadId`.
 * CopilotChat previously treated any non-empty providedThreadId as "caller
 * supplied a real backend thread" and (a) fired /connect (→ 404 for an
 * auto-minted UUID) and (b) suppressed the welcome screen forever. The
 * fix threads an `hasExplicitThreadId` signal through the provider chain;
 * these tests pin the contract that /connect and welcome-screen gating
 * now follow that signal rather than `!!threadId`.
 */
describe("CopilotChat welcome / connect integration", () => {
  beforeEach(() => {
    TrackingAgent.reset();
  });

  describe("v1 bridge scenario (config provider marks threadId as non-explicit)", () => {
    it("does not call connectAgent and shows the welcome screen", async () => {
      TrackingAgent.connectPlans = [{ outcome: null }];
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(
        <CopilotChatConfigurationProvider
          threadId="auto-minted-uuid"
          hasExplicitThreadId={false}
        >
          <CopilotChat />
        </CopilotChatConfigurationProvider>,
        agent,
      );

      // Give the connect-effect a chance to misfire.
      await new Promise((r) => setTimeout(r, 50));

      expect(TrackingAgent.connectCalls).toHaveLength(0);
      expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
    });

    it("submits the first message from the non-explicit welcome path", async () => {
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(
        <CopilotChatConfigurationProvider
          threadId="auto-minted-uuid"
          hasExplicitThreadId={false}
        >
          <CopilotChat />
        </CopilotChatConfigurationProvider>,
        agent,
      );

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Bridge submit" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Bridge submit")).toBeDefined();
      });
    });
  });

  describe("plain CopilotChat (no threadId anywhere)", () => {
    it("does not call connectAgent and shows the welcome screen", async () => {
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(<CopilotChat />, agent);

      await new Promise((r) => setTimeout(r, 50));

      expect(TrackingAgent.connectCalls).toHaveLength(0);
      expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
    });

    it("submits the first message from the local welcome path", async () => {
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(<CopilotChat />, agent);

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Local submit" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Local submit")).toBeDefined();
      });
    });
  });

  describe("explicit threadId via CopilotChat prop", () => {
    it("calls connectAgent with that threadId and suppresses the welcome screen", async () => {
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(<CopilotChat threadId="real-thread" />, agent);

      await waitFor(() => {
        expect(TrackingAgent.connectCalls.length).toBeGreaterThan(0);
      });

      // The per-thread clone carries threadId; agentId is the default.
      expect(
        TrackingAgent.connectCalls.some((c) => c.threadId === "real-thread"),
      ).toBe(true);

      // Welcome screen is suppressed even after connect resolves, because the
      // thread resolved to a persisted restore rather than a fresh 204 thread.
      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();
    });

    it("shows the welcome screen after an explicit thread settles as fresh", async () => {
      TrackingAgent.connectPlans = [{ outcome: "fresh" }];
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(<CopilotChat threadId="fresh-thread" />, agent);

      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();

      await waitFor(() => {
        expect(
          TrackingAgent.connectCalls.some((c) => c.threadId === "fresh-thread"),
        ).toBe(true);
      });

      await waitFor(() => {
        expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
      });
    });

    it("shows the welcome screen after an explicit thread settles with an unknown outcome", async () => {
      TrackingAgent.connectPlans = [{ outcome: null }];
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(<CopilotChat threadId="unknown-thread" />, agent);

      await waitFor(() => {
        expect(
          TrackingAgent.connectCalls.some((c) => c.threadId === "unknown-thread"),
        ).toBe(true);
      });

      await waitFor(() => {
        expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
      });
    });

    it("submits from the welcome-screen input after an explicit unknown settle", async () => {
      TrackingAgent.connectPlans = [{ outcome: null }];
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(<CopilotChat threadId="welcome-thread" />, agent);

      await waitFor(() => {
        expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
      });

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Welcome submit" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Welcome submit")).toBeDefined();
      });
    });

    it("shows the welcome screen when replay is observed but connect still fails", async () => {
      TrackingAgent.connectPlans = [
        {
          outcome: null,
          transientRestoreObserved: true,
          error: new Error("reconnect fetch failed"),
        },
      ];
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(<CopilotChat threadId="failed-restore-thread" />, agent);

      await waitFor(() => {
        expect(
          TrackingAgent.connectCalls.some(
            (c) => c.threadId === "failed-restore-thread",
          ),
        ).toBe(true);
      });

      await waitFor(() => {
        expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
      });
    });

    it("preserves hasExplicitThreadId for custom chat views after a fresh outcome", async () => {
      TrackingAgent.connectPlans = [{ outcome: "fresh" }];
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(
        <CopilotChat
          threadId="fresh-thread"
          chatView={CustomViewProbe}
          welcomeScreen={false}
        />,
        agent,
      );

      await waitFor(() => {
        expect(
          TrackingAgent.connectCalls.some((c) => c.threadId === "fresh-thread"),
        ).toBe(true);
      });

      await waitFor(() => {
        expect(screen.getByTestId("custom-explicit").textContent).toBe("true");
        expect(screen.getByTestId("custom-connecting").textContent).toBe(
          "false",
        );
      });
    });

    it("does not drop the first submit when a fresh settle lands after typing begins", async () => {
      TrackingAgent.connectPlans = [{ outcome: "fresh", deferred: true }];
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(<CopilotChat threadId="fresh-thread" />, agent);

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "First submit" } });

      TrackingAgent.resolveNextConnect();

      await waitFor(() => {
        expect(screen.getByDisplayValue("First submit")).toBeDefined();
      });

      fireEvent.keyDown(screen.getByRole("textbox"), {
        key: "Enter",
        code: "Enter",
      });

      await waitFor(() => {
        expect(screen.getByText("First submit")).toBeDefined();
      });
    });

    it("does not drop the first submit when an unknown settle lands after typing begins", async () => {
      TrackingAgent.connectPlans = [{ outcome: null, deferred: true }];
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(<CopilotChat threadId="unknown-thread" />, agent);

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Unknown submit" } });

      TrackingAgent.resolveNextConnect();

      await waitFor(() => {
        expect(screen.getByDisplayValue("Unknown submit")).toBeDefined();
      });

      fireEvent.keyDown(screen.getByRole("textbox"), {
        key: "Enter",
        code: "Enter",
      });

      await waitFor(() => {
        expect(screen.getByText("Unknown submit")).toBeDefined();
      });
    });

    it("keeps the focused empty input stable when an unknown settle lands before draft state propagates", async () => {
      TrackingAgent.connectPlans = [{ outcome: null, deferred: true }];
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(<CopilotChat threadId="unknown-thread" />, agent);

      const input = await screen.findByRole("textbox");
      fireEvent.focus(input);

      TrackingAgent.resolveNextConnect();

      await waitFor(() => {
        expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();
      });

      fireEvent.change(input, { target: { value: "Focused submit" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Focused submit")).toBeDefined();
      });
    });
  });

  describe("explicit threadId via wrapping CopilotChatConfigurationProvider", () => {
    it("inherits explicitness from the provider and connects", async () => {
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(
        <CopilotChatConfigurationProvider threadId="from-config">
          <CopilotChat />
        </CopilotChatConfigurationProvider>,
        agent,
      );

      await waitFor(() => {
        expect(TrackingAgent.connectCalls.length).toBeGreaterThan(0);
      });

      expect(
        TrackingAgent.connectCalls.some((c) => c.threadId === "from-config"),
      ).toBe(true);
      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();
    });
  });

  describe("thread switch between two explicit threads", () => {
    it("keeps the welcome screen hidden across the switch", async () => {
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      const { rerender } = renderWithKit(
        <CopilotChat threadId="thread-a" />,
        agent,
      );

      await waitFor(() => {
        expect(
          TrackingAgent.connectCalls.some((c) => c.threadId === "thread-a"),
        ).toBe(true);
      });
      // After thread-a's connect resolves, welcome must still be hidden
      // because the thread is caller-picked.
      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();

      rerender(
        <CopilotKitProvider
          agents__unsafe_dev_only={{ [DEFAULT_AGENT_ID]: agent }}
        >
          <div style={{ height: 400 }}>
            <CopilotChat threadId="thread-b" />
          </div>
        </CopilotKitProvider>,
      );

      // During the switch (lastConnected="thread-a" !== "thread-b") isConnecting
      // is true — welcome must not flash.
      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();

      await waitFor(() => {
        expect(
          TrackingAgent.connectCalls.some((c) => c.threadId === "thread-b"),
        ).toBe(true);
      });
      // And after thread-b's connect resolves.
      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();
    });

    it("keeps the welcome screen hidden when switching A to B to A", async () => {
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      const { rerender } = renderWithKit(
        <CopilotChat threadId="thread-a" />,
        agent,
      );

      await waitFor(() => {
        expect(
          TrackingAgent.connectCalls.some((c) => c.threadId === "thread-a"),
        ).toBe(true);
      });
      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();

      rerender(
        <CopilotKitProvider
          agents__unsafe_dev_only={{ [DEFAULT_AGENT_ID]: agent }}
        >
          <div style={{ height: 400 }}>
            <CopilotChat threadId="thread-b" />
          </div>
        </CopilotKitProvider>,
      );

      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();

      await waitFor(() => {
        expect(
          TrackingAgent.connectCalls.some((c) => c.threadId === "thread-b"),
        ).toBe(true);
      });
      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();

      rerender(
        <CopilotKitProvider
          agents__unsafe_dev_only={{ [DEFAULT_AGENT_ID]: agent }}
        >
          <div style={{ height: 400 }}>
            <CopilotChat threadId="thread-a" />
          </div>
        </CopilotKitProvider>,
      );

      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();

      await waitFor(() => {
        expect(
          TrackingAgent.connectCalls.filter((c) => c.threadId === "thread-a"),
        ).toHaveLength(2);
      });
      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();
    });
  });

  describe("same-thread reconnect settlement", () => {
    it("re-enters the connecting path for a new same-thread connect attempt", async () => {
      TrackingAgent.connectPlans = [{ outcome: "restored" }];
      const firstAgent = new TrackingAgent();
      firstAgent.agentId = "agent-a";
      const secondAgent = new TrackingAgent();
      secondAgent.agentId = "agent-b";

      const { rerender } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            "agent-a": firstAgent,
            "agent-b": secondAgent,
          }}
        >
          <div style={{ height: 400 }}>
            <CopilotChat agentId="agent-a" threadId="same-thread" />
          </div>
        </CopilotKitProvider>,
      );

      await waitFor(() => {
        expect(
          TrackingAgent.connectCalls.some(
            (c) => c.threadId === "same-thread" && c.agentId === "agent-a",
          ),
        ).toBe(true);
      });
      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();

      TrackingAgent.connectPlans = [{ outcome: "fresh", deferred: true }];
      rerender(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            "agent-a": firstAgent,
            "agent-b": secondAgent,
          }}
        >
          <div style={{ height: 400 }}>
            <CopilotChat agentId="agent-b" threadId="same-thread" />
          </div>
        </CopilotKitProvider>,
      );

      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();

      await waitFor(() => {
        expect(
          TrackingAgent.connectCalls.some(
            (c) => c.threadId === "same-thread" && c.agentId === "agent-b",
          ),
        ).toBe(true);
      });

      TrackingAgent.resolveNextConnect();

      await waitFor(() => {
        expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
      });
    });
  });
});
