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
 * immediately with an empty run result.
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
 * Regression coverage for fix/welcome-not-showing-at-all and the follow-up
 * fix that decouples welcome-screen gating from thread origin.
 *
 * History: the v1 <CopilotKit> wrapper pipes a ThreadsProvider-minted UUID
 * through to CopilotChatConfigurationProvider as `threadId`. CopilotChat
 * previously treated any non-empty providedThreadId as "caller supplied a
 * real backend thread" and (a) fired /connect (→ 404 for an auto-minted UUID)
 * and (b) suppressed the welcome screen forever. The first fix threaded an
 * `hasExplicitThreadId` signal through the provider chain so /connect only
 * fires for genuinely explicit threads.
 *
 * The follow-up: welcome-screen gating no longer keys on thread origin. Any
 * empty thread renders the welcome state — including a caller-minted UUID
 * (premint-on-mount is the standard pattern for apps that manage their own
 * thread state). Welcome-screen visibility is now driven purely by message
 * emptiness; `welcomeScreen={false}` remains the escape hatch for
 * consumers that want to suppress it.
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
    it("calls connectAgent with that threadId; welcome screen returns once the empty thread settles", async () => {
      const agent = new TrackingAgent();
      agent.agentId = DEFAULT_AGENT_ID;

      renderWithKit(<CopilotChat threadId="real-thread" />, agent);

      await waitFor(() => {
        expect(TrackingAgent.connectCalls.length).toBeGreaterThan(0);
      });

      expect(
        TrackingAgent.connectCalls.some((c) => c.threadId === "real-thread"),
      ).toBe(true);

      // Welcome-screen gating is now driven by message emptiness, not thread
      // origin. TrackingAgent.connectAgent resolves with no messages, so once
      // isConnecting flips back to false the welcome screen returns.
      await waitFor(() => {
        expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
      });
    });
  });

  describe("explicit threadId via wrapping CopilotChatConfigurationProvider", () => {
    it("inherits explicitness from the provider and connects; empty thread keeps welcome state", async () => {
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
      // The empty post-connect thread renders the welcome state. Thread
      // origin no longer suppresses the greeting on its own.
      await waitFor(() => {
        expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
      });
    });
  });

  describe("thread switch between two explicit threads", () => {
    it("hides the welcome screen during the switch but restores it when the empty target settles", async () => {
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
      // thread-a is empty after connect; welcome screen returns once the
      // connect-in-flight gate releases.
      await waitFor(() => {
        expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
      });

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
      // is true — welcome must not flash mid-switch.
      expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();

      await waitFor(() => {
        expect(
          TrackingAgent.connectCalls.some((c) => c.threadId === "thread-b"),
        ).toBe(true);
      });
      // thread-b is also empty after connect; the welcome state returns
      // once isConnecting releases.
      await waitFor(() => {
        expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
      });
    });
  });
});
