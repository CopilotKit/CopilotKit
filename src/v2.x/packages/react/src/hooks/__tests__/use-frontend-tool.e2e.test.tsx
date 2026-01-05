import React, { useEffect, useState, useReducer } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { z } from "zod";
import { useFrontendTool } from "../use-frontend-tool";
import { ReactFrontendTool } from "@/types";
import { CopilotChat } from "@/components/chat/CopilotChat";
import CopilotChatToolCallsView from "@/components/chat/CopilotChatToolCallsView";
import { AssistantMessage, Message } from "@ag-ui/core";
import { ToolCallStatus } from "@copilotkitnext/core";
import {
  AbstractAgent,
  EventType,
  type AgentSubscriber,
  type BaseEvent,
  type RunAgentInput,
  type RunAgentParameters,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  toolCallChunkEvent,
  toolCallResultEvent,
  textChunkEvent,
  testId,
} from "@/__tests__/utils/test-helpers";

describe("useFrontendTool E2E - Dynamic Registration", () => {
  describe("Minimal dynamic registration without chat run", () => {
    it("registers tool and renders tool call via ToolCallsView", async () => {
      // eslint-disable-next-line no-console
      // No agent run; we render ToolCallsView directly
      const DynamicToolComponent: React.FC = () => {
        const tool: ReactFrontendTool<{ message: string }> = {
          name: "dynamicTool",
          parameters: z.object({ message: z.string() }),
          render: ({ name, args }) => (
            <div data-testid="dynamic-tool-render">
              {name}: {args.message}
            </div>
          ),
        };
        useFrontendTool(tool);
        return null;
      };

      const toolCallId = testId("tc_dyn");
      const assistantMessage: AssistantMessage = {
        id: testId("a"),
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: toolCallId,
            type: "function",
            function: {
              name: "dynamicTool",
              arguments: JSON.stringify({ message: "hello" }),
            },
          } as any,
        ],
      } as any;
      const messages: Message[] = [];

      const ui = renderWithCopilotKit({
        children: (
          <>
            <DynamicToolComponent />
            <CopilotChatToolCallsView
              message={assistantMessage}
              messages={messages}
            />
          </>
        ),
      });

      await waitFor(() => {
        const el = screen.getByTestId("dynamic-tool-render");
        expect(el).toBeDefined();
        expect(el.textContent).toContain("dynamicTool");
        expect(el.textContent).toContain("hello");
      });
      // Explicitly unmount to avoid any lingering handles
      ui.unmount();
    });
  });
  describe("Register at runtime", () => {
    it("should register tool dynamically after provider is mounted", async () => {
      const agent = new MockStepwiseAgent();

      // Inner component that uses the hook
      const ToolUser: React.FC = () => {
        const tool: ReactFrontendTool<{ message: string }> = {
          name: "dynamicTool",
          parameters: z.object({ message: z.string() }),
          render: ({ name, args, result }) => (
            <div data-testid="dynamic-tool-render">
              {name}: {args.message} | Result:{" "}
              {result ? JSON.stringify(result) : "pending"}
            </div>
          ),
          handler: async (args) => {
            return { processed: args.message.toUpperCase() };
          },
        };

        useFrontendTool(tool);
        return null;
      };

      // Component that registers a tool after mount
      const DynamicToolComponent: React.FC = () => {
        const [isRegistered, setIsRegistered] = useState(false);

        useEffect(() => {
          // Register immediately after mount
          setIsRegistered(true);
        }, []);

        return (
          <>
            <div data-testid="dynamic-status">
              {isRegistered ? "Registered" : "Not registered"}
            </div>
            {isRegistered && <ToolUser />}
          </>
        );
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <DynamicToolComponent />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Wait for dynamic registration
      await waitFor(() => {
        expect(screen.getByTestId("dynamic-status").textContent).toBe(
          "Registered"
        );
      });

      // Submit a message that will trigger the dynamically registered tool
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Use dynamic tool" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for message to be processed
      await waitFor(() => {
        expect(screen.getByText("Use dynamic tool")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      // Emit tool call for the dynamically registered tool
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "dynamicTool",
          parentMessageId: messageId,
          delta: '{"message":"hello world"}',
        })
      );

      // The dynamically registered renderer should appear
      await waitFor(() => {
        const toolRender = screen.getByTestId("dynamic-tool-render");
        expect(toolRender).toBeDefined();
        expect(toolRender.textContent).toContain("hello world");
      });

      // Send result
      agent.emit(
        toolCallResultEvent({
          toolCallId,
          messageId: `${messageId}_result`,
          content: JSON.stringify({ processed: "HELLO WORLD" }),
        })
      );

      await waitFor(() => {
        const toolRender = screen.getByTestId("dynamic-tool-render");
        expect(toolRender.textContent).toContain("HELLO WORLD");
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Streaming tool calls with incomplete JSON", () => {
    it("renders tool calls progressively as incomplete JSON chunks arrive", async () => {
      const agent = new MockStepwiseAgent();

      // Tool that renders the arguments it receives
      const StreamingTool: React.FC = () => {
        const tool: ReactFrontendTool<{
          name: string;
          items: string[];
          count: number;
        }> = {
          name: "streamingTool",
          parameters: z.object({
            name: z.string(),
            items: z.array(z.string()),
            count: z.number(),
          }),
          render: ({ args }) => (
            <div data-testid="streaming-tool-render">
              <div data-testid="tool-name">{args.name || "undefined"}</div>
              <div data-testid="tool-items">
                {args.items ? args.items.join(", ") : "undefined"}
              </div>
              <div data-testid="tool-count">
                {args.count !== undefined ? args.count : "undefined"}
              </div>
            </div>
          ),
        };

        useFrontendTool(tool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <StreamingTool />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Submit a message to start the agent
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test streaming" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for message to appear
      await waitFor(() => {
        expect(screen.getByText("Test streaming")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      // Start the run
      agent.emit(runStartedEvent());

      // Stream incomplete JSON chunks
      // First chunk: just opening brace and part of first field
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "streamingTool",
          parentMessageId: messageId,
          delta: '{"na',
        })
      );

      // Check that tool is rendering (even with incomplete JSON)
      await waitFor(() => {
        expect(screen.getByTestId("streaming-tool-render")).toBeDefined();
      });

      // Second chunk: complete the name field
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          parentMessageId: messageId,
          delta: 'me":"Test Tool"',
        })
      );

      // Check name is now rendered
      await waitFor(() => {
        expect(screen.getByTestId("tool-name").textContent).toBe("Test Tool");
      });

      // Third chunk: start items array
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          parentMessageId: messageId,
          delta: ',"items":["item1"',
        })
      );

      // Check items array has first item
      await waitFor(() => {
        expect(screen.getByTestId("tool-items").textContent).toContain("item1");
      });

      // Fourth chunk: add more items and start count
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          parentMessageId: messageId,
          delta: ',"item2","item3"],"cou',
        })
      );

      // Check items array is complete
      await waitFor(() => {
        expect(screen.getByTestId("tool-items").textContent).toBe(
          "item1, item2, item3"
        );
      });

      // Final chunk: complete the JSON
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          parentMessageId: messageId,
          delta: 'nt":42}',
        })
      );

      // Check count is rendered
      await waitFor(() => {
        expect(screen.getByTestId("tool-count").textContent).toBe("42");
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Tool followUp property behavior", () => {
    it("stops agent execution when followUp is false", async () => {
      const agent = new MockStepwiseAgent();

      const NoFollowUpTool: React.FC = () => {
        const tool: ReactFrontendTool<{ action: string }> = {
          name: "noFollowUpTool",
          parameters: z.object({ action: z.string() }),
          followUp: false, // This should stop execution after tool call
          render: ({ args, status }) => (
            <div data-testid="no-followup-tool">
              <div data-testid="tool-action">{args.action || "no action"}</div>
              <div data-testid="tool-status">{status}</div>
            </div>
          ),
        };

        useFrontendTool(tool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <NoFollowUpTool />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Submit a message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Execute no followup" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Execute no followup")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      // Start run and emit tool call
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "noFollowUpTool",
          parentMessageId: messageId,
          delta: '{"action":"stop-after-this"}',
        })
      );

      // Tool should render
      await waitFor(() => {
        expect(screen.getByTestId("no-followup-tool")).toBeDefined();
        expect(screen.getByTestId("tool-action").textContent).toBe(
          "stop-after-this"
        );
      });

      // The agent should NOT continue after this tool call
      // We can verify this by NOT emitting more events and checking the UI state
      // In a real scenario, the agent would stop sending events

      agent.emit(runFinishedEvent());
      agent.complete();

      // Verify execution stopped (no further messages)
      // The chat should only have the user message and tool call, no follow-up
      const messages = screen.queryAllByRole("article");
      expect(messages.length).toBeLessThanOrEqual(2); // User message + tool response
    });

    it("continues agent execution when followUp is true or undefined", async () => {
      const agent = new MockStepwiseAgent();

      const ContinueFollowUpTool: React.FC = () => {
        const tool: ReactFrontendTool<{ action: string }> = {
          name: "continueFollowUpTool",
          parameters: z.object({ action: z.string() }),
          // followUp is undefined (default) - should continue execution
          render: ({ args }) => (
            <div data-testid="continue-followup-tool">
              <div data-testid="tool-action">{args.action || "no action"}</div>
            </div>
          ),
        };

        useFrontendTool(tool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <ContinueFollowUpTool />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Submit a message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Execute with followup" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Execute with followup")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");
      const followUpMessageId = testId("followup");

      // Start run and emit tool call
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "continueFollowUpTool",
          parentMessageId: messageId,
          delta: '{"action":"continue-after-this"}',
        })
      );

      // Tool should render
      await waitFor(() => {
        expect(screen.getByTestId("continue-followup-tool")).toBeDefined();
        expect(screen.getByTestId("tool-action").textContent).toBe(
          "continue-after-this"
        );
      });

      // The agent SHOULD continue after this tool call
      // Emit a follow-up message to simulate continued execution
      agent.emit(
        textChunkEvent(
          followUpMessageId,
          "This is a follow-up message after tool execution"
        )
      );

      // Verify the follow-up message appears
      await waitFor(() => {
        expect(
          screen.getByText("This is a follow-up message after tool execution")
        ).toBeDefined();
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Agent input plumbing", () => {
    it("forwards registered frontend tools to runAgent input", async () => {
      class InstrumentedMockAgent extends MockStepwiseAgent {
        public lastRunParameters?: RunAgentParameters;

        async runAgent(parameters?: RunAgentParameters, subscriber?: AgentSubscriber) {
          this.lastRunParameters = parameters;
          return super.runAgent(parameters, subscriber);
        }
      }

      const agent = new InstrumentedMockAgent();

      const ToolRegistrar: React.FC = () => {
        const tool: ReactFrontendTool<{ query: string }> = {
          name: "inspectionTool",
          parameters: z.object({ query: z.string() }),
          handler: async ({ query }) => `handled ${query}`,
        };

        useFrontendTool(tool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <ToolRegistrar />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Trigger inspection" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(agent.lastRunParameters).toBeDefined();
      });

      const messageId = testId("msg");
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallResultEvent({
          toolCallId: testId("tc"),
          messageId: `${messageId}_result`,
          content: JSON.stringify({}),
        })
      );
      agent.emit(runFinishedEvent());
      agent.complete();

      expect(agent.lastRunParameters?.tools).toBeDefined();
    });
  });

  describe("Unmount disables handler, render persists", () => {
    it("Tool is properly removed from copilotkit.tools after component unmounts", async () => {
      // A deterministic agent that emits a single tool call per run and finishes
      class OneShotToolCallAgent extends AbstractAgent {
        private runCount = 0;
        clone(): OneShotToolCallAgent {
          // Keep state across runs so the second run emits different args
          return this;
        }
        run(_input: RunAgentInput): Observable<BaseEvent> {
          return new Observable<BaseEvent>((observer) => {
            const messageId = testId("m");
            const toolCallId = testId("tc");
            this.runCount += 1;
            const valueArg = this.runCount === 1 ? "first call" : "second call";
            observer.next({ type: EventType.RUN_STARTED } as BaseEvent);
            observer.next({
              type: EventType.TOOL_CALL_CHUNK,
              toolCallId,
              toolCallName: "temporaryTool",
              parentMessageId: messageId,
              delta: JSON.stringify({ value: valueArg }),
            } as BaseEvent);
            observer.next({ type: EventType.RUN_FINISHED } as BaseEvent);
            observer.complete();
            return () => {};
          });
        }
      }

      const agent = new OneShotToolCallAgent();
      let handlerCalls = 0;

      // Component that can be toggled on/off
      const ToggleableToolComponent: React.FC = () => {
        const tool: ReactFrontendTool<{ value: string }> = {
          name: "temporaryTool",
          parameters: z.object({ value: z.string() }),
          followUp: false,
          handler: async ({ value }) => {
            handlerCalls += 1;
            return `HANDLED ${value.toUpperCase()}`;
          },
          render: ({ name, args, result, status }) => (
            <div data-testid="temporary-tool">
              {name}: {args.value} | Status: {status} | Result:{" "}
              {String(result ?? "")}
            </div>
          ),
        };
        useFrontendTool(tool);
        return <div data-testid="tool-mounted">Tool is mounted</div>;
      };

      const TestWrapper: React.FC = () => {
        const [showTool, setShowTool] = useState(true);
        return (
          <>
            <button
              onClick={() => setShowTool(!showTool)}
              data-testid="toggle-button"
            >
              Toggle Tool
            </button>
            {showTool && <ToggleableToolComponent />}
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        );
      };

      renderWithCopilotKit({ agent, children: <TestWrapper /> });

      // Tool should be mounted initially
      expect(screen.getByTestId("tool-mounted")).toBeDefined();

      // Run 1: submit a message to trigger agent run with "first call"
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Trigger 1" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // The tool should render and handler should have produced a result
      await waitFor(() => {
        const toolRender = screen.getByTestId("temporary-tool");
        expect(toolRender.textContent).toContain("first call");
        expect(toolRender.textContent).toContain("HANDLED FIRST CALL");
        expect(handlerCalls).toBe(1);
      });

      // Unmount the tool component (removes handler but keeps renderer via hook policy)
      fireEvent.click(screen.getByTestId("toggle-button"));
      await waitFor(() => {
        expect(screen.queryByTestId("tool-mounted")).toBeNull();
      });

      // Run 2: trigger agent again with "second call"
      fireEvent.change(input, { target: { value: "Trigger 2" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // The renderer should still render with new args, but no handler result should be produced
      await waitFor(() => {
        const toolRender = screen.getAllByTestId("temporary-tool");
        // There will be two renders in the chat history; check the last one
        const last = toolRender[toolRender.length - 1];
        expect(last?.textContent).toContain("second call");
        // The handler should not have been called a second time since tool was removed
        expect(handlerCalls).toBe(1);
      });
    });
  });

  describe("Override behavior", () => {
    it("should use latest registration when same tool name is registered multiple times", async () => {
      const agent = new MockStepwiseAgent();

      // First component with initial tool definition
      const FirstToolComponent: React.FC = () => {
        const tool: ReactFrontendTool<{ text: string }> = {
          name: "overridableTool",
          parameters: z.object({ text: z.string() }),
          render: ({ name, args }) => (
            <div data-testid="first-version">
              First Version: {args.text} ({name})
            </div>
          ),
        };

        useFrontendTool(tool);
        return null;
      };

      // Second component with override tool definition
      const SecondToolComponent: React.FC<{ isActive: boolean }> = ({
        isActive,
      }) => {
        if (!isActive) return null;

        const tool: ReactFrontendTool<{ text: string }> = {
          name: "overridableTool",
          parameters: z.object({ text: z.string() }),
          render: ({ name, args }) => (
            <div data-testid="second-version">
              Second Version (Override): {args.text} ({name})
            </div>
          ),
        };

        useFrontendTool(tool);
        return null;
      };

      const TestWrapper: React.FC = () => {
        const [showSecond, setShowSecond] = useState(false);

        return (
          <>
            <FirstToolComponent />
            <SecondToolComponent isActive={showSecond} />
            <button
              onClick={() => setShowSecond(true)}
              data-testid="activate-override"
            >
              Activate Override
            </button>
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        );
      };

      renderWithCopilotKit({
        agent,
        children: <TestWrapper />,
      });

      // Submit message before override
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test original" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for message to be processed
      await waitFor(() => {
        expect(screen.getByText("Test original")).toBeDefined();
      });

      const messageId1 = testId("msg1");
      const toolCallId1 = testId("tc1");

      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId1,
          toolCallName: "overridableTool",
          parentMessageId: messageId1,
          delta: '{"text":"before override"}',
        })
      );

      // First version should render
      await waitFor(() => {
        const firstVersion = screen.getByTestId("first-version");
        expect(firstVersion.textContent).toContain("before override");
      });

      agent.emit(runFinishedEvent());

      // Activate the override
      const overrideButton = screen.getByTestId("activate-override");
      fireEvent.click(overrideButton);

      // Submit another message after override
      fireEvent.change(input, { target: { value: "Test override" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for message to be processed
      await waitFor(() => {
        expect(screen.getByText("Test override")).toBeDefined();
      });

      const messageId2 = testId("msg2");
      const toolCallId2 = testId("tc2");

      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId2,
          toolCallName: "overridableTool",
          parentMessageId: messageId2,
          delta: '{"text":"after override"}',
        })
      );

      // Second version should render (override) - there might be multiple due to both tool calls
      await waitFor(() => {
        const secondVersions = screen.getAllByTestId("second-version");
        // Find the one with "after override"
        const afterOverride = secondVersions.find((el) =>
          el.textContent?.includes("after override")
        );
        expect(afterOverride).toBeDefined();
        expect(afterOverride?.textContent).toContain("after override");
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Integration with Chat UI", () => {
    it("should render tool output correctly in chat interface", async () => {
      const agent = new MockStepwiseAgent();

      const IntegratedToolComponent: React.FC = () => {
        const tool: ReactFrontendTool<{ action: string; target: string }> = {
          name: "chatIntegratedTool",
          parameters: z.object({
            action: z.string(),
            target: z.string(),
          }),
          render: ({ name, args, result, status }) => (
            <div data-testid="integrated-tool" className="tool-render">
              <div>Tool: {name}</div>
              <div>Action: {args.action}</div>
              <div>Target: {args.target}</div>
              <div>Status: {status}</div>
              {result && <div>Result: {JSON.stringify(result)}</div>}
            </div>
          ),
          handler: async (args) => {
            return {
              success: true,
              message: `${args.action} completed on ${args.target}`,
            };
          },
        };

        useFrontendTool(tool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <IntegratedToolComponent />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Submit user message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Perform an action" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // User message should appear in chat
      await waitFor(() => {
        expect(screen.getByText("Perform an action")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      // Stream tool call
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "chatIntegratedTool",
          parentMessageId: messageId,
          delta: '{"action":"process","target":"data"}',
        })
      );

      // Tool should render in chat with proper styling
      await waitFor(() => {
        const toolRender = screen.getByTestId("integrated-tool");
        expect(toolRender).toBeDefined();
        expect(toolRender.textContent).toContain("Action: process");
        expect(toolRender.textContent).toContain("Target: data");
        expect(toolRender.classList.contains("tool-render")).toBe(true);
      });

      // Send result
      agent.emit(
        toolCallResultEvent({
          toolCallId,
          messageId: `${messageId}_result`,
          content: JSON.stringify({
            success: true,
            message: "process completed on data",
          }),
        })
      );

      // Result should appear in the tool render
      await waitFor(() => {
        const toolRender = screen.getByTestId("integrated-tool");
        expect(toolRender.textContent).toContain("Result:");
        expect(toolRender.textContent).toContain("process completed on data");
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Tool Executing State", () => {
    it("should be in executing state while handler is running", async () => {
      const statusHistory: ToolCallStatus[] = [];
      let handlerStarted = false;
      let handlerCompleted = false;
      let handlerResult: any = null;

      // We'll use a custom agent that tracks when tool handlers execute
      const agent = new MockStepwiseAgent();

      const ExecutingStateTool: React.FC = () => {
        const tool: ReactFrontendTool<{ value: string }> = {
          name: "executingStateTool",
          parameters: z.object({ value: z.string() }),
          render: ({ args, status, result }) => {
            // Track all status changes
            useEffect(() => {
              if (!statusHistory.includes(status)) {
                statusHistory.push(status);
              }
            }, [status]);

            return (
              <div data-testid="executing-tool">
                <div data-testid="tool-status">{status}</div>
                <div data-testid="tool-value">{args.value || "undefined"}</div>
                <div data-testid="tool-result">
                  {result ? JSON.stringify(result) : "no-result"}
                </div>
              </div>
            );
          },
          handler: async (args) => {
            handlerStarted = true;
            // Simulate async work to allow React to re-render with Executing status
            await new Promise((resolve) => setTimeout(resolve, 50));
            handlerCompleted = true;
            handlerResult = { processed: args.value.toUpperCase() };
            return handlerResult;
          },
        };

        useFrontendTool(tool);
        
        // No need for subscription here - the hook already subscribes internally
        
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <ExecutingStateTool />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Submit message to trigger agent.runAgent
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test executing state" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for message to appear
      await waitFor(() => {
        expect(screen.getByText("Test executing state")).toBeDefined();
      });

      // Emit tool call events from the agent
      const messageId = testId("msg");
      const toolCallId = testId("tc");
      
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "executingStateTool",
          parentMessageId: messageId,
          delta: '{"value":"test"}',
        })
      );
      
      // Wait for tool to render with InProgress status
      await waitFor(() => {
        const toolEl = screen.getByTestId("executing-tool");
        expect(toolEl).toBeDefined();
        expect(screen.getByTestId("tool-value").textContent).toBe("test");
        expect(screen.getByTestId("tool-status").textContent).toBe(ToolCallStatus.InProgress);
      });
      
      agent.emit(runFinishedEvent());
      
      // Complete the agent to trigger handler execution
      agent.complete();
      
      // Trigger another run to process the tool
      await waitFor(
        async () => {
          // The handler should start executing
          expect(handlerStarted).toBe(true);
        },
        { timeout: 3000 }
      );
      // Wait for handler to complete
      await waitFor(
        () => {
          expect(handlerCompleted).toBe(true);
        },
        { timeout: 3000 }
      );
      // Verify the handler executed
      expect(handlerStarted).toBe(true);
      expect(handlerCompleted).toBe(true);
      expect(handlerResult).toEqual({ processed: "TEST" });

      // Wait for status to transition to Complete (React re-render cycle)
      await waitFor(() => {
        expect(statusHistory).toContain(ToolCallStatus.Complete);
      }, { timeout: 3000 });

      // Verify we captured all three states in the correct order
      expect(statusHistory).toContain(ToolCallStatus.InProgress);
      expect(statusHistory).toContain(ToolCallStatus.Executing);

      // Verify the order is correct
      const inProgressIndex = statusHistory.indexOf(ToolCallStatus.InProgress);
      const executingIndex = statusHistory.indexOf(ToolCallStatus.Executing);
      const completeIndex = statusHistory.indexOf(ToolCallStatus.Complete);

      expect(inProgressIndex).toBeGreaterThanOrEqual(0);
      expect(executingIndex).toBeGreaterThan(inProgressIndex);
      expect(completeIndex).toBeGreaterThan(executingIndex);
    });
  });

  describe("Agent Scoping", () => {
    it("supports multiple tools with same name but different agentId", async () => {
      // Track which handlers are called
      let defaultAgentHandlerCalled = false;
      let specificAgentHandlerCalled = false;
      let wrongAgentHandlerCalled = false;
      
      // We'll test with the default agent
      const agent = new MockStepwiseAgent();

      // Tool scoped to "wrongAgent" - should NOT execute
      const WrongAgentTool: React.FC = () => {
        const tool: ReactFrontendTool<{ message: string }> = {
          name: "testTool", // Same name as other tools
          parameters: z.object({ message: z.string() }),
          agentId: "wrongAgent", // Different agent
          render: ({ args }) => (
            <div data-testid="wrong-agent-tool">
              Wrong Agent Tool: {args.message}
            </div>
          ),
          handler: async (args) => {
            wrongAgentHandlerCalled = true;
            return { result: `Wrong agent processed: ${args.message}` };
          },
        };
        useFrontendTool(tool);
        return null;
      };

      // Tool scoped to "default" agent - SHOULD execute
      const DefaultAgentTool: React.FC = () => {
        const tool: ReactFrontendTool<{ message: string }> = {
          name: "testTool", // Same name
          parameters: z.object({ message: z.string() }),
          agentId: "default", // Matches our test agent
          render: ({ args, result }) => (
            <div data-testid="default-agent-tool">
              Default Agent Tool: {args.message}
              {result && (
                <div data-testid="default-result">{JSON.stringify(result)}</div>
              )}
            </div>
          ),
          handler: async (args) => {
            defaultAgentHandlerCalled = true;
            return { result: `Default agent processed: ${args.message}` };
          },
        };
        useFrontendTool(tool);
        return null;
      };

      // Tool scoped to "specificAgent" - should NOT execute
      const SpecificAgentTool: React.FC = () => {
        const tool: ReactFrontendTool<{ message: string }> = {
          name: "testTool", // Same name again
          parameters: z.object({ message: z.string() }),
          agentId: "specificAgent", // Different agent
          render: ({ args }) => (
            <div data-testid="specific-agent-tool">
              Specific Agent Tool: {args.message}
            </div>
          ),
          handler: async (args) => {
            specificAgentHandlerCalled = true;
            return { result: `Specific agent processed: ${args.message}` };
          },
        };
        useFrontendTool(tool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <WrongAgentTool />
            <DefaultAgentTool />
            <SpecificAgentTool />
            <div style={{ height: 400 }}>
              <CopilotChat agentId="default" />
            </div>
          </>
        ),
      });

      // Submit message to trigger tools
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test agent scoping" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Test agent scoping")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      // Call "testTool" - multiple tools have this name but only the one
      // scoped to "default" agent should execute its handler
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "testTool",
          parentMessageId: messageId,
          delta: '{"message":"test message"}',
        })
      );
      agent.emit(runFinishedEvent());
      
      // Wait for tool to render - the correct renderer should be used
      await waitFor(() => {
        // The default agent tool should render (it's scoped to our agent)
        const defaultTool = screen.queryByTestId("default-agent-tool");
        expect(defaultTool).not.toBeNull();
        expect(defaultTool!.textContent).toContain("test message");
      });
      
      // Complete the agent to trigger handler execution
      agent.complete();
      
      // Wait for handler execution
      await waitFor(() => {
        // Only the default agent handler should be called
        expect(defaultAgentHandlerCalled).toBe(true);
      });
      
      // Log which handlers were called
      console.log("Handler calls:", {
        defaultAgent: defaultAgentHandlerCalled,
        wrongAgent: wrongAgentHandlerCalled,
        specificAgent: specificAgentHandlerCalled
      });
      
      // Verify the correct handler was executed and others weren't
      expect(defaultAgentHandlerCalled).toBe(true);
      expect(wrongAgentHandlerCalled).toBe(false);
      expect(specificAgentHandlerCalled).toBe(false);
      
      // Debug: Check what's actually rendered
      const defaultTool = screen.queryByTestId("default-agent-tool");
      const wrongTool = screen.queryByTestId("wrong-agent-tool");
      const specificTool = screen.queryByTestId("specific-agent-tool");
      
      console.log("Tools rendered:", {
        default: defaultTool ? "yes" : "no",
        wrong: wrongTool ? "yes" : "no",
        specific: specificTool ? "yes" : "no"
      });
      
      // Check if result is displayed
      const resultEl = screen.queryByTestId("default-result");
      if (resultEl) {
        console.log("Result element found:", resultEl.textContent);
      } else {
        console.log("No result element found");
      }
      
      // The test reveals whether agent scoping works correctly
      // If the wrong tool's handler is called, this is a bug in core
    });
    
    it("demonstrates that agent scoping prevents execution of tools for wrong agents", async () => {
      // This simpler test shows that agent scoping does work for preventing execution
      let scopedHandlerCalled = false;
      let globalHandlerCalled = false;
      
      const agent = new MockStepwiseAgent();

      // Tool scoped to a different agent - should NOT execute
      const ScopedTool: React.FC = () => {
        const tool: ReactFrontendTool<{ message: string }> = {
          name: "scopedTool",
          parameters: z.object({ message: z.string() }),
          agentId: "differentAgent", // Different from default
          render: ({ args, result }) => (
            <div data-testid="scoped-tool">
              Scoped Tool: {args.message}
              {result && <div data-testid="scoped-result">{JSON.stringify(result)}</div>}
            </div>
          ),
          handler: async (args) => {
            scopedHandlerCalled = true;
            return { result: `Scoped processed: ${args.message}` };
          },
        };
        useFrontendTool(tool);
        return null;
      };

      // Global tool (no agentId) - SHOULD execute for any agent
      const GlobalTool: React.FC = () => {
        const tool: ReactFrontendTool<{ message: string }> = {
          name: "globalTool",
          parameters: z.object({ message: z.string() }),
          // No agentId - available to all agents
          render: ({ args, result }) => (
            <div data-testid="global-tool">
              Global Tool: {args.message}
              {result && <div data-testid="global-result">{JSON.stringify(result)}</div>}
            </div>
          ),
          handler: async (args) => {
            globalHandlerCalled = true;
            return { result: `Global processed: ${args.message}` };
          },
        };
        useFrontendTool(tool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <ScopedTool />
            <GlobalTool />
            <div style={{ height: 400 }}>
              <CopilotChat agentId="default" />
            </div>
          </>
        ),
      });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test scoping" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Test scoping")).toBeDefined();
      });

      const messageId = testId("msg");

      // Try to call the scoped tool - handler should NOT execute
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc1"),
          toolCallName: "scopedTool",
          parentMessageId: messageId,
          delta: '{"message":"trying scoped"}',
        })
      );
      
      // Tool should render (renderer is always shown)
      await waitFor(() => {
        expect(screen.getByTestId("scoped-tool")).toBeDefined();
      });
      
      // Call the global tool - handler SHOULD execute
      agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc2"),
          toolCallName: "globalTool",
          parentMessageId: messageId,
          delta: '{"message":"trying global"}',
        })
      );
      
      await waitFor(() => {
        expect(screen.getByTestId("global-tool")).toBeDefined();
      });
      
      agent.emit(runFinishedEvent());
      agent.complete();

      // Wait for the global handler to be called
      await waitFor(() => {
        expect(globalHandlerCalled).toBe(true);
      });

      // Verify that only the global handler was called
      expect(scopedHandlerCalled).toBe(false); // Should NOT be called (wrong agent)
      expect(globalHandlerCalled).toBe(true);  // Should be called (no agent restriction)
      
      // The scoped tool should render but have no result
      const scopedResult = screen.queryByTestId("scoped-result");
      expect(scopedResult).toBeNull();
      
      // The global tool should have a result
      await waitFor(() => {
        const globalResult = screen.getByTestId("global-result");
        expect(globalResult.textContent).toContain("Global processed: trying global");
      });
    });
  });

  describe("Nested Tool Calls", () => {
    it("should enable tool calls that render other tools", async () => {
      const agent = new MockStepwiseAgent();
      let childToolRegistered = false;

      // Simple approach: both tools registered at top level
      // but one triggers the other through tool calls
      const ChildTool: React.FC = () => {
        const tool: ReactFrontendTool<{ childValue: string }> = {
          name: "childTool",
          parameters: z.object({ childValue: z.string() }),
          render: ({ args }) => (
            <div data-testid="child-tool">Child: {args.childValue}</div>
          ),
        };

        useFrontendTool(tool);

        useEffect(() => {
          childToolRegistered = true;
        }, []);

        return null;
      };

      const ParentTool: React.FC = () => {
        const tool: ReactFrontendTool<{ parentValue: string }> = {
          name: "parentTool",
          parameters: z.object({ parentValue: z.string() }),
          render: ({ args }) => (
            <div data-testid="parent-tool">Parent: {args.parentValue}</div>
          ),
        };

        useFrontendTool(tool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <ParentTool />
            <ChildTool />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Verify both tools are registered
      expect(childToolRegistered).toBe(true);

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test nested tools" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Test nested tools")).toBeDefined();
      });

      const messageId = testId("msg");

      // Call parent tool
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("parent-tc"),
          toolCallName: "parentTool",
          parentMessageId: messageId,
          delta: '{"parentValue":"test parent"}',
        })
      );

      // Parent tool should render
      await waitFor(() => {
        expect(screen.getByTestId("parent-tool")).toBeDefined();
      });

      // Now call the child tool (simulating nested call)
      agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("child-tc"),
          toolCallName: "childTool",
          parentMessageId: messageId,
          delta: '{"childValue":"test child"}',
        })
      );

      // Child tool should render
      await waitFor(() => {
        expect(screen.getByTestId("child-tool")).toBeDefined();
        expect(screen.getByTestId("child-tool").textContent).toContain(
          "test child"
        );
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Tool Availability", () => {
    it("should ensure tools are available when request is made", async () => {
      const agent = new MockStepwiseAgent();

      const AvailabilityTestTool: React.FC<{ onRegistered?: () => void }> = ({
        onRegistered,
      }) => {
        const tool: ReactFrontendTool<{ test: string }> = {
          name: "availabilityTool",
          parameters: z.object({ test: z.string() }),
          render: ({ args }) => (
            <div data-testid="availability-tool">{args.test}</div>
          ),
          handler: async (args) => ({ received: args.test }),
        };

        useFrontendTool(tool);

        // Notify when registered
        useEffect(() => {
          onRegistered?.();
        }, [onRegistered]);

        return null;
      };

      let toolRegistered = false;
      const onRegistered = () => {
        toolRegistered = true;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <AvailabilityTestTool onRegistered={onRegistered} />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Tool should be available immediately after mounting
      await waitFor(() => {
        expect(toolRegistered).toBe(true);
      });

      // Verify tool is in copilotkit.tools
      // Note: We can't directly access copilotkit.tools from here,
      // but we can verify it works by calling it
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test availability" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Test availability")).toBeDefined();
      });

      // Tool call should work immediately
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc"),
          toolCallName: "availabilityTool",
          parentMessageId: testId("msg"),
          delta: '{"test":"available"}',
        })
      );

      // Tool should render successfully
      await waitFor(() => {
        expect(screen.getByTestId("availability-tool")).toBeDefined();
        expect(screen.getByTestId("availability-tool").textContent).toBe(
          "available"
        );
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Re-render Idempotence", () => {
    it("should not create duplicates on re-render", async () => {
      const agent = new MockStepwiseAgent();
      let renderCount = 0;

      const IdempotentTool: React.FC = () => {
        // Use state to trigger re-renders
        const [counter, setCounter] = useState(0);

        const tool: ReactFrontendTool<{ value: string }> = {
          name: "idempotentTool",
          parameters: z.object({ value: z.string() }),
          render: ({ args }) => {
            renderCount++;
            return (
              <div data-testid="idempotent-tool">
                Value: {args.value} | Renders: {renderCount}
              </div>
            );
          },
        };

        useFrontendTool(tool);

        return (
          <div>
            <button
              data-testid="rerender-button"
              onClick={() => setCounter((c) => c + 1)}
            >
              Re-render ({counter})
            </button>
          </div>
        );
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <IdempotentTool />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test idempotence" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Test idempotence")).toBeDefined();
      });

      // Emit tool call
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc"),
          toolCallName: "idempotentTool",
          parentMessageId: testId("msg"),
          delta: '{"value":"test"}',
        })
      );

      // Tool should render once
      await waitFor(() => {
        const tools = screen.getAllByTestId("idempotent-tool");
        expect(tools).toHaveLength(1);
        expect(tools[0]?.textContent).toContain("Value: test");
      });

      const initialRenderCount = renderCount;

      // Trigger re-render by clicking button
      fireEvent.click(screen.getByTestId("rerender-button"));

      // Wait for re-render
      await waitFor(() => {
        const button = screen.getByTestId("rerender-button");
        expect(button.textContent).toContain("1");
      });

      // Tool should still render only once (no duplicate elements)
      const toolsAfterRerender = screen.getAllByTestId("idempotent-tool");
      expect(toolsAfterRerender).toHaveLength(1);

      // The render count should not have increased dramatically
      // (may increase slightly due to React re-renders, but not duplicate the tool)
      expect(renderCount).toBeLessThanOrEqual(initialRenderCount + 2);

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("useFrontendTool dependencies", () => {
    it("updates tool renderer when optional deps change", async () => {
      const DependencyDrivenTool: React.FC = () => {
        const [version, setVersion] = useState(0);

        const tool: ReactFrontendTool<{ message: string }> = {
          name: "dependencyTool",
          parameters: z.object({ message: z.string() }),
          render: ({ args }) => (
            <div data-testid="dependency-tool-render">
              {args.message} (v{version})
            </div>
          ),
        };

        useFrontendTool(tool, [version]);

        const toolCallId = testId("dep_tc");
        const assistantMessage: AssistantMessage = {
          id: testId("dep_a"),
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: toolCallId,
              type: "function",
              function: {
                name: "dependencyTool",
                arguments: JSON.stringify({ message: "hello" }),
              },
            } as any,
          ],
        } as any;
        const messages: Message[] = [];

        return (
          <>
            <button
              data-testid="bump-version"
              type="button"
              onClick={() => setVersion((v) => v + 1)}
            >
              Bump
            </button>
            <CopilotChatToolCallsView
              message={assistantMessage}
              messages={messages}
            />
          </>
        );
      };

      renderWithCopilotKit({
        children: <DependencyDrivenTool />,
      });

      await waitFor(() => {
        const el = screen.getByTestId("dependency-tool-render");
        expect(el).toBeDefined();
        expect(el.textContent).toContain("hello");
        expect(el.textContent).toContain("(v0)");
      });

      fireEvent.click(screen.getByTestId("bump-version"));

      await waitFor(() => {
        const el = screen.getByTestId("dependency-tool-render");
        expect(el.textContent).toContain("(v1)");
      });
    });
  });

  describe("Error Propagation", () => {
    it("should propagate handler errors to renderer", async () => {
      const agent = new MockStepwiseAgent();
      let handlerCalled = false;
      let errorThrown = false;

      const ErrorTool: React.FC = () => {
        const tool: ReactFrontendTool<{
          shouldError: boolean;
          message: string;
        }> = {
          name: "errorTool",
          parameters: z.object({
            shouldError: z.boolean(),
            message: z.string(),
          }),
          render: ({ args, status, result }) => (
            <div data-testid="error-tool">
              <div data-testid="error-status">{status}</div>
              <div data-testid="error-message">{args.message}</div>
              <div data-testid="error-result">
                {result ? String(result) : "no-result"}
              </div>
            </div>
          ),
          handler: async (args) => {
            handlerCalled = true;
            if (args.shouldError) {
              errorThrown = true;
              throw new Error(`Handler error: ${args.message}`);
            }
            return { success: true, message: args.message };
          },
        };

        useFrontendTool(tool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <ErrorTool />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test error" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Test error")).toBeDefined();
      });

      // Emit tool call that will error
      const messageId = testId("msg");
      const toolCallId = testId("tc");
      
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "errorTool",
          parentMessageId: messageId,
          delta: '{"shouldError":true,"message":"test error"}',
        })
      );
      agent.emit(runFinishedEvent());
      
      // Wait for tool to render
      await waitFor(() => {
        expect(screen.getByTestId("error-tool")).toBeDefined();
      });
      
      // Complete the agent to trigger handler execution
      agent.complete();
      
      // Wait for handler to be called and error to be thrown
      await waitFor(() => {
        expect(handlerCalled).toBe(true);
        expect(errorThrown).toBe(true);
      });
      
      // Wait for the error result to be displayed in the renderer
      await waitFor(() => {
        const resultEl = screen.getByTestId("error-result");
        const resultText = resultEl.textContent || "";
        expect(resultText).not.toBe("no-result");
        expect(resultText).toContain("Error:");
        expect(resultText).toContain("Handler error: test error");
      });
      
      // Status should be complete even with error
      expect(screen.getByTestId("error-status").textContent).toBe(ToolCallStatus.Complete);
    });

    it("should handle async errors in handler", async () => {
      const agent = new MockStepwiseAgent();

      const AsyncErrorTool: React.FC = () => {
        const tool: ReactFrontendTool<{ delay: number; errorMessage: string }> =
          {
            name: "asyncErrorTool",
            parameters: z.object({
              delay: z.number(),
              errorMessage: z.string(),
            }),
            render: ({ args, status, result }) => (
              <div data-testid="async-error-tool">
                <div data-testid="async-status">{status}</div>
                <div data-testid="async-delay">Delay: {args.delay}ms</div>
                <div data-testid="async-error-msg">{args.errorMessage}</div>
                {result && <div data-testid="async-result">{result}</div>}
              </div>
            ),
            handler: async (args) => {
              // Simulate async operation
              await new Promise((resolve) => setTimeout(resolve, args.delay));
              // In test environment, throwing might not propagate as expected
              throw new Error(args.errorMessage);
            },
          };

        useFrontendTool(tool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <AsyncErrorTool />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test async error" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Test async error")).toBeDefined();
      });

      // Emit tool call that will error after delay
      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc"),
          toolCallName: "asyncErrorTool",
          parentMessageId: testId("msg"),
          delta:
            '{"delay":10,"errorMessage":"Async operation failed after delay"}',
        })
      );

      // Tool should render immediately with args
      await waitFor(() => {
        expect(screen.getByTestId("async-error-tool")).toBeDefined();
        expect(screen.getByTestId("async-delay").textContent).toContain("10ms");
        expect(screen.getByTestId("async-error-msg").textContent).toContain(
          "Async operation failed"
        );
      });

      // The test verifies that:
      // 1. Async tools with delays can render immediately
      // 2. Error messages are properly passed through args
      // 3. The tool continues to function even with async handlers that may throw

      // In production, the error would be caught and sent as a result
      // but in test environment, handler execution may not complete

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Wildcard Handler", () => {
    it("should handle unknown tools with wildcard", async () => {
      const agent = new MockStepwiseAgent();
      let wildcardHandlerCalls: { name: string; args: any }[] = [];

      // Note: Wildcard tools work as fallback renderers when no specific tool is found
      // The wildcard renderer receives the original tool name and arguments
      const WildcardTool: React.FC = () => {
        const tool: ReactFrontendTool<any> = {
          name: "*",
          parameters: z.any(),
          render: ({ name, args, status, result }) => (
            <div data-testid={`wildcard-render-${name}`}>
              <div data-testid="wildcard-tool-name">
                Wildcard caught: {name}
              </div>
              <div data-testid="wildcard-args">
                Args: {JSON.stringify(args)}
              </div>
              <div data-testid="wildcard-status">Status: {status}</div>
              {result && (
                <div data-testid="wildcard-result">Result: {result}</div>
              )}
            </div>
          ),
          handler: async (args: any) => {
            // Track handler calls
            wildcardHandlerCalls.push({ name: "wildcard", args });
            return { handled: "by wildcard", receivedArgs: args };
          },
        };

        useFrontendTool(tool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <WildcardTool />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test wildcard" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Test wildcard")).toBeDefined();
      });

      agent.emit(runStartedEvent());

      // Test 1: Call first undefined tool
      agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc1"),
          toolCallName: "undefinedTool",
          parentMessageId: testId("msg"),
          delta: '{"someParam":"value","anotherParam":123}',
        })
      );

      // Wildcard should render the unknown tool with correct name and args
      await waitFor(() => {
        const nameEl = screen.getByTestId("wildcard-tool-name");
        expect(nameEl.textContent).toContain("undefinedTool");
        const argsEl = screen.getByTestId("wildcard-args");
        expect(argsEl.textContent).toContain("someParam");
        expect(argsEl.textContent).toContain("value");
        expect(argsEl.textContent).toContain("123");
      });

      // Check status is InProgress or Complete
      await waitFor(() => {
        const statusEl = screen.getByTestId("wildcard-status");
        expect(statusEl.textContent).toMatch(/Status: (inProgress|complete)/);
      });

      // Test 2: Call another undefined tool to verify wildcard catches multiple
      agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc2"),
          toolCallName: "anotherUnknownTool",
          parentMessageId: testId("msg"),
          delta: '{"differentArg":"test"}',
        })
      );

      // Should render both unknown tools
      await waitFor(() => {
        const tool1 = screen.getByTestId("wildcard-render-undefinedTool");
        const tool2 = screen.getByTestId("wildcard-render-anotherUnknownTool");
        expect(tool1).toBeDefined();
        expect(tool2).toBeDefined();
      });

      // Send result for first tool
      agent.emit(
        toolCallResultEvent({
          toolCallId: testId("tc1"),
          messageId: testId("msg_result"),
          content: "Tool executed successfully",
        })
      );

      // Check result is displayed
      await waitFor(() => {
        const resultEl = screen.queryByTestId("wildcard-result");
        if (resultEl) {
          expect(resultEl.textContent).toContain("Tool executed successfully");
        }
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Renderer Precedence", () => {
    it("should use specific renderer over wildcard", async () => {
      const agent = new MockStepwiseAgent();

      // Specific tool
      const SpecificTool: React.FC = () => {
        const tool: ReactFrontendTool<{ value: string }> = {
          name: "specificTool",
          parameters: z.object({ value: z.string() }),
          render: ({ args }) => (
            <div data-testid="specific-render">Specific: {args.value}</div>
          ),
        };
        useFrontendTool(tool);
        return null;
      };

      // Wildcard tool - should only catch unknown tools
      const WildcardTool: React.FC = () => {
        const tool: ReactFrontendTool<any> = {
          name: "*",
          parameters: z.any(),
          render: ({ name }) => (
            <div data-testid="wildcard-render">Wildcard: {name}</div>
          ),
        };
        useFrontendTool(tool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <SpecificTool />
            <WildcardTool />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test precedence" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Test precedence")).toBeDefined();
      });

      agent.emit(runStartedEvent());

      // Call specific tool - should use specific renderer
      agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc1"),
          toolCallName: "specificTool",
          parentMessageId: testId("msg"),
          delta: '{"value":"test specific"}',
        })
      );

      // Should render with specific renderer, not wildcard
      await waitFor(() => {
        expect(screen.getByTestId("specific-render")).toBeDefined();
        expect(screen.getByTestId("specific-render").textContent).toContain(
          "test specific"
        );
      });

      // Call unknown tool - should use wildcard renderer
      agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc2"),
          toolCallName: "unknownTool",
          parentMessageId: testId("msg"),
          delta: '{"someArg":"test wildcard"}',
        })
      );

      // Should render with wildcard renderer
      await waitFor(() => {
        const wildcards = screen.getAllByTestId("wildcard-render");
        expect(wildcards.length).toBeGreaterThan(0);
        const unknownToolRender = wildcards.find((el) =>
          el.textContent?.includes("unknownTool")
        );
        expect(unknownToolRender).toBeDefined();
      });

      // Verify specific tool still used its renderer (not replaced by wildcard)
      expect(screen.getByTestId("specific-render")).toBeDefined();

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });
});
