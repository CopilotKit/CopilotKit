import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { of } from "rxjs";
import type { Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { ScrollElementContext } from "../scroll-element-context";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 100,
    getVirtualItems: () =>
      count > 0
        ? [
            {
              index: count - 1,
              key: count - 1,
              start: (count - 1) * 100,
              size: 100,
              end: count * 100,
            },
          ]
        : [],
    getScrollElement: () => null,
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}));

class FeedbackAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];

  constructor(
    readonly rawEvent: Record<string, unknown> = {
      langfuse_trace_id: "trace-3039",
    },
  ) {
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

let thumbsUpButtonRenderCount = 0;

function CountingThumbsUpButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  thumbsUpButtonRenderCount++;
  return <button aria-label="Good response" {...props} />;
}

function renderFeedbackView(
  agent: FeedbackAgent,
  messages: Message[] = agent.messages,
  callbacks: {
    onThumbsUp?: (message: Message) => void;
    onThumbsDown?: (message: Message) => void;
  } = {},
) {
  return render(
    <CopilotKitProvider agents__unsafe_dev_only={{ "feedback-agent": agent }}>
      <CopilotChatConfigurationProvider
        agentId="feedback-agent"
        threadId="feedback-thread"
      >
        <CopilotChatMessageView
          messages={messages}
          assistantMessage={callbacks}
        />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
}

describe("CopilotChatMessageView feedback raw event", () => {
  it("joins direct start metadata at the real thumbs callback boundary", async () => {
    const agent = new FeedbackAgent();
    const onThumbsUp = vi.fn();
    const onThumbsDown = vi.fn();
    const view = renderFeedbackView(agent, agent.messages, {
      onThumbsUp,
      onThumbsDown,
    });

    await act(async () => {
      await agent.runAgent({ runId: "feedback-run-1" });
    });
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
    const thumbsUpMessage = onThumbsUp.mock.calls[0]?.[0] as Message & {
      rawEvent?: { langfuse_trace_id: string };
    };
    expect(thumbsUpMessage).toMatchObject({
      id: "assistant-1",
      rawEvent: { langfuse_trace_id: "trace-3039" },
    });
    thumbsUpMessage.rawEvent!.langfuse_trace_id = "changed-by-callback";

    fireEvent.click(screen.getByRole("button", { name: /bad response/i }));
    expect(onThumbsDown).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "assistant-1",
        rawEvent: { langfuse_trace_id: "trace-3039" },
      }),
    );
    expect(thumbsUpMessage).not.toBe(agent.messages[0]);
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

    view.unmount();
  });

  it("does not serialize a large sidecar payload during render", async () => {
    const agent = new FeedbackAgent({
      langfuse_trace_id: "trace-3039",
      payload: "x".repeat(100_000),
    });
    const onThumbsUp = vi.fn();
    const view = renderFeedbackView(agent, agent.messages, { onThumbsUp });

    await act(async () => {
      await agent.runAgent({ runId: "render-cost-run" });
    });
    const stringify = vi.spyOn(JSON, "stringify");
    view.rerender(
      <CopilotKitProvider agents__unsafe_dev_only={{ "feedback-agent": agent }}>
        <CopilotChatConfigurationProvider
          agentId="feedback-agent"
          threadId="feedback-thread"
        >
          <CopilotChatMessageView
            messages={agent.messages}
            assistantMessage={{ onThumbsUp }}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    expect(
      stringify.mock.calls.some(([value]) => value === agent.rawEvent),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /good response/i }));
    expect(onThumbsUp).toHaveBeenCalledWith(
      expect.objectContaining({ rawEvent: agent.rawEvent }),
    );
    stringify.mockRestore();
    view.unmount();
  });

  it("keeps assistant slot props stable across unrelated configuration changes", () => {
    thumbsUpButtonRenderCount = 0;
    const agent = new FeedbackAgent();
    const onThumbsUp = vi.fn();
    const assistantMessage = {
      onThumbsUp,
      thumbsUpButton: CountingThumbsUpButton,
    };
    const view = render(
      <CopilotKitProvider agents__unsafe_dev_only={{ "feedback-agent": agent }}>
        <CopilotChatConfigurationProvider
          agentId="feedback-agent"
          threadId="feedback-thread"
          labels={{ chatInputPlaceholder: "first" }}
        >
          <CopilotChatMessageView
            messages={[
              { id: "assistant-1", role: "assistant", content: "Answer" },
            ]}
            assistantMessage={assistantMessage}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    const initialRenderCount = thumbsUpButtonRenderCount;
    expect(initialRenderCount).toBeGreaterThan(0);

    view.rerender(
      <CopilotKitProvider agents__unsafe_dev_only={{ "feedback-agent": agent }}>
        <CopilotChatConfigurationProvider
          agentId="feedback-agent"
          threadId="feedback-thread"
          labels={{ chatInputPlaceholder: "second" }}
        >
          <CopilotChatMessageView
            messages={[
              { id: "assistant-1", role: "assistant", content: "Answer" },
            ]}
            assistantMessage={assistantMessage}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    expect(thumbsUpButtonRenderCount).toBe(initialRenderCount);
    view.unmount();
  });

  it("routes feedback through the shared adapter in the virtualized path", async () => {
    const agent = new FeedbackAgent();
    const onThumbsUp = vi.fn();
    const fakeScrollElement = document.createElement("div");
    Object.defineProperty(fakeScrollElement, "clientHeight", {
      get: () => 600,
      configurable: true,
    });
    fakeScrollElement.getBoundingClientRect = () =>
      ({
        height: 600,
        width: 800,
        top: 0,
        left: 0,
        bottom: 600,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const view = render(
      <CopilotKitProvider agents__unsafe_dev_only={{ "feedback-agent": agent }}>
        <CopilotChatConfigurationProvider
          agentId="feedback-agent"
          threadId="feedback-thread"
        >
          <ScrollElementContext.Provider value={fakeScrollElement}>
            <CopilotChatMessageView
              messages={agent.messages}
              assistantMessage={{ onThumbsUp }}
            />
          </ScrollElementContext.Provider>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await act(async () => {
      await agent.runAgent({ runId: "virtual-run" });
      agent.setMessages([
        ...Array.from({ length: 50 }, (_, index) => ({
          id: `history-${index}`,
          role: "assistant" as const,
          content: `History ${index}`,
        })),
        ...agent.messages,
      ]);
    });
    view.rerender(
      <CopilotKitProvider agents__unsafe_dev_only={{ "feedback-agent": agent }}>
        <CopilotChatConfigurationProvider
          agentId="feedback-agent"
          threadId="feedback-thread"
        >
          <ScrollElementContext.Provider value={fakeScrollElement}>
            <CopilotChatMessageView
              messages={agent.messages}
              assistantMessage={{ onThumbsUp }}
            />
          </ScrollElementContext.Provider>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(
        document.querySelector(
          '[data-testid="copilot-message-list"] > div[style*="position: relative"]',
        ),
      ).not.toBeNull();
      expect(
        screen.getByRole("button", { name: /good response/i }),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /good response/i }));
    expect(onThumbsUp).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "assistant-1",
        rawEvent: { langfuse_trace_id: "trace-3039" },
      }),
    );

    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    view.unmount();
  });
});
