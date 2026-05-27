import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EMPTY, Observable } from "rxjs";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChat } from "../CopilotChat";
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
  });

  it("uses the SDK-generated threadId for frontend tool follow-up runs", async () => {
    class FrontendToolRoundTripAgent extends MockStepwiseAgent {
      runInputs: RunAgentInput[] = [];

      run(input: RunAgentInput): Observable<BaseEvent> {
        this.runInputs.push(input);
        const runNumber = this.runInputs.length;

        return new Observable<BaseEvent>((subscriber) => {
          queueMicrotask(() => {
            subscriber.next({ type: EventType.RUN_STARTED } as BaseEvent);
            if (runNumber === 1) {
              subscriber.next({
                type: EventType.TEXT_MESSAGE_CHUNK,
                messageId: "assistant-tool",
                delta: "Calling frontend tool.",
              } as BaseEvent);
              subscriber.next({
                type: EventType.TOOL_CALL_CHUNK,
                toolCallId: "tc-sdk-generated-thread",
                toolCallName: "testFrontendToolCalling",
                parentMessageId: "assistant-tool",
                delta: '{"label":"X"}',
              } as BaseEvent);
            } else {
              subscriber.next({
                type: EventType.TEXT_MESSAGE_CHUNK,
                messageId: "assistant-final",
                delta: "Frontend tool finished for X.",
              } as BaseEvent);
            }
            subscriber.next({ type: EventType.RUN_FINISHED } as BaseEvent);
            subscriber.complete();
          });
        });
      }
    }

    const agent = new FrontendToolRoundTripAgent();
    const frontendTools: ReactFrontendTool[] = [
      {
        name: "testFrontendToolCalling",
        followUp: true,
        handler: async ({ label }) => `handled ${String(label)}`,
        render: ({ args, result }) => (
          <div data-testid="frontend-tool-card">
            {String(args.label)}:{String(result ?? "pending")}
          </div>
        ),
      },
    ];

    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        frontendTools={frontendTools}
      >
        <CopilotChatConfigurationProvider
          threadId="sdk-generated-thread"
          hasExplicitThreadId={false}
        >
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
    expect(
      screen.getByTestId("copilot-tool-render").getAttribute("data-result"),
    ).toBe("handled X");
    expect(
      agent.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content === "Frontend tool finished for X.",
      ),
    ).toBe(true);
  });
});
