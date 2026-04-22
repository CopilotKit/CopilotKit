import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
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

  static reset() {
    TrackingAgent.connectCalls = [];
  }

  async connectAgent(
    _params: unknown,
    _subscriber: unknown,
  ): Promise<{ result: unknown; newMessages: [] }> {
    TrackingAgent.connectCalls.push({
      threadId: this.threadId,
      agentId: this.agentId,
    });
    return { result: undefined, newMessages: [] };
  }
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
      // thread was caller-picked (hasExplicitThreadId=true).
      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();
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
  });
});
