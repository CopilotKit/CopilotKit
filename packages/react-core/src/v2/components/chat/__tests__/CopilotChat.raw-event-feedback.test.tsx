import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { of } from "rxjs";
import type { Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChatMessageView } from "../CopilotChatMessageView";

class FeedbackAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];
  readonly rawEvent = { langfuse_trace_id: "trace-3039" };

  constructor() {
    super({ agentId: "feedback-agent", threadId: "feedback-thread" });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);
    const messageId = `assistant-${this.inputs.length}`;
    return of(
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
        rawEvent: this.rawEvent,
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: "Answer",
      },
      { type: EventType.TEXT_MESSAGE_END, messageId },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    );
  }
}

describe("CopilotChatMessageView feedback raw event", () => {
  it("joins direct start metadata at the real thumbs callback boundary", async () => {
    const agent = new FeedbackAgent();
    const onThumbsUp = vi.fn();
    const onThumbsDown = vi.fn();
    const view = render(
      <CopilotKitProvider agents__unsafe_dev_only={{ "feedback-agent": agent }}>
        <CopilotChatConfigurationProvider
          agentId="feedback-agent"
          threadId="feedback-thread"
        >
          <CopilotChatMessageView
            messages={agent.messages}
            assistantMessage={{ onThumbsUp, onThumbsDown }}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await act(async () => {
      await agent.runAgent({ runId: "feedback-run-1" });
    });
    expect(agent.rawEvent).toEqual({ langfuse_trace_id: "trace-3039" });
    view.rerender(
      <CopilotKitProvider agents__unsafe_dev_only={{ "feedback-agent": agent }}>
        <CopilotChatConfigurationProvider
          agentId="feedback-agent"
          threadId="feedback-thread"
        >
          <CopilotChatMessageView
            messages={agent.messages}
            assistantMessage={{ onThumbsUp, onThumbsDown }}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /good response/i }));
    fireEvent.click(screen.getByRole("button", { name: /bad response/i }));

    expect(onThumbsUp).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "assistant-1",
        rawEvent: { langfuse_trace_id: "trace-3039" },
      }),
    );
    expect(onThumbsDown).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "assistant-1",
        rawEvent: { langfuse_trace_id: "trace-3039" },
      }),
    );
    expect(onThumbsUp.mock.calls[0]?.[0]).not.toBe(agent.messages[0]);
    for (const message of agent.messages) {
      expect(Object.prototype.hasOwnProperty.call(message, "rawEvent")).toBe(
        false,
      );
    }

    await act(async () => {
      await agent.runAgent({ runId: "feedback-run-2" });
    });
    expect(
      agent.inputs[1]?.messages.some((message) =>
        Object.prototype.hasOwnProperty.call(message, "rawEvent"),
      ),
    ).toBe(false);
  });
});
