import React from "react";
import { describe, it, expect, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EMPTY, Observable } from "rxjs";
import { z } from "zod";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import {
  MockStepwiseAgent,
  runFinishedEvent,
  runStartedEvent,
  textChunkEvent,
  toolCallChunkEvent,
} from "../../../__tests__/utils/test-helpers";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { useFrontendTool } from "../../../hooks/use-frontend-tool";
import { CopilotChat } from "../CopilotChat";
import type { ReactFrontendTool } from "../../../types";

describe("CopilotChat avoids /connect for locally-generated threadIds (ENT-314)", () => {
  it.each(["clearReplayCursor", "clearReconnectCursor"] as const)(
    "discards the saved baseline and its %s cursor before reopening",
    async (method) => {
      const cursors = new Map<string, string>();
      const connects: (string | null)[] = [];
      class ReplayAgent extends MockStepwiseAgent {
        connect(input: RunAgentInput): Observable<BaseEvent> {
          connects.push(cursors.get(input.threadId) ?? null);
          return EMPTY;
        }
      }
      const agent = new ReplayAgent();
      Object.defineProperty(agent, method, {
        value: (threadId: string) => cursors.delete(threadId),
      });
      const agents = { default: agent };
      const view = (threadId: string, explicit: boolean) => (
        <CopilotKitProvider agents__unsafe_dev_only={agents}>
          <CopilotChatConfigurationProvider
            threadId={threadId}
            hasExplicitThreadId={explicit}
          >
            <CopilotChat welcomeScreen={false} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      );
      const { rerender } = render(view("saved", true));
      await waitFor(() => expect(connects).toEqual([null]));
      act(() => {
        agent.setState({ saved: true });
        agent.pendingInterrupts = [
          { id: "approval-A", reason: "confirmation" },
        ];
        cursors.set("saved", "last-event");
        cursors.set("other", "keep-other");
      });
      rerender(view("fresh", false));
      await waitFor(() => {
        expect(agent.state).toEqual({});
        expect(agent.pendingInterrupts).toEqual([]);
        expect(cursors.get("saved")).toBeUndefined();
      });
      expect(connects).toEqual([null]);
      expect(cursors.get("other")).toBe("keep-other");
      rerender(view("saved", true));
      await waitFor(() => expect(connects).toEqual([null, null]));
    },
  );

  it.each(["fresh", "saved", "other", "via-fresh", "swap"])(
    "keeps the %s selection safe when old detach finishes late",
    async (destination) => {
      let releaseDetach = () => {};
      let releaseOldConnect = () => {};
      const oldConnectCompletion = new Promise<void>((resolve) => {
        releaseOldConnect = resolve;
      });
      let pendingDetach: Promise<void> | undefined;
      const cursors = new Map<string, string>();
      const connected: string[] = [];
      const requestedCursors: (string | null)[] = [];
      class DelayedAgent extends MockStepwiseAgent {
        completedConnects = 0;
        async connectAgent(
          ...args: Parameters<MockStepwiseAgent["connectAgent"]>
        ) {
          const result = await super.connectAgent(...args);
          if (++this.completedConnects === 1) await oldConnectCompletion;
          return result;
        }
        clearReplayCursor(threadId: string) {
          cursors.delete(threadId);
        }
        async detachActiveRun() {
          await pendingDetach;
          await super.detachActiveRun();
        }
        connect(input: RunAgentInput): Observable<BaseEvent> {
          connected.push(input.threadId);
          requestedCursors.push(cursors.get(input.threadId) ?? null);
          return EMPTY;
        }
      }
      const agent = new DelayedAgent();
      let currentAgent = agent;
      let agents = { default: agent };
      const view = (threadId: string, explicit: boolean) => (
        <CopilotKitProvider agents__unsafe_dev_only={agents}>
          <CopilotChatConfigurationProvider
            threadId={threadId}
            hasExplicitThreadId={explicit}
          >
            <CopilotChat welcomeScreen={false} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      );
      const { rerender, unmount } = render(view("saved", true));
      await waitFor(() => expect(connected).toEqual(["saved"]));
      pendingDetach = new Promise<void>((resolve) => {
        releaseDetach = resolve;
      });
      cursors.set("saved", "old-event");
      rerender(view("fresh", false));
      if (destination === "via-fresh") rerender(view("fresh-again", false));
      if (destination === "swap") {
        currentAgent = new DelayedAgent();
        agents = { default: currentAgent };
      }
      const target =
        destination === "via-fresh" || destination === "swap"
          ? "saved"
          : destination;
      if (target !== "fresh") rerender(view(target, true));
      expect(connected).toEqual(["saved"]);
      act(() => {
        cursors.set("saved", "late-event");
        agent.setState({ late: true });
      });
      await act(async () => {
        releaseDetach();
      });
      if (target === "fresh") {
        expect(agent.state).toEqual({});
        expect(cursors.get("saved")).toBeUndefined();
      } else {
        await waitFor(() => expect(connected).toEqual(["saved", target]));
        expect(requestedCursors).toEqual([null, null]);
      }
      act(() => {
        currentAgent.setState({ current: true });
        currentAgent.pendingInterrupts = [
          { id: "approval-current", reason: "confirmation" },
        ];
        cursors.set(target, "current-event");
      });
      await act(async () => {
        releaseOldConnect();
      });
      expect(currentAgent.state).toEqual({ current: true });
      expect(currentAgent.pendingInterrupts).toEqual([
        { id: "approval-current", reason: "confirmation" },
      ]);
      expect(cursors.get(target)).toBe("current-event");
      unmount();
    },
  );

  function buildAgentWithConnectSpy(): {
    agent: MockStepwiseAgent;
    connectSpy: ReturnType<typeof vi.fn>;
  } {
    const connectSpy = vi.fn();
    class SpyAgent extends MockStepwiseAgent {
      connect(input: RunAgentInput): Observable<BaseEvent> {
        connectSpy(input);
        return EMPTY;
      }
    }
    return { agent: new SpyAgent(), connectSpy };
  }

  it("does not call connect() when no threadId is supplied", async () => {
    const { agent, connectSpy } = buildAgentWithConnectSpy();

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChat welcomeScreen={false} />
      </CopilotKitProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("calls connect() when a threadId is supplied via props", async () => {
    const { agent, connectSpy } = buildAgentWithConnectSpy();

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChat welcomeScreen={false} threadId="user-thread-abc" />
      </CopilotKitProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectSpy).toHaveBeenCalled();
    expect(connectSpy.mock.calls[0][0].threadId).toBe("user-thread-abc");
  });

  it("calls connect() when a threadId is supplied via configuration provider", async () => {
    const { agent, connectSpy } = buildAgentWithConnectSpy();

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChatConfigurationProvider threadId="config-thread-xyz">
          <CopilotChat welcomeScreen={false} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectSpy).toHaveBeenCalled();
    expect(connectSpy.mock.calls[0][0].threadId).toBe("config-thread-xyz");
  });

  it("uses the SDK-generated threadId for frontend tool follow-up runs", async () => {
    class FrontendToolRoundTripAgent extends MockStepwiseAgent {
      runInputs: RunAgentInput[] = [];

      run(input: RunAgentInput): Observable<BaseEvent> {
        this.runInputs.push(input);
        const runNumber = this.runInputs.length;

        return new Observable<BaseEvent>((subscriber) => {
          queueMicrotask(() => {
            subscriber.next(runStartedEvent());
            if (runNumber === 1) {
              subscriber.next(
                textChunkEvent("assistant-tool", "Calling frontend tool."),
              );
              subscriber.next(
                toolCallChunkEvent({
                  parentMessageId: "assistant-tool",
                  delta: '{"label":"X"}',
                  toolCallId: "tc-sdk-generated-thread",
                  toolCallName: "testFrontendToolCalling",
                }),
              );
            } else {
              subscriber.next(
                textChunkEvent(
                  "assistant-final",
                  "Frontend tool finished for X.",
                ),
              );
            }
            subscriber.next(runFinishedEvent());
            subscriber.complete();
          });
        });
      }
    }

    function FrontendToolRegistration() {
      const frontendTool: ReactFrontendTool<{ label: string }> = {
        name: "testFrontendToolCalling",
        parameters: z.object({ label: z.string() }),
        followUp: true,
        handler: async ({ label }) => `handled ${String(label)}`,
        render: ({ args, result }) => (
          <div data-testid="frontend-tool-card">
            {String(args.label)}:{String(result ?? "pending")}
          </div>
        ),
      };
      useFrontendTool(frontendTool);
      return null;
    }

    const agent = new FrontendToolRoundTripAgent();

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChatConfigurationProvider
          threadId="sdk-generated-thread"
          hasExplicitThreadId={false}
        >
          <FrontendToolRegistration />
          <CopilotChat welcomeScreen={false} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, {
      target: {
        value: "invoke testFrontendToolCalling with label X",
      },
    });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(agent.runInputs).toHaveLength(2);
    });

    expect(agent.runInputs.map((runInput) => runInput.threadId)).toEqual([
      "sdk-generated-thread",
      "sdk-generated-thread",
    ]);
    expect(agent.runInputs[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: "invoke testFrontendToolCalling with label X",
        }),
      ]),
    );
    await waitFor(() => {
      expect(screen.getByTestId("frontend-tool-card").textContent).toBe(
        "X:handled X",
      );
    });
    expect(
      agent.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content === "Frontend tool finished for X.",
      ),
    ).toBe(true);
  });

  it("clears messages when switching to a fresh non-explicit thread ('+ New')", async () => {
    // Switching to an existing thread replaces messages via /connect, but a
    // fresh non-explicit thread skips /connect — so the previously-viewed
    // thread's messages must be cleared explicitly, or "+ New" leaves the old
    // conversation on screen instead of the welcome view.
    const agent = new MockStepwiseAgent();

    const { rerender } = render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChatConfigurationProvider
          threadId="thread-A"
          hasExplicitThreadId={false}
        >
          <CopilotChat welcomeScreen={false} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    // Simulate an in-progress conversation on the current (non-explicit) thread.
    act(() => {
      agent.setMessages([{ id: "m1", role: "assistant", content: "hi" }]);
    });
    expect(agent.messages.length).toBe(1);

    // "+ New" mints a different non-explicit threadId.
    rerender(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChatConfigurationProvider
          threadId="thread-B"
          hasExplicitThreadId={false}
        >
          <CopilotChat welcomeScreen={false} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(agent.messages.length).toBe(0));
  });
});
