import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChat } from "../CopilotChat";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";

/**
 * Mock agent whose connectAgent() stays pending until the test resolves it,
 * standing in for a slow /connect that is restoring a thread's history.
 */
class DeferredConnectAgent extends MockStepwiseAgent {
  connectCalls = 0;
  private resolveConnect: (() => void) | null = null;

  finishConnect() {
    this.resolveConnect?.();
  }

  async connectAgent(
    _params: unknown,
    _subscriber: unknown,
  ): Promise<{ result: unknown; newMessages: [] }> {
    this.connectCalls += 1;
    await new Promise<void>((resolve) => {
      this.resolveConnect = resolve;
    });
    return { result: undefined, newMessages: [] };
  }
}

describe("CopilotChat connecting indicator", () => {
  it("shows the indicator until the thread's connect resolves", async () => {
    const agent = new DeferredConnectAgent();
    agent.agentId = DEFAULT_AGENT_ID;

    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ [DEFAULT_AGENT_ID]: agent }}
      >
        <div style={{ height: 400 }}>
          <CopilotChat threadId="existing-thread" />
        </div>
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(agent.connectCalls).toBeGreaterThan(0);
    });
    expect(screen.getByTestId("copilot-connecting-indicator")).toBeDefined();

    await act(async () => {
      agent.finishConnect();
    });

    await waitFor(() => {
      expect(screen.queryByTestId("copilot-connecting-indicator")).toBeNull();
    });
    expect(
      screen
        .getByTestId("copilot-chat")
        .getAttribute("data-copilot-connecting"),
    ).toBe("false");
  });

  it("never shows the indicator for a chat without an explicit thread", async () => {
    const agent = new DeferredConnectAgent();
    agent.agentId = DEFAULT_AGENT_ID;

    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ [DEFAULT_AGENT_ID]: agent }}
      >
        <div style={{ height: 400 }}>
          <CopilotChat />
        </div>
      </CopilotKitProvider>,
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByTestId("copilot-connecting-indicator")).toBeNull();
    expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
  });
});
