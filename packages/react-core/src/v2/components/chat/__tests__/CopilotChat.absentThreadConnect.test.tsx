import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EMPTY, Observable } from "rxjs";
import { z } from "zod";
import { EventType } from "@ag-ui/client";
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
import type { CopilotChatMessageViewProps } from "../CopilotChatMessageView";
import type { ReactFrontendTool } from "../../../types";

describe("CopilotChat avoids /connect for locally-generated threadIds (ENT-314)", () => {
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
});

describe("CopilotChat frontend tool round trips without explicit threadId (ENT-314)", () => {
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
});

describe("CopilotChat frontend tool round trips with explicit threadId (ENT-657)", () => {
  it("keeps explicit-thread messages mounted through frontend tool follow-up runs", async () => {
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
                  toolCallId: "tc-explicit-thread",
                  toolCallName: "testFrontendToolCalling",
                }),
              );
            } else {
              subscriber.next({
                type: EventType.MESSAGES_SNAPSHOT,
                messages: [],
              } as BaseEvent);
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
        handler: async ({ label }) => `handled ${label}`,
        render: ({ args, result }) => (
          <div data-testid="frontend-tool-card">
            {args.label}:{result ?? "pending"}
          </div>
        ),
      };
      useFrontendTool(frontendTool);
      return null;
    }

    const messageCounts: number[] = [];
    function MessageCountProbe({ messages }: CopilotChatMessageViewProps) {
      messageCounts.push(messages?.length ?? 0);
      return (
        <div data-testid="message-count">{String(messages?.length ?? 0)}</div>
      );
    }

    const agent = new FrontendToolRoundTripAgent();

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <FrontendToolRegistration />
        <div style={{ height: 400 }}>
          <CopilotChat
            welcomeScreen={false}
            threadId="explicit-thread"
            messageView={MessageCountProbe}
          />
        </div>
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
      "explicit-thread",
      "explicit-thread",
    ]);

    expect(
      agent.messages.some(
        (message) => message.role === "tool" && message.content === "handled X",
      ),
    ).toBe(true);
    expect(
      agent.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content === "Frontend tool finished for X.",
      ),
    ).toBe(true);

    const firstNonEmptyRender = messageCounts.findIndex((count) => count > 0);
    expect(firstNonEmptyRender).toBeGreaterThanOrEqual(0);
    expect(messageCounts.slice(firstNonEmptyRender)).not.toContain(0);
  });
});
