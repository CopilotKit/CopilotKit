import { MockSocket } from "../../../../../core/src/__tests__/test-utils";
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import {
  AgentHistoryReplayError,
  CopilotKitCoreErrorCode,
  IntelligenceAgent,
} from "@copilotkit/core";
import { CopilotKitCoreReact, useCopilotKit } from "../../context";
import { useAgent } from "../use-agent";
import { useInterrupt } from "../use-interrupt";

vi.mock("phoenix", () => ({ Socket: MockSocket }));
vi.mock("../../context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../context")>()),
  useCopilotKit: vi.fn(),
}));
vi.mock("../use-agent", () => ({ useAgent: vi.fn() }));

function InterruptHarness() {
  return useInterrupt({
    renderInChat: false,
    render: () => <button>Approve saved action</button>,
  });
}

test("clears a replayed interrupt before failed history finalizes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            threadId: "test-thread",
            runId: "saved-run",
            joinToken: "token",
            realtime: {
              clientUrl: "ws://localhost/client",
              topic: "thread:test-thread",
            },
          }),
        ),
    ),
  );
  const channels = vi.spyOn(MockSocket.prototype, "channel");
  const agent = new IntelligenceAgent({
    agentId: "default",
    url: "ws://localhost/client",
    runtimeUrl: "http://localhost/runtime",
  });
  agent.threadId = "test-thread";
  const core = new CopilotKitCoreReact({
    agents__unsafe_dev_only: { default: agent },
  });
  vi.mocked(useCopilotKit).mockReturnValue({
    copilotkit: core,
    executingToolCallIds: new Set(),
  });
  vi.mocked(useAgent).mockReturnValue({ agent, isReady: true });
  const onError = vi.fn();
  const errors = core.subscribe({ onError });
  const observed = vi.fn();
  const events = agent.subscribe({ onCustomEvent: observed });
  render(<InterruptHarness />);
  const connection = core.connectAgent({ agent });
  try {
    await waitFor(() => expect(channels).toHaveBeenCalledOnce());
    const channel = channels.mock.results[0]!.value;
    await act(async () => {
      channel.triggerJoin("ok");
      channel.serverPush("ag_ui_event", {
        type: EventType.CUSTOM,
        name: "on_interrupt",
        value: { question: "Approve saved action?" },
      });
    });
    await waitFor(() => expect(observed).toHaveBeenCalledOnce());
    await act(async () => {
      channel.serverPush("replay_failed", {
        reason: "history_read_timeout",
        retryable: false,
        latestEventId: null,
      });
      await connection;
    });
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: CopilotKitCoreErrorCode.AGENT_HISTORY_REPLAY_FAILED,
        error: new AgentHistoryReplayError("history_read_timeout"),
      }),
    );
    expect(screen.queryByText("Approve saved action")).toBeNull();
    expect(agent.isRunning).toBe(false);
  } finally {
    await agent.detachActiveRun();
    await connection;
    events.unsubscribe();
    errors.unsubscribe();
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
