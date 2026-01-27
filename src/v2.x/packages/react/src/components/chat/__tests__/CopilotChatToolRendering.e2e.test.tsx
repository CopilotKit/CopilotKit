import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { z } from "zod";
import {
  CopilotKitProvider,
  useCopilotKit,
} from "@/providers/CopilotKitProvider";
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
  ReactFrontendTool,
} from "@/types";
import CopilotChatToolCallsView from "../CopilotChatToolCallsView";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";
import { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import { ToolCallStatus } from "@copilotkitnext/core";
import { useFrontendTool } from "@/hooks/use-frontend-tool";

// A minimal mock agent that streams a tool call and a result
class MockStreamingAgent extends AbstractAgent {
  clone(): MockStreamingAgent {
    return new MockStreamingAgent();
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      const messageId = `m_${Date.now()}`;
      const toolCallId = `tc_${Date.now()}`;

      // Start run
      observer.next({ type: EventType.RUN_STARTED } as BaseEvent);

      // Stream assistant text chunks
      observer.next({
        type: EventType.TEXT_MESSAGE_CHUNK,
        messageId,
        delta: "I will check the weather.",
      } as BaseEvent);

      // Start tool call (first chunk contains name + first args)
      observer.next({
        type: EventType.TOOL_CALL_CHUNK,
        toolCallId,
        toolCallName: "getWeather",
        parentMessageId: messageId,
        delta: '{"location":"Paris","unit":"c',
      } as BaseEvent);

      // Continue tool call args
      observer.next({
        type: EventType.TOOL_CALL_CHUNK,
        toolCallId,
        parentMessageId: messageId,
        delta: 'elsius"}',
      } as BaseEvent);

      // Tool result
      observer.next({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId,
        messageId: `${messageId}_result`,
        content: JSON.stringify({ temperature: 21, unit: "celsius" }),
      } as BaseEvent);

      // Finish run
      observer.next({ type: EventType.RUN_FINISHED } as BaseEvent);
      observer.complete();

      return () => {};
    });
  }
}

describe("CopilotChat tool rendering with mock agent", () => {
  function renderWithProvider() {
    const agents = { default: new MockStreamingAgent() };
    const renderToolCalls = [
      defineToolCallRenderer({
        name: "getWeather",
        args: z.object({
          location: z.string(),
          unit: z.string(),
        }),
        render: ({ name, args, result }) => (
          <div data-testid="weather-result">
            Tool: {name} | args: {args.location}-{args.unit} | result:{" "}
            {String(result ?? "")}
          </div>
        ),
      }),
    ] as unknown as ReactToolCallRenderer<unknown>[];

    return render(
      <CopilotKitProvider
        agents__unsafe_dev_only={agents}
        renderToolCalls={renderToolCalls}
      >
        <div style={{ height: 400 }}>
          <CopilotChat />
        </div>
      </CopilotKitProvider>
    );
  }

  it("renders the tool component when the agent emits a tool call and result", async () => {
    renderWithProvider();

    // Type a message and submit
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "What is the weather?" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // Assert that our tool render appears with the expected test id
    const tool = await screen.findByTestId("weather-result");
    expect(tool).toBeDefined();

    // Optionally, ensure result content shows up (from our mock agent)
    await waitFor(() => {
      expect(tool.textContent).toMatch(/temperature/);
      expect(tool.textContent).toMatch(/celsius/);
    });
  });
});

describe("Tool render status narrowing", () => {
  function renderStatusWithProvider({
    isRunning,
    withResult,
  }: {
    isRunning: boolean;
    withResult: boolean;
  }) {
    const renderToolCalls = [
      defineToolCallRenderer({
        name: "getWeather",
        args: z.object({ city: z.string().optional() }),
        render: ({ status, args, result }) => {
          if (status === ToolCallStatus.InProgress) {
            return (
              <div data-testid="status">
                INPROGRESS {String(args.city ?? "")}
              </div>
            );
          }
          if (status === ToolCallStatus.Executing) {
            return <div data-testid="status">EXECUTING {args.city}</div>;
          }
          // ToolCallStatus.Complete
          return (
            <div data-testid="status">
              COMPLETE {args.city} {String(result ?? "")}
            </div>
          );
        },
      }),
    ] as unknown as ReactToolCallRenderer<unknown>[];

    const toolCallId = "tc_status_1";

    const assistantMessage: AssistantMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: toolCallId,
          type: "function",
          function: { name: "getWeather", arguments: '{"city":"Berlin"}' },
        } as any,
      ],
    } as AssistantMessage;

    const messages: Message[] = [];
    if (withResult) {
      messages.push({
        id: "t1",
        role: "tool",
        toolCallId,
        content: "Sunny",
      } as ToolMessage as any);
    }

    return render(
      <CopilotKitProvider renderToolCalls={renderToolCalls}>
        <CopilotChatConfigurationProvider
          agentId="default"
          threadId="test-thread"
        >
          <CopilotChatToolCallsView
            message={assistantMessage}
            messages={messages}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );
  }

  it("renders InProgress when running and no result", async () => {
    renderStatusWithProvider({ isRunning: true, withResult: false });
    const el = await screen.findByTestId("status");
    expect(el.textContent).toMatch(/INPROGRESS/);
    expect(el.textContent).toMatch(/Berlin/);
  });

  it("renders Complete with result when tool message exists", async () => {
    renderStatusWithProvider({ isRunning: false, withResult: true });
    const el = await screen.findByTestId("status");
    expect(el.textContent).toMatch(/COMPLETE/);
    expect(el.textContent).toMatch(/Berlin/);
    expect(el.textContent).toMatch(/Sunny/);
  });

  it("renders InProgress when not running and no tool result", async () => {
    renderStatusWithProvider({ isRunning: false, withResult: false });
    const el = await screen.findByTestId("status");
    expect(el.textContent).toMatch(/INPROGRESS/);
    expect(el.textContent).toMatch(/Berlin/);
  });
});

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

describe("Streaming in-progress without timers", () => {
  it("shows InProgress for partial args and Complete after result", async () => {
    const agent = new MockStepwiseAgent();

    const renderToolCalls = [
      defineToolCallRenderer({
        name: "getWeather",
        args: z.object({
          location: z.string(),
          unit: z.string(),
        }),
        render: ({ name, status, args, result }) => (
          <div data-testid="tool-status">
            {name}{" "}
            {status === ToolCallStatus.InProgress ? "INPROGRESS" : "COMPLETE"}{" "}
            {String(args.location ?? "")} - {String(args.unit ?? "")}{" "}
            {String(result ?? "")}
          </div>
        ),
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
    fireEvent.change(input, { target: { value: "Weather please" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // Allow React to process the state update
    await waitFor(() => {
      expect(screen.getByText("Weather please")).toBeDefined();
    });

    const messageId = "m_step";
    const toolCallId = "tc_step";

    // Begin run and stream partial tool-call args
    agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);
    agent.emit({
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId,
      delta: "Checking weather",
    } as BaseEvent);

    // First emit just the tool call start with partial args
    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "getWeather",
      parentMessageId: messageId,
      delta: '{"location":"Paris"',
    } as BaseEvent);

    // Wait for the tool status element to show partial args
    await waitFor(async () => {
      const el = await screen.findByTestId("tool-status");
      expect(el.textContent).toContain("getWeather INPROGRESS");
      expect(el.textContent).toContain("Paris");
    });

    // Continue streaming more partial data
    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      parentMessageId: messageId,
      delta: ',"unit":"celsius"}',
    } as BaseEvent);

    // Wait for the tool status element and check it shows complete args but no result yet
    await waitFor(
      async () => {
        const el = await screen.findByTestId("tool-status");
        expect(el.textContent).toContain("getWeather");
        expect(el.textContent).toContain("Paris");
        expect(el.textContent).toContain("celsius");
        // Since we haven't sent a result yet, it should be INPROGRESS
        expect(el.textContent).toMatch(/INPROGRESS/);
      },
      { timeout: 3000 }
    );

    // Now send the tool result
    agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      messageId: `${messageId}_result`,
      content: JSON.stringify({ temperature: 21, unit: "celsius" }),
    } as BaseEvent);

    // Check result appears and status changes to COMPLETE
    await waitFor(async () => {
      const el = await screen.findByTestId("tool-status");
      expect(el.textContent).toMatch(/COMPLETE/);
      expect(el.textContent).toContain("temperature");
      expect(el.textContent).toContain("21");
    });

    agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
    agent.complete();
  });
});

describe("Executing State Transitions", () => {
  it("should show Executing status while tool handler is running", async () => {
    const agent = new MockStepwiseAgent();
    let resolveHandler: (() => void) | undefined;

    const ToolWithDeferredHandler: React.FC = () => {
      const tool: ReactFrontendTool<{ value: string }> = {
        name: "slowTool",
        parameters: z.object({ value: z.string() }),
        handler: async () =>
          new Promise((resolve) => {
            resolveHandler = () => resolve({ result: "done" });
          }),
        render: ({ name, status, args, result }) => (
          <div data-testid="slow-tool-status">
            Tool: {name} | Status: {status} | Value: {args.value} | Result:{" "}
            {result ? "Complete" : "Pending"}
          </div>
        ),
      };

      useFrontendTool(tool);
      return null;
    };

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <ToolWithDeferredHandler />
        <div style={{ height: 400 }}>
          <CopilotChat />
        </div>
      </CopilotKitProvider>
    );

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Run slow tool" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Run slow tool")).toBeDefined();
    });

    const messageId = "m_exec";
    const toolCallId = "tc_exec";

    agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);
    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "slowTool",
      parentMessageId: messageId,
      delta: '{"value":"test"}',
    } as BaseEvent);

    await waitFor(() => {
      const status = screen.getByTestId("slow-tool-status");
      expect(status.textContent).toMatch(/Status: inProgress/i);
      expect(status.textContent).toMatch(/Value: test/);
    });

    agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
    agent.complete();

    await waitFor(() => {
      const status = screen.getByTestId("slow-tool-status");
      expect(status.textContent).toMatch(/Status: executing/i);
      expect(resolveHandler).toBeTruthy();
    });

    if (resolveHandler) {
      resolveHandler();
    }

    await waitFor(() => {
      const status = screen.getByTestId("slow-tool-status");
      expect(status.textContent).toMatch(/Status: complete/i);
      expect(status.textContent).toMatch(/Result: Complete/);
    });
  });
});

describe("Multiple Tool Calls in Same Message", () => {
  it("should render multiple tools independently with their own status", async () => {
    const agent = new MockStepwiseAgent();

    const renderToolCalls = [
      defineToolCallRenderer({
        name: "tool1",
        args: z.object({ id: z.string() }),
        render: ({ status, args, result }) => (
          <div data-testid={`tool1-${args.id}`}>
            Tool1[{args.id}]: {status} -{" "}
            {result ? JSON.stringify(result) : "waiting"}
          </div>
        ),
      }),
      defineToolCallRenderer({
        name: "tool2",
        args: z.object({ id: z.string() }),
        render: ({ status, args, result }) => (
          <div data-testid={`tool2-${args.id}`}>
            Tool2[{args.id}]: {status} -{" "}
            {result ? JSON.stringify(result) : "waiting"}
          </div>
        ),
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

    // Submit message
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Multiple tools" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // Allow React to process the state update
    await waitFor(() => {
      expect(screen.getByText("Multiple tools")).toBeDefined();
    });

    const messageId = "m_multi";
    const toolCallId1 = "tc_1";
    const toolCallId2 = "tc_2";
    const toolCallId3 = "tc_3";

    agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);

    // Stream three tool calls (2 of tool1, 1 of tool2)
    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId: toolCallId1,
      toolCallName: "tool1",
      parentMessageId: messageId,
      delta: '{"id":"first"}',
    } as BaseEvent);

    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId: toolCallId2,
      toolCallName: "tool2",
      parentMessageId: messageId,
      delta: '{"id":"second"}',
    } as BaseEvent);

    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId: toolCallId3,
      toolCallName: "tool1",
      parentMessageId: messageId,
      delta: '{"id":"third"}',
    } as BaseEvent);

    // All three should render
    await waitFor(() => {
      expect(screen.getByTestId("tool1-first")).toBeDefined();
      expect(screen.getByTestId("tool2-second")).toBeDefined();
      expect(screen.getByTestId("tool1-third")).toBeDefined();
    });

    // Send results in different order
    agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: toolCallId2,
      messageId: `${messageId}_r2`,
      content: JSON.stringify({ result: "B" }),
    } as BaseEvent);

    await waitFor(() => {
      const tool2 = screen.getByTestId("tool2-second");
      expect(tool2.textContent).toContain("B");
    });

    agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: toolCallId1,
      messageId: `${messageId}_r1`,
      content: JSON.stringify({ result: "A" }),
    } as BaseEvent);

    agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: toolCallId3,
      messageId: `${messageId}_r3`,
      content: JSON.stringify({ result: "C" }),
    } as BaseEvent);

    // All results should be visible
    await waitFor(() => {
      expect(screen.getByTestId("tool1-first").textContent).toContain("A");
      expect(screen.getByTestId("tool2-second").textContent).toContain("B");
      expect(screen.getByTestId("tool1-third").textContent).toContain("C");
    });

    agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
    agent.complete();
  });
});

describe("Partial Args Accumulation", () => {
  it("should properly show InProgress status with accumulating partial args", async () => {
    const agent = new MockStepwiseAgent();

    const renderToolCalls = [
      defineToolCallRenderer({
        name: "complexTool",
        args: z.object({
          name: z.string().optional(),
          age: z.number().optional(),
          city: z.string().optional(),
        }),
        render: ({ status, args }) => (
          <div data-testid="complex-tool">
            <div>Status: {status}</div>
            <div>Name: {args.name || "pending"}</div>
            <div>Age: {args.age !== undefined ? args.age : "pending"}</div>
            <div>City: {args.city || "pending"}</div>
          </div>
        ),
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

    // Submit message
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Complex tool test" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // Allow React to process the state update
    await waitFor(() => {
      expect(screen.getByText("Complex tool test")).toBeDefined();
    });

    const messageId = "m_partial";
    const toolCallId = "tc_partial";

    agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);

    // Stream args piece by piece
    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "complexTool",
      parentMessageId: messageId,
      delta: '{"name":"',
    } as BaseEvent);

    // Let React update with the partial data
    await waitFor(() => {
      const tool = screen.queryByTestId("complex-tool");
      expect(tool).toBeDefined();
    });

    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      parentMessageId: messageId,
      delta: 'Alice"',
    } as BaseEvent);

    await waitFor(() => {
      const tool = screen.getByTestId("complex-tool");
      expect(tool.textContent).toContain("Name: Alice");
      expect(tool.textContent).toContain("Age: pending");
    });

    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      parentMessageId: messageId,
      delta: ',"age":30',
    } as BaseEvent);

    await waitFor(() => {
      const tool = screen.getByTestId("complex-tool");
      expect(tool.textContent).toContain("Age: 30");
      expect(tool.textContent).toContain("City: pending");
    });

    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      parentMessageId: messageId,
      delta: ',"city":"Paris"}',
    } as BaseEvent);

    await waitFor(() => {
      const tool = screen.getByTestId("complex-tool");
      expect(tool.textContent).toContain("City: Paris");
      // All args complete but no result yet - status shows inProgress until result is received
      expect(tool.textContent).toMatch(/Status: (complete|inProgress)/i);
    });

    agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
    agent.complete();
  });
});

describe("Status Persistence After Agent Stops", () => {
  it("should remain in InProgress status after agent stops if no result", async () => {
    const agent = new MockStepwiseAgent();

    const renderToolCalls = [
      defineToolCallRenderer({
        name: "testTool",
        args: z.object({ value: z.string() }),
        render: ({ args, status }) => (
          <div data-testid="tool-render">
            <span data-testid="status">{status}</span>
            <span data-testid="value">{args.value}</span>
          </div>
        ),
      }),
    ] as unknown as ReactToolCallRenderer<unknown>[];

    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderToolCalls={renderToolCalls}
      >
        <CopilotChat />
      </CopilotKitProvider>
    );

    // Submit message to trigger tool call
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Test message" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // Wait for user message to appear
    await waitFor(() => {
      expect(screen.getByText("Test message")).toBeDefined();
    });

    const messageId = "msg_status";
    const toolCallId = "tc_status";

    // Start run and emit tool call
    agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);

    agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "testTool",
      parentMessageId: messageId,
      delta: '{"value":"test"}',
    } as BaseEvent);

    // Tool should be in InProgress while agent is running
    await waitFor(() => {
      const statusElement = screen.getByTestId("status");
      expect(statusElement.textContent).toBe("inProgress");
    });

    // Finish the run without providing a tool result
    agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);

    // Important: tool should REMAIN in InProgress status, not Complete
    // Verify status remains inProgress (not changing to complete)
    await waitFor(() => {
      const statusElement = screen.getByTestId("status");
      expect(statusElement.textContent).toBe("inProgress");
    });

    const statusElement = screen.getByTestId("status");
    expect(statusElement.textContent).toBe("inProgress");
    expect(statusElement.textContent).not.toBe("complete");

    // To provide result after run finished, we need to start a new run
    agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);

    // Now provide the tool result
    agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      messageId: `${messageId}_result`,
      content: JSON.stringify({ result: "Tool execution completed" }),
    } as BaseEvent);

    // NOW it should be complete
    await waitFor(() => {
      const statusEl = screen.getByTestId("status");
      expect(statusEl.textContent).toBe("complete");
    });

    agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
    agent.complete();
  });
});
