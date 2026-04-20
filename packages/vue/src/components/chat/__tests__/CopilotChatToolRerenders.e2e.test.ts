import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/vue";
import { defineComponent, nextTick, onMounted, onUpdated } from "vue";
import type { PropType } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkit/core";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable, Subject } from "rxjs";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChat from "../CopilotChat.vue";
import type { VueFrontendTool } from "../../../types";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

class MockStepwiseAgent extends AbstractAgent {
  private readonly subject = new Subject<BaseEvent>();
  private bufferedEvents: BaseEvent[] = [];
  private bufferedComplete = false;

  async emit(event: BaseEvent): Promise<void> {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    if (this.subject.observers.length === 0) {
      this.bufferedEvents.push(event);
    } else {
      this.subject.next(event);
    }
    await flushVueUpdates();
  }

  async complete(): Promise<void> {
    this.isRunning = false;
    if (this.subject.observers.length === 0) {
      this.bufferedComplete = true;
    } else {
      this.subject.complete();
    }
    await flushVueUpdates();
  }

  clone(): MockStepwiseAgent {
    return Object.assign(new MockStepwiseAgent(), this);
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      if (this.bufferedEvents.length > 0) {
        for (const event of this.bufferedEvents) {
          observer.next(event);
        }
        this.bufferedEvents = [];
      }

      if (this.bufferedComplete) {
        this.bufferedComplete = false;
        observer.complete();
        return;
      }

      const subscription = this.subject.subscribe(observer);
      return () => subscription.unsubscribe();
    });
  }
}

async function flushVueUpdates(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function renderChatHarness(args: {
  agent: AbstractAgent;
  frontendTools: VueFrontendTool[];
}) {
  const { agent, frontendTools } = args;
  agent.agentId = "default";

  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChat,
    },
    setup() {
      return {
        agentId: "default",
        agents: { default: agent },
        frontendTools,
      };
    },
    template: `
      <CopilotKitProvider
        runtimeUrl="/api/copilotkit"
        :agents__unsafe_dev_only="agents"
        :frontendTools="frontendTools"
      >
        <CopilotChatConfigurationProvider thread-id="test-thread" :agent-id="agentId">
          <div style="height: 400px;">
            <CopilotChat :welcome-screen="false" />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  return render(Host);
}

async function submitMessage(value: string) {
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, value);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
}

async function submitMessageAndWaitForUserMessage(value: string) {
  await submitMessage(value);
  await waitFor(() => {
    expect(screen.getByText(value)).toBeDefined();
  });
}

describe("Tool Call Re-render Prevention", () => {
  it("should not re-render a completed tool call when subsequent text is streamed", async () => {
    const agent = new MockStepwiseAgent();
    let toolRenderCount = 0;

    const WeatherRenderer = defineComponent({
      props: {
        status: { type: String, required: true },
        args: {
          type: Object as PropType<Record<string, unknown>>,
          required: true,
        },
        result: { type: null as unknown as PropType<unknown>, required: false },
      },
      setup() {
        const trackRender = () => {
          toolRenderCount++;
        };
        onMounted(trackRender);
        onUpdated(trackRender);
        return {};
      },
      template: `
        <div data-testid="weather-tool">
          <span data-testid="status">{{ status }}</span>
          <span data-testid="location">{{ String(args.location ?? "") }}</span>
          <span data-testid="result">{{ String(result ?? "pending") }}</span>
        </div>
      `,
    });

    renderChatHarness({
      agent,
      frontendTools: [
        {
          name: "getWeather",
          parameters: z.object({ location: z.string() }),
          render: WeatherRenderer,
        },
      ],
    });

    await submitMessageAndWaitForUserMessage("What's the weather?");

    const messageId = "m_rerender_test";
    const toolCallId = "tc_rerender_test";

    await agent.emit({
      type: EventType.RUN_STARTED,
    } as BaseEvent);
    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "getWeather",
      parentMessageId: messageId,
      delta: '{"location":"Paris"}',
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("inProgress");
      expect(screen.getByTestId("location").textContent).toBe("Paris");
    });

    const renderCountAfterToolCall = toolRenderCount;

    await agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      messageId: `${messageId}_result`,
      content: JSON.stringify({ temperature: 22, condition: "sunny" }),
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("complete");
    });

    const renderCountAfterComplete = toolRenderCount;
    expect(renderCountAfterComplete).toBeGreaterThan(renderCountAfterToolCall);

    await agent.emit({
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: "m_followup",
      delta: "The weather in Paris is ",
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByText(/The weather in Paris is/)).toBeDefined();
    });

    await agent.emit({
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: "m_followup",
      delta: "currently sunny ",
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByText(/currently sunny/)).toBeDefined();
    });

    await agent.emit({
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: "m_followup",
      delta: "with a temperature of 22°C.",
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByText(/22°C/)).toBeDefined();
    });

    const renderCountAfterAllText = toolRenderCount;
    expect(renderCountAfterAllText).toBe(renderCountAfterComplete);

    expect(screen.getByTestId("status").textContent).toBe("complete");
    expect(screen.getByTestId("location").textContent).toBe("Paris");
    expect(screen.getByTestId("result").textContent).toContain("temperature");

    await agent.emit({
      type: EventType.RUN_FINISHED,
    } as BaseEvent);
    await agent.complete();
  });

  it("should not re-render a tool call when its arguments have not changed during streaming", async () => {
    const agent = new MockStepwiseAgent();
    let toolRenderCount = 0;

    const SearchRenderer = defineComponent({
      props: {
        status: { type: String, required: true },
        args: {
          type: Object as PropType<Record<string, unknown>>,
          required: true,
        },
      },
      setup() {
        const trackRender = () => {
          toolRenderCount++;
        };
        onMounted(trackRender);
        onUpdated(trackRender);
        return {};
      },
      template: `
        <div data-testid="search-tool">
          <span data-testid="search-status">{{ status }}</span>
          <span data-testid="search-query">{{ String(args.query ?? "") }}</span>
        </div>
      `,
    });

    renderChatHarness({
      agent,
      frontendTools: [
        {
          name: "search",
          parameters: z.object({ query: z.string() }),
          render: SearchRenderer,
        },
      ],
    });

    await submitMessageAndWaitForUserMessage("Search for something");

    const messageId = "m_search";
    const toolCallId = "tc_search";

    await agent.emit({
      type: EventType.RUN_STARTED,
    } as BaseEvent);
    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "search",
      parentMessageId: messageId,
      delta: '{"query":"React hooks"}',
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("search-query").textContent).toBe(
        "React hooks",
      );
    });

    const renderCountAfterToolCall = toolRenderCount;

    await agent.emit({
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId,
      delta: "Let me search for that...",
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByText(/Let me search for that/)).toBeDefined();
    });

    const renderCountAfterText = toolRenderCount;
    expect(renderCountAfterText).toBe(renderCountAfterToolCall);

    await agent.emit({
      type: EventType.RUN_FINISHED,
    } as BaseEvent);
    await agent.complete();
  });

  it("should re-render a tool call when its arguments change during streaming", async () => {
    const agent = new MockStepwiseAgent();
    let toolRenderCount = 0;
    const capturedArgs: string[] = [];

    const SearchRenderer = defineComponent({
      props: {
        args: {
          type: Object as PropType<Record<string, unknown>>,
          required: true,
        },
      },
      setup(props) {
        const trackRender = () => {
          toolRenderCount++;
          capturedArgs.push(String(props.args.query ?? ""));
        };
        onMounted(trackRender);
        onUpdated(trackRender);
        return {};
      },
      template: `
        <div data-testid="search-tool">
          <span data-testid="search-query">{{ String(args.query ?? "") }}</span>
        </div>
      `,
    });

    renderChatHarness({
      agent,
      frontendTools: [
        {
          name: "search",
          parameters: z.object({ query: z.string() }),
          render: SearchRenderer,
        },
      ],
    });

    await submitMessageAndWaitForUserMessage("Search for something");

    const messageId = "m_search_update";
    const toolCallId = "tc_search_update";

    await agent.emit({
      type: EventType.RUN_STARTED,
    } as BaseEvent);
    await agent.emit({
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

    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "search",
      parentMessageId: messageId,
      delta: 'ct hooks"}',
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("search-query").textContent).toBe(
        "React hooks",
      );
    });

    const renderCountAfterSecondChunk = toolRenderCount;
    expect(renderCountAfterSecondChunk).toBeGreaterThan(
      renderCountAfterFirstChunk,
    );
    expect(capturedArgs).toContain("Rea");
    expect(capturedArgs).toContain("React hooks");

    await agent.emit({
      type: EventType.RUN_FINISHED,
    } as BaseEvent);
    await agent.complete();
  });

  it("should re-render a tool call when status changes to complete", async () => {
    const agent = new MockStepwiseAgent();
    let toolRenderCount = 0;
    const capturedStatuses: string[] = [];

    const DataRenderer = defineComponent({
      props: {
        status: { type: String, required: true },
        result: { type: null as unknown as PropType<unknown>, required: false },
      },
      setup(props) {
        const trackRender = () => {
          toolRenderCount++;
          capturedStatuses.push(String(props.status));
        };
        onMounted(trackRender);
        onUpdated(trackRender);
        return {};
      },
      template: `
        <div data-testid="data-tool">
          <span data-testid="data-status">{{ status }}</span>
          <span data-testid="data-result">{{ String(result ?? "none") }}</span>
        </div>
      `,
    });

    renderChatHarness({
      agent,
      frontendTools: [
        {
          name: "getData",
          parameters: z.object({ id: z.string() }),
          render: DataRenderer,
        },
      ],
    });

    await submitMessageAndWaitForUserMessage("Get data");

    const messageId = "m_data";
    const toolCallId = "tc_data";

    await agent.emit({
      type: EventType.RUN_STARTED,
    } as BaseEvent);
    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "getData",
      parentMessageId: messageId,
      delta: '{"id":"123"}',
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("data-status").textContent).toBe(
        ToolCallStatus.InProgress,
      );
    });

    const renderCountBeforeResult = toolRenderCount;

    await agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      messageId: `${messageId}_result`,
      content: JSON.stringify({ data: "found" }),
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("data-status").textContent).toBe(
        ToolCallStatus.Complete,
      );
    });

    const renderCountAfterResult = toolRenderCount;
    expect(renderCountAfterResult).toBeGreaterThan(renderCountBeforeResult);
    expect(capturedStatuses).toContain(ToolCallStatus.InProgress);
    expect(capturedStatuses).toContain(ToolCallStatus.Complete);

    await agent.emit({
      type: EventType.RUN_FINISHED,
    } as BaseEvent);
    await agent.complete();
  });
});
