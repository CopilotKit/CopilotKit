import React, { useRef, useState } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { z } from "zod";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChat } from "../CopilotChat";
import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { Observable, Subject } from "rxjs";
import {
  defineToolCallRenderer,
  ReactToolCallRenderer,
} from "@/types";
import { ToolCallStatus } from "@copilotkitnext/core";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { CopilotChatView, CopilotChatViewProps } from "../CopilotChatView";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";
import { ActivityMessage, AssistantMessage, Message } from "@ag-ui/core";
import { ReactActivityMessageRenderer, ReactCustomMessageRenderer } from "@/types";
import CopilotChatInput, { CopilotChatInputProps } from "../CopilotChatInput";
import { CopilotChatSuggestionView } from "../CopilotChatSuggestionView";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";

// A controllable streaming agent to step through events deterministically
class MockStepwiseAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();

  emit(event: BaseEvent) {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    this.subject.next(event);
  }

  complete() {
    this.isRunning = false;
    this.subject.complete();
  }

  clone(): MockStepwiseAgent {
    // For tests, return same instance so we can keep controlling it.
    return this;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
  }
}

describe("Tool Call Re-render Prevention", () => {
  it("should not re-render a completed tool call when subsequent text is streamed", async () => {
    const agent = new MockStepwiseAgent();

    // Track render counts for the tool renderer
    let toolRenderCount = 0;
    let lastRenderStatus: string | null = null;
    let lastRenderArgs: Record<string, unknown> | null = null;

    const renderToolCalls = [
      defineToolCallRenderer({
        name: "getWeather",
        args: z.object({
          location: z.string(),
        }),
        render: ({ status, args, result }) => {
          toolRenderCount++;
          lastRenderStatus = status;
          lastRenderArgs = args as Record<string, unknown>;

          return (
            <div data-testid="weather-tool">
              <span data-testid="render-count">{toolRenderCount}</span>
              <span data-testid="status">{status}</span>
              <span data-testid="location">{args.location}</span>
              <span data-testid="result">{result ? String(result) : "pending"}</span>
            </div>
          );
        },
      }),
    ] as unknown as ReactToolCallRenderer<unknown>[];

    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderToolCalls={renderToolCalls}
      >
        <div style={{ height: 400 }}>
          <CopilotChat />
        </div>
      </CopilotKitProvider>
    );

    // Submit a user message to trigger runAgent
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "What's the weather?" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("What's the weather?")).toBeDefined();
    });

    const messageId = "m_rerender_test";
    const toolCallId = "tc_rerender_test";

    // Start the run
    agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);

    // Stream the tool call with complete args
    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "getWeather",
      parentMessageId: messageId,
      delta: '{"location":"Paris"}',
    } as BaseEvent);

    // Wait for tool to render with InProgress status
    await waitFor(() => {
      const statusEl = screen.getByTestId("status");
      expect(statusEl.textContent).toBe("inProgress");
      expect(screen.getByTestId("location").textContent).toBe("Paris");
    });

    const renderCountAfterToolCall = toolRenderCount;

    // Send the tool result to complete the tool call
    agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      messageId: `${messageId}_result`,
      content: JSON.stringify({ temperature: 22, condition: "sunny" }),
    } as BaseEvent);

    // Wait for tool to show Complete status
    await waitFor(() => {
      const statusEl = screen.getByTestId("status");
      expect(statusEl.textContent).toBe("complete");
    });

    const renderCountAfterComplete = toolRenderCount;

    // Sanity check: it should have re-rendered at least once to show complete status
    expect(renderCountAfterComplete).toBeGreaterThan(renderCountAfterToolCall);

    // Now stream additional text AFTER the tool call is complete
    // This should NOT cause the tool call renderer to re-render
    agent.emit({
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: "m_followup",
      delta: "The weather in Paris is ",
    } as BaseEvent);

    // Wait a moment for React to process
    await waitFor(() => {
      expect(screen.getByText(/The weather in Paris is/)).toBeDefined();
    });

    const renderCountAfterFirstTextChunk = toolRenderCount;

    // Stream more text chunks
    agent.emit({
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: "m_followup",
      delta: "currently sunny ",
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByText(/currently sunny/)).toBeDefined();
    });

    agent.emit({
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: "m_followup",
      delta: "with a temperature of 22°C.",
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByText(/22°C/)).toBeDefined();
    });

    const renderCountAfterAllText = toolRenderCount;

    // THE KEY ASSERTION: The tool should NOT have re-rendered after it was complete
    // and we started streaming text
    expect(renderCountAfterAllText).toBe(renderCountAfterComplete);

    // Verify the tool still shows the correct completed state
    expect(screen.getByTestId("status").textContent).toBe("complete");
    expect(screen.getByTestId("location").textContent).toBe("Paris");
    expect(screen.getByTestId("result").textContent).toContain("temperature");

    agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
    agent.complete();
  });

  it("should not re-render a tool call when its arguments have not changed during streaming", async () => {
    const agent = new MockStepwiseAgent();

    // Track render counts
    let toolRenderCount = 0;

    const renderToolCalls = [
      defineToolCallRenderer({
        name: "search",
        args: z.object({
          query: z.string(),
        }),
        render: ({ status, args }) => {
          toolRenderCount++;

          return (
            <div data-testid="search-tool">
              <span data-testid="search-render-count">{toolRenderCount}</span>
              <span data-testid="search-status">{status}</span>
              <span data-testid="search-query">{args.query}</span>
            </div>
          );
        },
      }),
    ] as unknown as ReactToolCallRenderer<unknown>[];

    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderToolCalls={renderToolCalls}
      >
        <div style={{ height: 400 }}>
          <CopilotChat />
        </div>
      </CopilotKitProvider>
    );

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Search for something" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Search for something")).toBeDefined();
    });

    const messageId = "m_search";
    const toolCallId = "tc_search";

    agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);

    // Stream complete tool call args
    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "search",
      parentMessageId: messageId,
      delta: '{"query":"React hooks"}',
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("search-query").textContent).toBe("React hooks");
    });

    const renderCountAfterToolCall = toolRenderCount;

    // Stream text in the same message (before tool result)
    // This simulates the agent adding explanation text while tool is in progress
    agent.emit({
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId,
      delta: "Let me search for that...",
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByText(/Let me search for that/)).toBeDefined();
    });

    const renderCountAfterText = toolRenderCount;

    // The tool call should NOT re-render just because text was added to the message
    // since its arguments haven't changed
    expect(renderCountAfterText).toBe(renderCountAfterToolCall);

    agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
    agent.complete();
  });

  it("should re-render a tool call when its arguments change during streaming", async () => {
    const agent = new MockStepwiseAgent();

    // Track render counts and captured args
    let toolRenderCount = 0;
    const capturedArgs: string[] = [];

    const renderToolCalls = [
      defineToolCallRenderer({
        name: "search",
        args: z.object({
          query: z.string(),
        }),
        render: ({ args }) => {
          toolRenderCount++;
          capturedArgs.push(args.query!);

          return (
            <div data-testid="search-tool">
              <span data-testid="search-render-count">{toolRenderCount}</span>
              <span data-testid="search-query">{args.query}</span>
            </div>
          );
        },
      }),
    ] as unknown as ReactToolCallRenderer<unknown>[];

    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderToolCalls={renderToolCalls}
      >
        <div style={{ height: 400 }}>
          <CopilotChat />
        </div>
      </CopilotKitProvider>
    );

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Search for something" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Search for something")).toBeDefined();
    });

    const messageId = "m_search_update";
    const toolCallId = "tc_search_update";

    agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);

    // Stream partial args first
    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "search",
      parentMessageId: messageId,
      delta: '{"query":"Rea',
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("search-query").textContent).toBe("Rea");
    });

    const renderCountAfterFirstChunk = toolRenderCount;

    // Stream more args
    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "search",
      parentMessageId: messageId,
      delta: 'ct hooks"}',
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("search-query").textContent).toBe("React hooks");
    });

    const renderCountAfterSecondChunk = toolRenderCount;

    // THE KEY ASSERTION: Tool should re-render when arguments change
    expect(renderCountAfterSecondChunk).toBeGreaterThan(renderCountAfterFirstChunk);
    expect(capturedArgs).toContain("Rea");
    expect(capturedArgs).toContain("React hooks");

    agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
    agent.complete();
  });

  it("should re-render a tool call when status changes to complete", async () => {
    const agent = new MockStepwiseAgent();

    let toolRenderCount = 0;
    const capturedStatuses: string[] = [];

    const renderToolCalls = [
      defineToolCallRenderer({
        name: "getData",
        args: z.object({ id: z.string() }),
        render: ({ status, result }) => {
          toolRenderCount++;
          capturedStatuses.push(status);

          return (
            <div data-testid="data-tool">
              <span data-testid="data-status">{status}</span>
              <span data-testid="data-result">{result ? String(result) : "none"}</span>
            </div>
          );
        },
      }),
    ] as unknown as ReactToolCallRenderer<unknown>[];

    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderToolCalls={renderToolCalls}
      >
        <div style={{ height: 400 }}>
          <CopilotChat />
        </div>
      </CopilotKitProvider>
    );

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Get data" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Get data")).toBeDefined();
    });

    const messageId = "m_data";
    const toolCallId = "tc_data";

    agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);

    // Send tool call
    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "getData",
      parentMessageId: messageId,
      delta: '{"id":"123"}',
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("data-status").textContent).toBe("inProgress");
    });

    const renderCountBeforeResult = toolRenderCount;

    // Send tool result
    agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      messageId: `${messageId}_result`,
      content: JSON.stringify({ data: "found" }),
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("data-status").textContent).toBe("complete");
    });

    const renderCountAfterResult = toolRenderCount;

    // THE KEY ASSERTION: Tool should re-render when status changes
    expect(renderCountAfterResult).toBeGreaterThan(renderCountBeforeResult);
    expect(capturedStatuses).toContain("inProgress");
    expect(capturedStatuses).toContain("complete");

    agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
    agent.complete();
  });
});

describe("Text Message Re-render Prevention", () => {
  it("should not re-render a previous assistant message when a new message streams in", async () => {
    // Track render counts per message ID
    const renderCounts: Record<string, number> = {};

    // Custom assistant message component that tracks renders
    const TrackedAssistantMessage: React.FC<{
      message: AssistantMessage;
      messages?: Message[];
      isRunning?: boolean;
    }> = ({ message }) => {
      // Increment render count for this message
      renderCounts[message.id] = (renderCounts[message.id] || 0) + 1;

      return (
        <div data-testid={`assistant-message-${message.id}`}>
          <span data-testid={`content-${message.id}`}>{message.content}</span>
          <span data-testid={`render-count-${message.id}`}>
            {renderCounts[message.id]}
          </span>
        </div>
      );
    };

    // Initial messages - one complete assistant message
    const initialMessages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Hello! How can I help you today?",
      } as AssistantMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={false}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    // Verify first message rendered
    await waitFor(() => {
      expect(screen.getByTestId("assistant-message-msg-1")).toBeDefined();
    });

    const firstMessageRenderCountAfterInitial = renderCounts["msg-1"];
    expect(firstMessageRenderCountAfterInitial).toBe(1);

    // Simulate streaming a second message - first chunk
    const messagesWithSecondPartial: Message[] = [
      ...initialMessages,
      {
        id: "msg-2",
        role: "assistant",
        content: "Let me help",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithSecondPartial}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("assistant-message-msg-2")).toBeDefined();
    });

    const firstMessageRenderCountAfterSecondMessage = renderCounts["msg-1"];

    // Continue streaming the second message
    const messagesWithMoreContent: Message[] = [
      ...initialMessages,
      {
        id: "msg-2",
        role: "assistant",
        content: "Let me help you with that task.",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithMoreContent}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("content-msg-2").textContent).toBe(
        "Let me help you with that task."
      );
    });

    // Stream even more content
    const messagesWithEvenMoreContent: Message[] = [
      ...initialMessages,
      {
        id: "msg-2",
        role: "assistant",
        content: "Let me help you with that task. Here's what I found:",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithEvenMoreContent}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("content-msg-2").textContent).toContain(
        "Here's what I found"
      );
    });

    const firstMessageRenderCountAfterAllStreaming = renderCounts["msg-1"];

    // THE KEY ASSERTION: The first message should NOT have re-rendered
    // when the second message was streaming
    expect(firstMessageRenderCountAfterAllStreaming).toBe(
      firstMessageRenderCountAfterInitial
    );

    // Verify the second message did update (it should have rendered multiple times)
    expect(renderCounts["msg-2"]).toBeGreaterThan(1);
  });

  it("should not re-render a user message when assistant message streams", async () => {
    const renderCounts: Record<string, number> = {};

    const TrackedAssistantMessage: React.FC<{
      message: AssistantMessage;
      messages?: Message[];
      isRunning?: boolean;
    }> = ({ message }) => {
      renderCounts[message.id] = (renderCounts[message.id] || 0) + 1;
      return (
        <div data-testid={`assistant-message-${message.id}`}>
          <span data-testid={`content-${message.id}`}>{message.content}</span>
        </div>
      );
    };

    const TrackedUserMessage: React.FC<{
      message: Message;
    }> = ({ message }) => {
      renderCounts[message.id] = (renderCounts[message.id] || 0) + 1;
      return (
        <div data-testid={`user-message-${message.id}`}>
          <span data-testid={`user-content-${message.id}`}>
            {typeof message.content === "string" ? message.content : ""}
          </span>
          <span data-testid={`user-render-count-${message.id}`}>
            {renderCounts[message.id]}
          </span>
        </div>
      );
    };

    const initialMessages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Hello!",
      },
    ];

    const { rerender } = render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={false}
            assistantMessage={TrackedAssistantMessage as any}
            userMessage={TrackedUserMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-message-user-1")).toBeDefined();
    });

    const userMessageRenderCountInitial = renderCounts["user-1"];
    expect(userMessageRenderCountInitial).toBe(1);

    // Add assistant response and stream it
    const messagesWithAssistant: Message[] = [
      ...initialMessages,
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hi there!",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithAssistant}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
            userMessage={TrackedUserMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    // Stream more content
    const messagesWithMoreAssistant: Message[] = [
      ...initialMessages,
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hi there! How can I assist you today?",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithMoreAssistant}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
            userMessage={TrackedUserMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("content-assistant-1").textContent).toContain(
        "How can I assist"
      );
    });

    const userMessageRenderCountAfterStreaming = renderCounts["user-1"];

    // THE KEY ASSERTION: User message should not re-render when assistant streams
    expect(userMessageRenderCountAfterStreaming).toBe(
      userMessageRenderCountInitial
    );
  });

  it("should re-render an assistant message when its content changes", async () => {
    const renderCounts: Record<string, number> = {};
    const capturedContent: string[] = [];

    const TrackedAssistantMessage: React.FC<{
      message: AssistantMessage;
      messages?: Message[];
      isRunning?: boolean;
    }> = ({ message }) => {
      renderCounts[message.id] = (renderCounts[message.id] || 0) + 1;
      capturedContent.push(message.content ?? "");
      return (
        <div data-testid={`assistant-message-${message.id}`}>
          <span data-testid={`content-${message.id}`}>{message.content}</span>
        </div>
      );
    };

    const initialMessages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Hello",
      } as AssistantMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("assistant-message-msg-1")).toBeDefined();
    });

    const renderCountAfterInitial = renderCounts["msg-1"]!;
    expect(renderCountAfterInitial).toBe(1);

    // Update message content (streaming)
    const updatedMessages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Hello! How can I help",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={updatedMessages}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("content-msg-1").textContent).toBe(
        "Hello! How can I help"
      );
    });

    const renderCountAfterUpdate = renderCounts["msg-1"]!;

    // THE KEY ASSERTION: Message should re-render when content changes
    expect(renderCountAfterUpdate).toBeGreaterThan(renderCountAfterInitial);
    expect(capturedContent).toContain("Hello");
    expect(capturedContent).toContain("Hello! How can I help");
  });

  it("should re-render a user message when its content changes", async () => {
    const renderCounts: Record<string, number> = {};
    const capturedContent: string[] = [];

    const TrackedUserMessage: React.FC<{
      message: Message;
    }> = ({ message }) => {
      renderCounts[message.id] = (renderCounts[message.id] || 0) + 1;
      const content = typeof message.content === "string" ? message.content : "";
      capturedContent.push(content);
      return (
        <div data-testid={`user-message-${message.id}`}>
          <span data-testid={`user-content-${message.id}`}>{content}</span>
        </div>
      );
    };

    const initialMessages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Initial message",
      },
    ];

    const { rerender } = render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={false}
            userMessage={TrackedUserMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-message-user-1")).toBeDefined();
    });

    const renderCountAfterInitial = renderCounts["user-1"]!;
    expect(renderCountAfterInitial).toBe(1);

    // Update user message content (e.g., editing)
    const updatedMessages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Updated message",
      },
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={updatedMessages}
            isRunning={false}
            userMessage={TrackedUserMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-content-user-1").textContent).toBe(
        "Updated message"
      );
    });

    const renderCountAfterUpdate = renderCounts["user-1"]!;

    // THE KEY ASSERTION: User message should re-render when content changes
    expect(renderCountAfterUpdate).toBeGreaterThan(renderCountAfterInitial);
    expect(capturedContent).toContain("Initial message");
    expect(capturedContent).toContain("Updated message");
  });
});

describe("Activity Message Re-render Prevention", () => {
  it("should not re-render a previous activity message when a new message streams in", async () => {
    // Track render counts per message ID
    const renderCounts: Record<string, number> = {};

    // Custom activity renderer that tracks renders
    const activityRenderer: ReactActivityMessageRenderer<{ status: string; percent: number }> = {
      activityType: "search-progress",
      content: z.object({ status: z.string(), percent: z.number() }),
      render: ({ content, message }) => {
        renderCounts[message.id] = (renderCounts[message.id] || 0) + 1;
        return (
          <div data-testid={`activity-${message.id}`}>
            <span data-testid={`activity-content-${message.id}`}>
              {content.status} - {content.percent}%
            </span>
            <span data-testid={`activity-render-count-${message.id}`}>
              {renderCounts[message.id]}
            </span>
          </div>
        );
      },
    };

    // Initial messages - one activity message
    const initialMessages: Message[] = [
      {
        id: "activity-1",
        role: "activity",
        activityType: "search-progress",
        content: { status: "Searching", percent: 50 },
      } as ActivityMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider renderActivityMessages={[activityRenderer]}>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={true}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    // Verify first activity rendered
    await waitFor(() => {
      expect(screen.getByTestId("activity-activity-1")).toBeDefined();
    });

    const firstActivityRenderCountAfterInitial = renderCounts["activity-1"];
    expect(firstActivityRenderCountAfterInitial).toBe(1);

    // Add a second activity message
    const messagesWithSecondActivity: Message[] = [
      ...initialMessages,
      {
        id: "activity-2",
        role: "activity",
        activityType: "search-progress",
        content: { status: "Processing", percent: 75 },
      } as ActivityMessage,
    ];

    rerender(
      <CopilotKitProvider renderActivityMessages={[activityRenderer]}>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithSecondActivity}
            isRunning={true}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("activity-activity-2")).toBeDefined();
    });

    // Update the second activity message
    const messagesWithUpdatedSecondActivity: Message[] = [
      initialMessages[0]!,
      {
        id: "activity-2",
        role: "activity",
        activityType: "search-progress",
        content: { status: "Almost done", percent: 90 },
      } as ActivityMessage,
    ];

    rerender(
      <CopilotKitProvider renderActivityMessages={[activityRenderer]}>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithUpdatedSecondActivity}
            isRunning={true}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("activity-content-activity-2").textContent).toContain(
        "Almost done"
      );
    });

    const firstActivityRenderCountAfterAllUpdates = renderCounts["activity-1"];

    // THE KEY ASSERTION: The first activity should NOT have re-rendered
    // when the second activity was added or updated
    expect(firstActivityRenderCountAfterAllUpdates).toBe(
      firstActivityRenderCountAfterInitial
    );

    // Verify the second activity did update (it should have rendered multiple times)
    expect(renderCounts["activity-2"]).toBeGreaterThan(1);
  });

  it("should not re-render an activity message when an assistant message streams", async () => {
    const renderCounts: Record<string, number> = {};

    const activityRenderer: ReactActivityMessageRenderer<{ status: string }> = {
      activityType: "progress",
      content: z.object({ status: z.string() }),
      render: ({ content, message }) => {
        renderCounts[message.id] = (renderCounts[message.id] || 0) + 1;
        return (
          <div data-testid={`activity-${message.id}`}>
            {content.status}
          </div>
        );
      },
    };

    const TrackedAssistantMessage: React.FC<{
      message: AssistantMessage;
      messages?: Message[];
      isRunning?: boolean;
    }> = ({ message }) => {
      renderCounts[message.id] = (renderCounts[message.id] || 0) + 1;
      return (
        <div data-testid={`assistant-${message.id}`}>
          {message.content}
        </div>
      );
    };

    const initialMessages: Message[] = [
      {
        id: "activity-1",
        role: "activity",
        activityType: "progress",
        content: { status: "Loading..." },
      } as ActivityMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider renderActivityMessages={[activityRenderer]}>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("activity-activity-1")).toBeDefined();
    });

    const activityRenderCountInitial = renderCounts["activity-1"];
    expect(activityRenderCountInitial).toBe(1);

    // Add an assistant message and stream it
    const messagesWithAssistant: Message[] = [
      ...initialMessages,
      {
        id: "assistant-1",
        role: "assistant",
        content: "Here's what I found...",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider renderActivityMessages={[activityRenderer]}>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithAssistant}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    // Stream more content
    const messagesWithMoreAssistant: Message[] = [
      initialMessages[0]!,
      {
        id: "assistant-1",
        role: "assistant",
        content: "Here's what I found... The results show that...",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider renderActivityMessages={[activityRenderer]}>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithMoreAssistant}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("assistant-assistant-1").textContent).toContain(
        "The results show"
      );
    });

    const activityRenderCountAfterStreaming = renderCounts["activity-1"];

    // THE KEY ASSERTION: Activity message should not re-render when assistant streams
    expect(activityRenderCountAfterStreaming).toBe(activityRenderCountInitial);
  });

  it("should re-render an activity message when its content changes", async () => {
    const renderCounts: Record<string, number> = {};
    const capturedContent: { status: string; percent: number }[] = [];

    const activityRenderer: ReactActivityMessageRenderer<{ status: string; percent: number }> = {
      activityType: "progress",
      content: z.object({ status: z.string(), percent: z.number() }),
      render: ({ content, message }) => {
        renderCounts[message.id] = (renderCounts[message.id] || 0) + 1;
        capturedContent.push({ ...content });
        return (
          <div data-testid={`activity-${message.id}`}>
            <span data-testid={`activity-status-${message.id}`}>{content.status}</span>
            <span data-testid={`activity-percent-${message.id}`}>{content.percent}</span>
          </div>
        );
      },
    };

    const initialMessages: Message[] = [
      {
        id: "activity-1",
        role: "activity",
        activityType: "progress",
        content: { status: "Starting", percent: 0 },
      } as ActivityMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider renderActivityMessages={[activityRenderer]}>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={true}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("activity-activity-1")).toBeDefined();
    });

    const renderCountAfterInitial = renderCounts["activity-1"]!;
    expect(renderCountAfterInitial).toBe(1);

    // Update activity content (progress update)
    const updatedMessages: Message[] = [
      {
        id: "activity-1",
        role: "activity",
        activityType: "progress",
        content: { status: "Processing", percent: 50 },
      } as ActivityMessage,
    ];

    rerender(
      <CopilotKitProvider renderActivityMessages={[activityRenderer]}>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={updatedMessages}
            isRunning={true}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("activity-status-activity-1").textContent).toBe("Processing");
      expect(screen.getByTestId("activity-percent-activity-1").textContent).toBe("50");
    });

    const renderCountAfterUpdate = renderCounts["activity-1"]!;

    // THE KEY ASSERTION: Activity should re-render when content changes
    expect(renderCountAfterUpdate).toBeGreaterThan(renderCountAfterInitial);
    expect(capturedContent).toContainEqual({ status: "Starting", percent: 0 });
    expect(capturedContent).toContainEqual({ status: "Processing", percent: 50 });
  });

  it("should re-render an activity message when its activityType changes", async () => {
    const renderCounts: Record<string, number> = {};

    const progressRenderer: ReactActivityMessageRenderer<{ status: string }> = {
      activityType: "progress",
      content: z.object({ status: z.string() }),
      render: ({ content, message }) => {
        renderCounts[message.id] = (renderCounts[message.id] || 0) + 1;
        return (
          <div data-testid={`activity-${message.id}`}>
            <span data-testid={`activity-type-${message.id}`}>progress</span>
            <span data-testid={`activity-status-${message.id}`}>{content.status}</span>
          </div>
        );
      },
    };

    const completedRenderer: ReactActivityMessageRenderer<{ result: string }> = {
      activityType: "completed",
      content: z.object({ result: z.string() }),
      render: ({ content, message }) => {
        renderCounts[message.id] = (renderCounts[message.id] || 0) + 1;
        return (
          <div data-testid={`activity-${message.id}`}>
            <span data-testid={`activity-type-${message.id}`}>completed</span>
            <span data-testid={`activity-result-${message.id}`}>{content.result}</span>
          </div>
        );
      },
    };

    const initialMessages: Message[] = [
      {
        id: "activity-1",
        role: "activity",
        activityType: "progress",
        content: { status: "Loading..." },
      } as ActivityMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider renderActivityMessages={[progressRenderer, completedRenderer]}>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={true}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("activity-type-activity-1").textContent).toBe("progress");
    });

    const renderCountAfterInitial = renderCounts["activity-1"]!;
    expect(renderCountAfterInitial).toBe(1);

    // Change activity type
    const updatedMessages: Message[] = [
      {
        id: "activity-1",
        role: "activity",
        activityType: "completed",
        content: { result: "Done!" },
      } as ActivityMessage,
    ];

    rerender(
      <CopilotKitProvider renderActivityMessages={[progressRenderer, completedRenderer]}>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={updatedMessages}
            isRunning={false}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("activity-type-activity-1").textContent).toBe("completed");
    });

    const renderCountAfterTypeChange = renderCounts["activity-1"]!;

    // THE KEY ASSERTION: Activity should re-render when activityType changes
    expect(renderCountAfterTypeChange).toBeGreaterThan(renderCountAfterInitial);
  });
});

describe("Custom Message Re-render Prevention", () => {
  it("should not re-render a custom message for a previous message when a new message streams in", async () => {
    const agent = new MockStepwiseAgent();

    // Track render counts by message ID and position
    const renderCounts: Record<string, number> = {};

    // Custom message renderer that tracks renders
    const customRenderer: ReactCustomMessageRenderer = {
      render: ({ message, position }) => {
        // Only render for assistant messages in "after" position
        if (message.role !== "assistant" || position !== "after") {
          return null;
        }

        const key = `${message.id}-${position}`;
        renderCounts[key] = (renderCounts[key] || 0) + 1;

        return (
          <div data-testid={`custom-${message.id}`}>
            <span data-testid={`custom-content-${message.id}`}>
              Custom content for {message.id}
            </span>
            <span data-testid={`custom-render-count-${message.id}`}>
              {renderCounts[key]}
            </span>
          </div>
        );
      },
    };

    // Initial messages - one assistant message
    const initialMessages: Message[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hello! How can I help you?",
      } as AssistantMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderCustomMessages={[customRenderer]}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={false}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    // Verify first custom message rendered
    await waitFor(() => {
      expect(screen.getByTestId("custom-assistant-1")).toBeDefined();
    });

    const firstCustomRenderCountAfterInitial = renderCounts["assistant-1-after"];
    expect(firstCustomRenderCountAfterInitial).toBe(1);

    // Add a second assistant message
    const messagesWithSecond: Message[] = [
      ...initialMessages,
      {
        id: "assistant-2",
        role: "assistant",
        content: "Here's some more info...",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderCustomMessages={[customRenderer]}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithSecond}
            isRunning={true}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("custom-assistant-2")).toBeDefined();
    });

    // Update the second message (streaming more content)
    const messagesWithUpdatedSecond: Message[] = [
      initialMessages[0]!,
      {
        id: "assistant-2",
        role: "assistant",
        content: "Here's some more info... Let me explain in detail.",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderCustomMessages={[customRenderer]}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithUpdatedSecond}
            isRunning={true}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    // Stream even more content
    const messagesWithMoreContent: Message[] = [
      initialMessages[0]!,
      {
        id: "assistant-2",
        role: "assistant",
        content: "Here's some more info... Let me explain in detail. This is comprehensive.",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderCustomMessages={[customRenderer]}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithMoreContent}
            isRunning={false}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    const firstCustomRenderCountAfterAllUpdates = renderCounts["assistant-1-after"];

    // THE KEY ASSERTION: The first custom message should NOT have re-rendered
    // when the second message was streaming
    expect(firstCustomRenderCountAfterAllUpdates).toBe(
      firstCustomRenderCountAfterInitial
    );

    // Verify the second custom message did update
    expect(renderCounts["assistant-2-after"]).toBeGreaterThan(1);
  });

  it("should not re-render custom messages when isRunning changes but message content is the same", async () => {
    const agent = new MockStepwiseAgent();
    const renderCounts: Record<string, number> = {};

    const customRenderer: ReactCustomMessageRenderer = {
      render: ({ message, position }) => {
        if (message.role !== "assistant" || position !== "after") {
          return null;
        }

        const key = `${message.id}-${position}`;
        renderCounts[key] = (renderCounts[key] || 0) + 1;

        return (
          <div data-testid={`custom-${message.id}`}>
            Render count: {renderCounts[key]}
          </div>
        );
      },
    };

    const messages: Message[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Complete message",
      } as AssistantMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderCustomMessages={[customRenderer]}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messages}
            isRunning={true}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("custom-assistant-1")).toBeDefined();
    });

    const renderCountWhileRunning = renderCounts["assistant-1-after"]!;
    expect(renderCountWhileRunning).toBe(1);

    // Change isRunning to false (but same messages)
    rerender(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderCustomMessages={[customRenderer]}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messages}
            isRunning={false}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    const renderCountAfterRunningChanged = renderCounts["assistant-1-after"]!;

    // THE KEY ASSERTION: Custom message should not re-render just because isRunning changed
    expect(renderCountAfterRunningChanged).toBe(renderCountWhileRunning);
  });

  it("should re-render a custom message when its message content changes", async () => {
    const agent = new MockStepwiseAgent();
    const renderCounts: Record<string, number> = {};
    const capturedContent: string[] = [];

    const customRenderer: ReactCustomMessageRenderer = {
      render: ({ message, position }) => {
        if (message.role !== "assistant" || position !== "after") {
          return null;
        }

        const key = `${message.id}-${position}`;
        renderCounts[key] = (renderCounts[key] || 0) + 1;
        const content = typeof message.content === "string" ? message.content : "";
        capturedContent.push(content);

        return (
          <div data-testid={`custom-${message.id}`}>
            <span data-testid={`custom-content-${message.id}`}>{content}</span>
            <span data-testid={`custom-render-count-${message.id}`}>
              {renderCounts[key]}
            </span>
          </div>
        );
      },
    };

    const initialMessages: Message[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hello",
      } as AssistantMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderCustomMessages={[customRenderer]}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={true}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("custom-assistant-1")).toBeDefined();
    });

    const renderCountAfterInitial = renderCounts["assistant-1-after"]!;
    expect(renderCountAfterInitial).toBe(1);

    // Update message content (streaming)
    const updatedMessages: Message[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hello! How can I help you today?",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderCustomMessages={[customRenderer]}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={updatedMessages}
            isRunning={true}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("custom-content-assistant-1").textContent).toBe(
        "Hello! How can I help you today?"
      );
    });

    const renderCountAfterUpdate = renderCounts["assistant-1-after"]!;

    // THE KEY ASSERTION: Custom message should re-render when content changes
    expect(renderCountAfterUpdate).toBeGreaterThan(renderCountAfterInitial);
    expect(capturedContent).toContain("Hello");
    expect(capturedContent).toContain("Hello! How can I help you today?");
  });

  it("should re-render a custom message when its message role changes", async () => {
    const agent = new MockStepwiseAgent();
    const renderCounts: Record<string, number> = {};

    const customRenderer: ReactCustomMessageRenderer = {
      render: ({ message, position }) => {
        if (position !== "after") {
          return null;
        }

        const key = `${message.id}-${position}`;
        renderCounts[key] = (renderCounts[key] || 0) + 1;

        return (
          <div data-testid={`custom-${message.id}`}>
            <span data-testid={`custom-role-${message.id}`}>{message.role}</span>
            <span data-testid={`custom-render-count-${message.id}`}>
              {renderCounts[key]}
            </span>
          </div>
        );
      },
    };

    const initialMessages: Message[] = [
      {
        id: "msg-1",
        role: "user",
        content: "Hello",
      },
    ];

    const { rerender } = render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderCustomMessages={[customRenderer]}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={false}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("custom-role-msg-1").textContent).toBe("user");
    });

    const renderCountAfterInitial = renderCounts["msg-1-after"]!;
    expect(renderCountAfterInitial).toBe(1);

    // Change message role (unusual but possible)
    const updatedMessages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Hello",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderCustomMessages={[customRenderer]}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={updatedMessages}
            isRunning={false}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("custom-role-msg-1").textContent).toBe("assistant");
    });

    const renderCountAfterRoleChange = renderCounts["msg-1-after"]!;

    // THE KEY ASSERTION: Custom message should re-render when role changes
    expect(renderCountAfterRoleChange).toBeGreaterThan(renderCountAfterInitial);
  });
});

describe("Input Component Re-render Prevention", () => {
  it("should not re-render the input component when messages stream in", async () => {
    let inputRenderCount = 0;

    // Custom input component that tracks renders
    const TrackedInput: React.FC<CopilotChatInputProps> = (props) => {
      inputRenderCount++;
      return (
        <div data-testid="tracked-input">
          <span data-testid="input-render-count">{inputRenderCount}</span>
          <CopilotChatInput {...props} />
        </div>
      );
    };

    // Use a stable callback reference to properly test memoization
    const stableOnSubmit = () => {};

    const initialMessages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Hello!",
      } as AssistantMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatView
            messages={initialMessages}
            isRunning={false}
            input={TrackedInput as any}
            inputProps={{ onSubmitMessage: stableOnSubmit }}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("tracked-input")).toBeDefined();
    });

    const renderCountAfterInitial = inputRenderCount;
    expect(renderCountAfterInitial).toBe(1);

    // Stream a new message (add more content)
    const updatedMessages: Message[] = [
      ...initialMessages,
      {
        id: "msg-2",
        role: "assistant",
        content: "How can I help?",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatView
            messages={updatedMessages}
            isRunning={false}
            input={TrackedInput as any}
            inputProps={{ onSubmitMessage: stableOnSubmit }}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    // Continue streaming
    const moreMessages: Message[] = [
      ...initialMessages,
      {
        id: "msg-2",
        role: "assistant",
        content: "How can I help you today?",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatView
            messages={moreMessages}
            isRunning={false}
            input={TrackedInput as any}
            inputProps={{ onSubmitMessage: stableOnSubmit }}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    // Even more streaming
    const evenMoreMessages: Message[] = [
      ...initialMessages,
      {
        id: "msg-2",
        role: "assistant",
        content: "How can I help you today? I'm here to assist.",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatView
            messages={evenMoreMessages}
            isRunning={false}
            input={TrackedInput as any}
            inputProps={{ onSubmitMessage: stableOnSubmit }}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    const renderCountAfterStreaming = inputRenderCount;

    // THE KEY ASSERTION: Input should NOT re-render when messages change
    // (since inputProps haven't changed)
    expect(renderCountAfterStreaming).toBe(renderCountAfterInitial);
  });

  it("should re-render a replaced input component when its internal state changes", async () => {
    let externalRenderCount = 0;

    // Custom input with internal state - uses useState to track clicks
    const InputWithInternalState: React.FC<CopilotChatInputProps> = (props) => {
      const [clickCount, setClickCount] = useState(0);
      externalRenderCount++;

      return (
        <div data-testid="stateful-input">
          <span data-testid="external-render-count">{externalRenderCount}</span>
          <span data-testid="click-count">{clickCount}</span>
          <button
            data-testid="increment-button"
            onClick={() => setClickCount((c) => c + 1)}
          >
            Increment
          </button>
          <CopilotChatInput {...props} />
        </div>
      );
    };

    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Hello!",
      } as AssistantMessage,
    ];

    render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatView
            messages={messages}
            isRunning={false}
            input={InputWithInternalState as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("stateful-input")).toBeDefined();
    });

    // Initial state
    expect(screen.getByTestId("click-count").textContent).toBe("0");
    const initialExternalRenderCount = externalRenderCount;
    expect(initialExternalRenderCount).toBe(1);

    // Click the button to trigger internal state change
    const incrementButton = screen.getByTestId("increment-button");
    fireEvent.click(incrementButton);

    // THE KEY ASSERTION: Internal state changes SHOULD cause re-render
    await waitFor(() => {
      expect(screen.getByTestId("click-count").textContent).toBe("1");
    });

    // Verify the component actually re-rendered (not just DOM updated)
    expect(externalRenderCount).toBe(2);

    // Click again to confirm consistent behavior
    fireEvent.click(incrementButton);

    await waitFor(() => {
      expect(screen.getByTestId("click-count").textContent).toBe("2");
    });

    expect(externalRenderCount).toBe(3);
  });

  it("should re-render the input component when its props change", async () => {
    let inputRenderCount = 0;
    const capturedModes: string[] = [];

    const TrackedInput: React.FC<CopilotChatInputProps> = (props) => {
      inputRenderCount++;
      capturedModes.push(props.mode || "default");
      return (
        <div data-testid="tracked-input">
          <span data-testid="input-mode">{props.mode}</span>
          <CopilotChatInput {...props} />
        </div>
      );
    };

    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Hello!",
      } as AssistantMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatView
            messages={messages}
            isRunning={false}
            input={TrackedInput as any}
            inputProps={{ onSubmitMessage: () => {}, mode: "input" }}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("tracked-input")).toBeDefined();
    });

    const renderCountAfterInitial = inputRenderCount;
    expect(renderCountAfterInitial).toBe(1);

    // Change the mode prop
    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatView
            messages={messages}
            isRunning={true}
            input={TrackedInput as any}
            inputProps={{ onSubmitMessage: () => {}, mode: "processing" }}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-mode").textContent).toBe("processing");
    });

    const renderCountAfterModeChange = inputRenderCount;

    // THE KEY ASSERTION: Input SHOULD re-render when its props change
    expect(renderCountAfterModeChange).toBeGreaterThan(renderCountAfterInitial);
    expect(capturedModes).toContain("input");
    expect(capturedModes).toContain("processing");
  });
});

describe("Suggestion View Re-render Prevention", () => {
  it("should re-render a suggestion when its loading state changes", async () => {
    const suggestionRenderCounts: Record<string, number> = {};

    const TrackedSuggestionPill: React.FC<{
      children: React.ReactNode;
      isLoading?: boolean;
      onClick?: () => void;
    }> = ({ children, isLoading, onClick }) => {
      const title = String(children);
      suggestionRenderCounts[title] = (suggestionRenderCounts[title] || 0) + 1;
      return (
        <button
          data-testid={`suggestion-${title}`}
          onClick={onClick}
          disabled={isLoading}
        >
          {title}
          <span data-testid={`suggestion-loading-${title}`}>
            {isLoading ? "loading" : "ready"}
          </span>
        </button>
      );
    };

    const suggestions = [
      { title: "Tell me a joke", message: "Tell me a joke", isLoading: false },
      { title: "What's the weather?", message: "What's the weather?", isLoading: false },
    ];

    const { rerender } = render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatSuggestionView
            suggestions={suggestions}
            suggestion={TrackedSuggestionPill as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("suggestion-loading-Tell me a joke").textContent).toBe("ready");
    });

    const initialRenderCount = suggestionRenderCounts["Tell me a joke"]!;

    // Set first suggestion to loading
    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatSuggestionView
            suggestions={suggestions}
            loadingIndexes={[0]}
            suggestion={TrackedSuggestionPill as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("suggestion-loading-Tell me a joke").textContent).toBe("loading");
    });

    // THE KEY ASSERTION: Suggestion SHOULD re-render when loading state changes
    expect(suggestionRenderCounts["Tell me a joke"]).toBeGreaterThan(initialRenderCount);
  });
});

describe("Markdown Renderer Re-render Prevention", () => {
  it("should not re-render markdown when other messages change", async () => {
    const markdownRenderCounts: Record<string, number> = {};

    const TrackedMarkdownRenderer: React.FC<{
      content: string;
    }> = ({ content }) => {
      markdownRenderCounts[content] = (markdownRenderCounts[content] || 0) + 1;
      return (
        <div data-testid={`markdown-${content.slice(0, 20)}`}>
          <span data-testid={`markdown-content-${content.slice(0, 20)}`}>{content}</span>
          <span data-testid={`markdown-render-count-${content.slice(0, 20)}`}>
            {markdownRenderCounts[content]}
          </span>
        </div>
      );
    };

    const TrackedAssistantMessage: React.FC<{
      message: AssistantMessage;
      messages?: Message[];
      isRunning?: boolean;
    }> = ({ message, messages, isRunning }) => {
      return (
        <CopilotChatAssistantMessage
          message={message}
          messages={messages}
          isRunning={isRunning}
          markdownRenderer={TrackedMarkdownRenderer as any}
        />
      );
    };

    const initialMessages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Hello! How can I help?",
      } as AssistantMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={false}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("markdown-Hello! How can I hel")).toBeDefined();
    });

    const initialRenderCount = markdownRenderCounts["Hello! How can I help?"]!;

    // Add a new message (simulating streaming)
    const messagesWithSecond: Message[] = [
      ...initialMessages,
      {
        id: "msg-2",
        role: "assistant",
        content: "Let me help you with",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithSecond}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("markdown-Let me help you with")).toBeDefined();
    });

    // THE KEY ASSERTION: First message's markdown should NOT re-render
    expect(markdownRenderCounts["Hello! How can I help?"]).toBe(initialRenderCount);
  });

  it("should re-render markdown when its content changes", async () => {
    const markdownRenderCounts: Record<string, number> = {};
    const capturedContent: string[] = [];

    const TrackedMarkdownRenderer: React.FC<{
      content: string;
    }> = ({ content }) => {
      markdownRenderCounts[content] = (markdownRenderCounts[content] || 0) + 1;
      capturedContent.push(content);
      return (
        <div data-testid="markdown">
          <span data-testid="markdown-content">{content}</span>
        </div>
      );
    };

    const TrackedAssistantMessage: React.FC<{
      message: AssistantMessage;
      messages?: Message[];
      isRunning?: boolean;
    }> = ({ message, messages, isRunning }) => {
      return (
        <CopilotChatAssistantMessage
          message={message}
          messages={messages}
          isRunning={isRunning}
          markdownRenderer={TrackedMarkdownRenderer as any}
        />
      );
    };

    const initialMessages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Hello",
      } as AssistantMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("markdown-content").textContent).toBe("Hello");
    });

    // Stream more content
    const messagesWithMoreContent: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Hello! How are you today?",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithMoreContent}
            isRunning={true}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("markdown-content").textContent).toBe("Hello! How are you today?");
    });

    // THE KEY ASSERTION: Markdown SHOULD re-render when content changes
    expect(capturedContent).toContain("Hello");
    expect(capturedContent).toContain("Hello! How are you today?");
  });
});

describe("Copy Button Re-render Prevention", () => {
  it("should not re-render copy button when a new message is added", async () => {
    let copyButtonRenderCount = 0;

    const TrackedCopyButton: React.FC<{
      onClick?: () => void;
    }> = ({ onClick }) => {
      copyButtonRenderCount++;
      return (
        <button data-testid="copy-button" onClick={onClick}>
          Copy
          <span data-testid="copy-render-count">{copyButtonRenderCount}</span>
        </button>
      );
    };

    const TrackedAssistantMessage: React.FC<{
      message: AssistantMessage;
      messages?: Message[];
      isRunning?: boolean;
    }> = ({ message, messages, isRunning }) => {
      return (
        <CopilotChatAssistantMessage
          message={message}
          messages={messages}
          isRunning={isRunning}
          copyButton={TrackedCopyButton as any}
        />
      );
    };

    // Start with a completed message (isRunning=false so toolbar shows)
    const initialMessages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Hello! First message here.",
      } as AssistantMessage,
    ];

    const { rerender } = render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={initialMessages}
            isRunning={false}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("copy-button")).toBeDefined();
    });

    const initialRenderCount = copyButtonRenderCount;

    // Add a second message - the first message's copy button should NOT re-render
    const messagesWithSecond: Message[] = [
      ...initialMessages,
      {
        id: "msg-2",
        role: "assistant",
        content: "Second message here.",
      } as AssistantMessage,
    ];

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatMessageView
            messages={messagesWithSecond}
            isRunning={false}
            assistantMessage={TrackedAssistantMessage as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    // Wait for second message to render
    await waitFor(() => {
      expect(screen.getAllByTestId("copy-button").length).toBe(2);
    });

    // THE KEY ASSERTION: First message's copy button should NOT re-render when second message is added
    // We check that the total render count is 2 (one for each message), not 3 (which would mean first re-rendered)
    expect(copyButtonRenderCount).toBe(2);
  });

  it("should re-render copy button when its onClick handler changes", async () => {
    let copyButtonRenderCount = 0;

    const TrackedCopyButton: React.FC<{
      onClick?: () => void;
    }> = ({ onClick }) => {
      copyButtonRenderCount++;
      return (
        <button data-testid="copy-button" onClick={onClick}>
          Copy
        </button>
      );
    };

    // First render with one message (isRunning=false so toolbar shows)
    const message1: AssistantMessage = {
      id: "msg-1",
      role: "assistant",
      content: "First message",
    };

    const { rerender } = render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatAssistantMessage
            message={message1}
            isRunning={false}
            copyButton={TrackedCopyButton as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("copy-button")).toBeDefined();
    });

    const initialRenderCount = copyButtonRenderCount;

    // Re-render with a completely different message (different ID = different onClick)
    const message2: AssistantMessage = {
      id: "msg-2",
      role: "assistant",
      content: "Second message",
    };

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId="default" threadId="test">
          <CopilotChatAssistantMessage
            message={message2}
            isRunning={false}
            copyButton={TrackedCopyButton as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("copy-button")).toBeDefined();
    });

    // THE KEY ASSERTION: Copy button SHOULD re-render when the message changes
    // because the onClick handler needs to reference the new message content
    expect(copyButtonRenderCount).toBeGreaterThan(initialRenderCount);
  });
});
