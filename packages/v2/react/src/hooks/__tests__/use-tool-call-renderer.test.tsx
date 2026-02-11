import React, { useState } from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { Message, ToolCall, ToolMessage } from "@ag-ui/core";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";
import { useToolCallRenderer } from "../use-tool-call-renderer";
import { defineToolCallRenderer, ReactToolCallRenderer } from "@/types";
import { ToolCallStatus } from "@copilotkitnext/core";

// Helper to create a tool call
function createToolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

// Helper to create a tool message (result)
function createToolMessage(id: string, toolCallId: string, content: string): ToolMessage {
  return {
    id,
    role: "tool",
    toolCallId,
    content,
  };
}

describe("useToolCallRenderer", () => {
  describe("new API: const { renderToolCall, renderAllToolCalls } = useToolCallRenderer({ messages })", () => {
    it("automatically finds toolMessage from messages array", () => {
      let capturedStatus: string | null = null;
      let capturedResult: string | undefined = undefined;

      const toolCallRenderers = [
        defineToolCallRenderer({
          name: "getWeather",
          args: z.object({ location: z.string() }),
          render: ({ status, result }) => {
            capturedStatus = status;
            capturedResult = result;
            return (
              <div data-testid="weather-tool">
                <span data-testid="status">{status}</span>
                <span data-testid="result">{result ?? "pending"}</span>
              </div>
            );
          },
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      const toolCall = createToolCall("tc-1", "getWeather", { location: "Paris" });
      const toolMessage = createToolMessage("tm-1", "tc-1", "Sunny, 22°C");

      const messages: Message[] = [
        { id: "msg-1", role: "user", content: "What's the weather?" },
        {
          id: "msg-2",
          role: "assistant",
          content: "",
          toolCalls: [toolCall],
        } as Message,
        toolMessage,
      ];

      // Component that uses the new API
      const TestComponent: React.FC<{ messages: Message[] }> = ({ messages }) => {
        const { renderToolCall } = useToolCallRenderer({ messages });
        return <div>{renderToolCall(toolCall)}</div>;
      };

      render(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={messages} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Should find the toolMessage automatically and render as complete
      expect(screen.getByTestId("status").textContent).toBe("complete");
      expect(screen.getByTestId("result").textContent).toBe("Sunny, 22°C");
      expect(capturedStatus).toBe(ToolCallStatus.Complete);
      expect(capturedResult).toBe("Sunny, 22°C");
    });

    it("renders as inProgress when toolMessage is not found in messages", () => {
      let capturedStatus: string | null = null;

      const toolCallRenderers = [
        defineToolCallRenderer({
          name: "search",
          args: z.object({ query: z.string() }),
          render: ({ status }) => {
            capturedStatus = status;
            return <div data-testid="status">{status}</div>;
          },
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      const toolCall = createToolCall("tc-1", "search", { query: "React hooks" });

      // Messages without a tool result
      const messages: Message[] = [
        { id: "msg-1", role: "user", content: "Search for React hooks" },
        {
          id: "msg-2",
          role: "assistant",
          content: "",
          toolCalls: [toolCall],
        } as Message,
      ];

      const TestComponent: React.FC<{ messages: Message[] }> = ({ messages }) => {
        const { renderToolCall } = useToolCallRenderer({ messages });
        return <div>{renderToolCall(toolCall)}</div>;
      };

      render(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={messages} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      expect(screen.getByTestId("status").textContent).toBe("inProgress");
      expect(capturedStatus).toBe(ToolCallStatus.InProgress);
    });
  });

  describe("legacy API: renderToolCall({ toolCall, toolMessage })", () => {
    it("uses provided toolMessage directly", () => {
      let capturedStatus: string | null = null;
      let capturedResult: string | undefined = undefined;

      const toolCallRenderers = [
        defineToolCallRenderer({
          name: "getData",
          args: z.object({ id: z.string() }),
          render: ({ status, result }) => {
            capturedStatus = status;
            capturedResult = result;
            return (
              <div data-testid="data-tool">
                <span data-testid="status">{status}</span>
                <span data-testid="result">{result ?? "pending"}</span>
              </div>
            );
          },
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      const toolCall = createToolCall("tc-1", "getData", { id: "123" });
      const toolMessage = createToolMessage("tm-1", "tc-1", '{"data": "found"}');

      // Component that uses the legacy API
      const TestComponent: React.FC = () => {
        const { renderToolCall } = useToolCallRenderer(); // No messages
        return <div>{renderToolCall({ toolCall, toolMessage })}</div>;
      };

      render(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      expect(screen.getByTestId("status").textContent).toBe("complete");
      expect(screen.getByTestId("result").textContent).toBe('{"data": "found"}');
      expect(capturedStatus).toBe(ToolCallStatus.Complete);
      expect(capturedResult).toBe('{"data": "found"}');
    });

    it("renders as inProgress when toolMessage is undefined", () => {
      let capturedStatus: string | null = null;

      const toolCallRenderers = [
        defineToolCallRenderer({
          name: "process",
          args: z.object({ input: z.string() }),
          render: ({ status }) => {
            capturedStatus = status;
            return <div data-testid="status">{status}</div>;
          },
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      const toolCall = createToolCall("tc-1", "process", { input: "test" });

      const TestComponent: React.FC = () => {
        const { renderToolCall } = useToolCallRenderer();
        return <div>{renderToolCall({ toolCall, toolMessage: undefined })}</div>;
      };

      render(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      expect(screen.getByTestId("status").textContent).toBe("inProgress");
      expect(capturedStatus).toBe(ToolCallStatus.InProgress);
    });
  });

  describe("callback stability (ref-based memoization)", () => {
    it("renderToolCall callback stays stable when messages change", () => {
      const callbackRefs: Array<ReturnType<typeof useToolCallRenderer>["renderToolCall"]> = [];

      const toolCallRenderers = [
        defineToolCallRenderer({
          name: "test",
          args: z.object({}),
          render: () => <div data-testid="test-tool">Test</div>,
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      const TestComponent: React.FC<{ messages: Message[] }> = ({ messages }) => {
        const { renderToolCall } = useToolCallRenderer({ messages });
        callbackRefs.push(renderToolCall);
        return <div>Callback captured</div>;
      };

      const initialMessages: Message[] = [{ id: "msg-1", role: "user", content: "Hello" }];

      const { rerender } = render(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={initialMessages} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Add more messages
      const updatedMessages: Message[] = [
        ...initialMessages,
        { id: "msg-2", role: "assistant", content: "Hi there!" } as Message,
      ];

      rerender(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={updatedMessages} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Add even more messages
      const moreMessages: Message[] = [...updatedMessages, { id: "msg-3", role: "user", content: "How are you?" }];

      rerender(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={moreMessages} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // All callbacks should be the same reference (stable)
      expect(callbackRefs.length).toBe(3);
      expect(callbackRefs[0]).toBe(callbackRefs[1]);
      expect(callbackRefs[1]).toBe(callbackRefs[2]);
    });

    it("uses latest messages from ref even with stable callback", () => {
      let renderCount = 0;
      let lastCapturedResult: string | undefined;

      const toolCallRenderers = [
        defineToolCallRenderer({
          name: "getStatus",
          args: z.object({}),
          render: ({ result }) => {
            renderCount++;
            lastCapturedResult = result;
            return (
              <div data-testid="status-tool">
                <span data-testid="result">{result ?? "pending"}</span>
              </div>
            );
          },
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      const toolCall = createToolCall("tc-1", "getStatus", {});

      // Component that renders tool call and tracks callback stability
      const TestComponent: React.FC<{ messages: Message[] }> = ({ messages }) => {
        const { renderToolCall } = useToolCallRenderer({ messages });
        return <div>{renderToolCall(toolCall)}</div>;
      };

      // Initial render without tool result
      const messagesWithoutResult: Message[] = [
        { id: "msg-1", role: "user", content: "Get status" },
        {
          id: "msg-2",
          role: "assistant",
          content: "",
          toolCalls: [toolCall],
        } as Message,
      ];

      const { rerender } = render(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={messagesWithoutResult} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      expect(screen.getByTestId("result").textContent).toBe("pending");
      const renderCountBeforeResult = renderCount;

      // Add tool result to messages
      const messagesWithResult: Message[] = [...messagesWithoutResult, createToolMessage("tm-1", "tc-1", "Status: OK")];

      rerender(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={messagesWithResult} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Should now show the result (ref was updated)
      expect(screen.getByTestId("result").textContent).toBe("Status: OK");
      expect(lastCapturedResult).toBe("Status: OK");
      // Tool should have re-rendered because result changed
      expect(renderCount).toBeGreaterThan(renderCountBeforeResult);
    });
  });

  describe("re-render prevention", () => {
    it("does not re-render tool call when unrelated messages change", () => {
      let toolRenderCount = 0;

      const toolCallRenderers = [
        defineToolCallRenderer({
          name: "completedTool",
          args: z.object({ data: z.string() }),
          render: ({ status, result }) => {
            toolRenderCount++;
            return (
              <div data-testid="tool">
                <span data-testid="render-count">{toolRenderCount}</span>
                <span data-testid="status">{status}</span>
                <span data-testid="result">{result ?? "pending"}</span>
              </div>
            );
          },
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      const toolCall = createToolCall("tc-1", "completedTool", { data: "test" });
      const toolMessage = createToolMessage("tm-1", "tc-1", "Done!");

      // Start with completed tool call
      const initialMessages: Message[] = [
        { id: "msg-1", role: "user", content: "Run tool" },
        {
          id: "msg-2",
          role: "assistant",
          content: "",
          toolCalls: [toolCall],
        } as Message,
        toolMessage,
      ];

      const TestComponent: React.FC<{ messages: Message[] }> = ({ messages }) => {
        const { renderToolCall } = useToolCallRenderer({ messages });
        return <div>{renderToolCall(toolCall)}</div>;
      };

      const { rerender } = render(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={initialMessages} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      expect(screen.getByTestId("status").textContent).toBe("complete");
      const renderCountAfterInitial = toolRenderCount;

      // Add unrelated messages (new assistant message, new user message)
      const messagesWithMore: Message[] = [
        ...initialMessages,
        { id: "msg-3", role: "assistant", content: "Here are the results..." } as Message,
      ];

      rerender(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={messagesWithMore} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Add even more unrelated messages
      const messagesWithEvenMore: Message[] = [
        ...messagesWithMore,
        { id: "msg-4", role: "user", content: "Thanks!" },
        { id: "msg-5", role: "assistant", content: "You're welcome!" } as Message,
      ];

      rerender(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={messagesWithEvenMore} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Tool should NOT have re-rendered since its data hasn't changed
      expect(toolRenderCount).toBe(renderCountAfterInitial);
      expect(screen.getByTestId("status").textContent).toBe("complete");
      expect(screen.getByTestId("result").textContent).toBe("Done!");
    });

    it("re-renders tool call when its toolMessage result changes", () => {
      let toolRenderCount = 0;
      const capturedResults: (string | undefined)[] = [];

      const toolCallRenderers = [
        defineToolCallRenderer({
          name: "streamingTool",
          args: z.object({}),
          render: ({ result }) => {
            toolRenderCount++;
            capturedResults.push(result);
            return (
              <div data-testid="tool">
                <span data-testid="result">{result ?? "pending"}</span>
              </div>
            );
          },
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      const toolCall = createToolCall("tc-1", "streamingTool", {});

      // Start without result
      const messagesNoResult: Message[] = [
        { id: "msg-1", role: "user", content: "Run" },
        {
          id: "msg-2",
          role: "assistant",
          content: "",
          toolCalls: [toolCall],
        } as Message,
      ];

      const TestComponent: React.FC<{ messages: Message[] }> = ({ messages }) => {
        const { renderToolCall } = useToolCallRenderer({ messages });
        return <div>{renderToolCall(toolCall)}</div>;
      };

      const { rerender } = render(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={messagesNoResult} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      expect(screen.getByTestId("result").textContent).toBe("pending");
      const renderCountBeforeResult = toolRenderCount;

      // Add initial result
      const messagesWithResult: Message[] = [...messagesNoResult, createToolMessage("tm-1", "tc-1", "Processing...")];

      rerender(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={messagesWithResult} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Should re-render with new result
      expect(screen.getByTestId("result").textContent).toBe("Processing...");
      expect(toolRenderCount).toBeGreaterThan(renderCountBeforeResult);

      const renderCountAfterFirstResult = toolRenderCount;

      // Update the result (simulating streaming result)
      const messagesWithUpdatedResult: Message[] = [
        messagesNoResult[0]!,
        messagesNoResult[1]!,
        createToolMessage("tm-1", "tc-1", "Complete!"),
      ];

      rerender(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={messagesWithUpdatedResult} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Should re-render with updated result
      expect(screen.getByTestId("result").textContent).toBe("Complete!");
      expect(toolRenderCount).toBeGreaterThan(renderCountAfterFirstResult);
      expect(capturedResults).toContain(undefined); // Initial pending
      expect(capturedResults).toContain("Processing...");
      expect(capturedResults).toContain("Complete!");
    });

    it("re-renders tool call when its arguments change", () => {
      let toolRenderCount = 0;
      const capturedArgs: string[] = [];

      const toolCallRenderers = [
        defineToolCallRenderer({
          name: "search",
          args: z.object({ query: z.string() }),
          render: ({ args }) => {
            toolRenderCount++;
            capturedArgs.push(args.query!);
            return (
              <div data-testid="tool">
                <span data-testid="query">{args.query}</span>
              </div>
            );
          },
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      // Initial tool call with partial args (simulating streaming)
      const toolCallPartial = createToolCall("tc-1", "search", { query: "Rea" });

      const messages: Message[] = [
        { id: "msg-1", role: "user", content: "Search" },
        {
          id: "msg-2",
          role: "assistant",
          content: "",
          toolCalls: [toolCallPartial],
        } as Message,
      ];

      const TestComponent: React.FC<{ toolCall: ToolCall }> = ({ toolCall }) => {
        const { renderToolCall } = useToolCallRenderer({ messages });
        return <div>{renderToolCall(toolCall)}</div>;
      };

      const { rerender } = render(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent toolCall={toolCallPartial} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      expect(screen.getByTestId("query").textContent).toBe("Rea");
      const renderCountAfterPartial = toolRenderCount;

      // Update tool call with complete args
      const toolCallComplete = createToolCall("tc-1", "search", { query: "React hooks" });

      rerender(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent toolCall={toolCallComplete} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Should re-render with updated args
      expect(screen.getByTestId("query").textContent).toBe("React hooks");
      expect(toolRenderCount).toBeGreaterThan(renderCountAfterPartial);
      expect(capturedArgs).toContain("Rea");
      expect(capturedArgs).toContain("React hooks");
    });
  });

  describe("edge cases", () => {
    it("returns null when no renderer is registered for the tool", () => {
      const toolCallRenderers: ReactToolCallRenderer<unknown>[] = []; // Empty

      const toolCall = createToolCall("tc-1", "unknownTool", {});
      const messages: Message[] = [];

      const TestComponent: React.FC = () => {
        const { renderToolCall } = useToolCallRenderer({ messages });
        const result = renderToolCall(toolCall);
        return <div data-testid="result">{result === null ? "null" : "rendered"}</div>;
      };

      render(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      expect(screen.getByTestId("result").textContent).toBe("null");
    });

    it("works with empty messages array", () => {
      const toolCallRenderers = [
        defineToolCallRenderer({
          name: "test",
          args: z.object({}),
          render: ({ status }) => <div data-testid="status">{status}</div>,
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      const toolCall = createToolCall("tc-1", "test", {});

      const TestComponent: React.FC = () => {
        const { renderToolCall } = useToolCallRenderer({ messages: [] });
        return <div>{renderToolCall(toolCall)}</div>;
      };

      render(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Should render as inProgress since no toolMessage found
      expect(screen.getByTestId("status").textContent).toBe("inProgress");
    });

    it("renderAllToolCalls handles multiple tool calls with different results", () => {
      const renderCounts: Record<string, number> = {};

      const toolCallRenderers = [
        defineToolCallRenderer({
          name: "multiTool",
          args: z.object({ id: z.string() }),
          render: ({ args, result }) => {
            const id = args.id!;
            renderCounts[id] = (renderCounts[id] || 0) + 1;
            return (
              <div data-testid={`tool-${id}`}>
                <span data-testid={`result-${id}`}>{result ?? "pending"}</span>
              </div>
            );
          },
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      const toolCall1 = createToolCall("tc-1", "multiTool", { id: "first" });
      const toolCall2 = createToolCall("tc-2", "multiTool", { id: "second" });
      const toolMessage1 = createToolMessage("tm-1", "tc-1", "Result 1");
      // No result for toolCall2 yet

      const messages: Message[] = [
        { id: "msg-1", role: "user", content: "Run tools" },
        {
          id: "msg-2",
          role: "assistant",
          content: "",
          toolCalls: [toolCall1, toolCall2],
        } as Message,
        toolMessage1,
      ];

      const TestComponent: React.FC<{ messages: Message[] }> = ({ messages }) => {
        const { renderAllToolCalls } = useToolCallRenderer({ messages });
        return <div>{renderAllToolCalls([toolCall1, toolCall2])}</div>;
      };

      const { rerender } = render(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={messages} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // First tool should be complete, second should be pending
      expect(screen.getByTestId("result-first").textContent).toBe("Result 1");
      expect(screen.getByTestId("result-second").textContent).toBe("pending");

      const renderCountFirstAfterInitial = renderCounts["first"]!;
      const renderCountSecondAfterInitial = renderCounts["second"]!;

      // Add result for second tool
      const toolMessage2 = createToolMessage("tm-2", "tc-2", "Result 2");
      const updatedMessages: Message[] = [...messages, toolMessage2];

      rerender(
        <CopilotKitProvider toolCallRenderers={toolCallRenderers}>
          <CopilotChatConfigurationProvider agentId="default" threadId="test">
            <TestComponent messages={updatedMessages} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Both should now be complete
      expect(screen.getByTestId("result-first").textContent).toBe("Result 1");
      expect(screen.getByTestId("result-second").textContent).toBe("Result 2");

      // First tool should NOT have re-rendered (its result didn't change)
      expect(renderCounts["first"]).toBe(renderCountFirstAfterInitial);
      // Second tool should have re-rendered (its result changed)
      expect(renderCounts["second"]).toBeGreaterThan(renderCountSecondAfterInitial);
    });
  });
});
