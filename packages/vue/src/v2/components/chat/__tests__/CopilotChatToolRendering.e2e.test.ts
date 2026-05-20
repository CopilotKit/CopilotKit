import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/vue";
import { computed, defineComponent, nextTick } from "vue";
import type { PropType } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import { ToolCallStatus } from "@copilotkit/core";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable, Subject } from "rxjs";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChat from "../CopilotChat.vue";
import CopilotChatToolCallsView from "../CopilotChatToolCallsView.vue";
import { useFrontendTool } from "../../../hooks/use-frontend-tool";
import type { VueFrontendTool } from "../../../types";
import type { VueToolCallRendererRenderProps } from "../../../types/vue-tool-call-renderer";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

async function submitMessage(value: string) {
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, value);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
}

class MockStreamingAgent extends AbstractAgent {
  clone(): MockStreamingAgent {
    return new MockStreamingAgent();
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      const messageId = `m_${Date.now()}`;
      const toolCallId = `tc_${Date.now()}`;

      observer.next({ type: EventType.RUN_STARTED } as BaseEvent);
      observer.next({
        type: EventType.TEXT_MESSAGE_CHUNK,
        messageId,
        delta: "I will check the weather.",
      } as BaseEvent);
      observer.next({
        type: EventType.TOOL_CALL_CHUNK,
        toolCallId,
        toolCallName: "getWeather",
        parentMessageId: messageId,
        delta: '{"location":"Paris","unit":"c',
      } as BaseEvent);
      observer.next({
        type: EventType.TOOL_CALL_CHUNK,
        toolCallId,
        parentMessageId: messageId,
        delta: 'elsius"}',
      } as BaseEvent);
      observer.next({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId,
        messageId: `${messageId}_result`,
        content: JSON.stringify({ temperature: 21, unit: "celsius" }),
      } as BaseEvent);
      observer.next({ type: EventType.RUN_FINISHED } as BaseEvent);
      observer.complete();
    });
  }
}

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

const WeatherRenderer = defineComponent({
  props: {
    name: { type: String, required: true },
    args: { type: Object as PropType<Record<string, unknown>>, required: true },
    result: { type: null as unknown as PropType<unknown>, required: false },
  },
  setup(
    props: VueToolCallRendererRenderProps<{ location: string; unit: string }>,
  ) {
    const text = computed(
      () =>
        `Tool: ${props.name} | args: ${String(props.args.location ?? "")}-${String(props.args.unit ?? "")} | result: ${String(props.result ?? "")}`,
    );
    return { text };
  },
  template: `<div data-testid="weather-result">{{ text }}</div>`,
});

const StatusRenderer = defineComponent({
  props: {
    status: { type: String, required: true },
    args: { type: Object as PropType<Record<string, unknown>>, required: true },
    result: { type: null as unknown as PropType<unknown>, required: false },
  },
  setup(props: VueToolCallRendererRenderProps<{ city?: string }>) {
    const text = computed(() => {
      if (props.status === ToolCallStatus.InProgress) {
        return `INPROGRESS ${String(props.args.city ?? "")}`;
      }
      if (props.status === ToolCallStatus.Executing) {
        return `EXECUTING ${String(props.args.city ?? "")}`;
      }
      return `COMPLETE ${String(props.args.city ?? "")} ${String(props.result ?? "")}`;
    });
    return { text };
  },
  template: `<div data-testid="status">{{ text }}</div>`,
});

const ToolStatusRenderer = defineComponent({
  props: {
    name: { type: String, required: true },
    status: { type: String, required: true },
    args: { type: Object as PropType<Record<string, unknown>>, required: true },
    result: { type: null as unknown as PropType<unknown>, required: false },
  },
  setup(
    props: VueToolCallRendererRenderProps<{ location: string; unit: string }>,
  ) {
    const text = computed(() => {
      const label =
        props.status === ToolCallStatus.InProgress ? "INPROGRESS" : "COMPLETE";
      return `${props.name} ${label} ${String(props.args.location ?? "")} - ${String(props.args.unit ?? "")} ${String(props.result ?? "")}`;
    });
    return { text };
  },
  template: `<div data-testid="tool-status">{{ text }}</div>`,
});

const SlowToolStatusRenderer = defineComponent({
  props: {
    name: { type: String, required: true },
    status: { type: String, required: true },
    args: { type: Object as PropType<Record<string, unknown>>, required: true },
    result: { type: null as unknown as PropType<unknown>, required: false },
  },
  setup(props: VueToolCallRendererRenderProps<{ value: string }>) {
    const text = computed(
      () =>
        `Tool: ${props.name} | Status: ${props.status} | Value: ${String(props.args.value ?? "")} | Result: ${props.result ? "Complete" : "Pending"}`,
    );
    return { text };
  },
  template: `<div data-testid="slow-tool-status">{{ text }}</div>`,
});

const Tool1Renderer = defineComponent({
  props: {
    status: { type: String, required: true },
    args: { type: Object as PropType<Record<string, unknown>>, required: true },
    result: { type: null as unknown as PropType<unknown>, required: false },
  },
  setup(props: VueToolCallRendererRenderProps<{ id: string }>) {
    const testId = computed(() => `tool1-${String(props.args.id ?? "")}`);
    const text = computed(
      () =>
        `Tool1[${String(props.args.id ?? "")}]: ${props.status} - ${props.result ? JSON.stringify(props.result) : "waiting"}`,
    );
    return { testId, text };
  },
  template: `<div :data-testid="testId">{{ text }}</div>`,
});

const Tool2Renderer = defineComponent({
  props: {
    status: { type: String, required: true },
    args: { type: Object as PropType<Record<string, unknown>>, required: true },
    result: { type: null as unknown as PropType<unknown>, required: false },
  },
  setup(props: VueToolCallRendererRenderProps<{ id: string }>) {
    const testId = computed(() => `tool2-${String(props.args.id ?? "")}`);
    const text = computed(
      () =>
        `Tool2[${String(props.args.id ?? "")}]: ${props.status} - ${props.result ? JSON.stringify(props.result) : "waiting"}`,
    );
    return { testId, text };
  },
  template: `<div :data-testid="testId">{{ text }}</div>`,
});

const ComplexToolRenderer = defineComponent({
  props: {
    status: { type: String, required: true },
    args: { type: Object as PropType<Record<string, unknown>>, required: true },
  },
  setup(
    props: VueToolCallRendererRenderProps<{
      name?: string;
      age?: number;
      city?: string;
    }>,
  ) {
    const statusText = computed(() => `Status: ${props.status}`);
    const nameText = computed(
      () => `Name: ${String(props.args.name || "pending")}`,
    );
    const ageText = computed(() => {
      const age = props.args.age;
      return `Age: ${age !== undefined ? String(age) : "pending"}`;
    });
    const cityText = computed(
      () => `City: ${String(props.args.city || "pending")}`,
    );
    return { statusText, nameText, ageText, cityText };
  },
  template: `
    <div data-testid="complex-tool">
      <div>{{ statusText }}</div>
      <div>{{ nameText }}</div>
      <div>{{ ageText }}</div>
      <div>{{ cityText }}</div>
    </div>
  `,
});

const TestToolRenderer = defineComponent({
  props: {
    name: { type: String, required: true },
    status: { type: String, required: true },
    args: { type: Object as PropType<Record<string, unknown>>, required: true },
    result: { type: null as unknown as PropType<unknown>, required: false },
  },
  template: `
    <div data-testid="tool-render">
      <span data-testid="status">{{ status }}</span>
      <span data-testid="value">{{ args.value }}</span>
    </div>
  `,
});

function createAssistantMessage(
  toolCalls: Array<{ id: string; name: string; argsJson: string }>,
): AssistantMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    toolCalls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.name,
        arguments: toolCall.argsJson,
      },
    })),
  } as AssistantMessage;
}

function renderChatHarness(args: {
  agent: AbstractAgent;
  frontendTools?: VueFrontendTool[];
  registrar?: ReturnType<typeof defineComponent>;
}) {
  const { agent, frontendTools = [], registrar } = args;
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
        registrar,
      };
    },
    template: `
      <CopilotKitProvider
        runtimeUrl="/api/copilotkit"
        :agents__unsafe_dev_only="agents"
        :frontendTools="frontendTools"
      >
        <CopilotChatConfigurationProvider thread-id="test-thread" :agent-id="agentId">
          <component :is="registrar" v-if="registrar" />
          <div style="height: 400px;">
            <CopilotChat :welcome-screen="false" />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  return render(Host);
}

function renderToolCallsHarness(args: {
  message: AssistantMessage;
  messages: Message[];
  frontendTools: VueFrontendTool[];
}) {
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatToolCallsView,
    },
    setup() {
      return {
        message: args.message,
        messages: args.messages,
        frontendTools: args.frontendTools,
      };
    },
    template: `
      <CopilotKitProvider runtimeUrl="/api/copilotkit" :frontendTools="frontendTools">
        <CopilotChatConfigurationProvider threadId="test-thread" agentId="default">
          <CopilotChatToolCallsView :message="message" :messages="messages" />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  return render(Host);
}

describe("CopilotChat tool rendering with mock agent", () => {
  it("renders the tool component when the agent emits a tool call and result", async () => {
    renderChatHarness({
      agent: new MockStreamingAgent(),
      frontendTools: [
        {
          name: "getWeather",
          parameters: z.object({
            location: z.string(),
            unit: z.string(),
          }),
          render: WeatherRenderer,
        },
      ],
    });

    await submitMessage("What is the weather?");
    const tool = await screen.findByTestId("weather-result");
    await waitFor(() => {
      expect(tool.textContent).toMatch(/temperature/);
      expect(tool.textContent).toMatch(/celsius/);
    });
  });
});

describe("Tool render status narrowing", () => {
  function renderStatusWithProvider({
    withResult,
  }: {
    isRunning: boolean;
    withResult: boolean;
  }) {
    const assistantMessage = createAssistantMessage([
      { id: "tc_status_1", name: "getWeather", argsJson: '{"city":"Berlin"}' },
    ]);

    const messages: Message[] = [];
    if (withResult) {
      messages.push({
        id: "t1",
        role: "tool",
        toolCallId: "tc_status_1",
        content: "Sunny",
      } as ToolMessage as any);
    }

    renderToolCallsHarness({
      message: assistantMessage,
      messages,
      frontendTools: [
        {
          name: "getWeather",
          parameters: z.object({ city: z.string().optional() }),
          render: StatusRenderer,
        },
      ],
    });
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

describe("Streaming in-progress without timers", () => {
  it("shows InProgress for partial args and Complete after result", async () => {
    const agent = new MockStepwiseAgent();
    renderChatHarness({
      agent,
      frontendTools: [
        {
          name: "getWeather",
          parameters: z.object({
            location: z.string(),
            unit: z.string(),
          }),
          render: ToolStatusRenderer,
        },
      ],
    });

    await submitMessage("Weather please");
    await waitFor(() => {
      expect(screen.getByText("Weather please")).toBeDefined();
    });

    const messageId = "m_step";
    const toolCallId = "tc_step";

    await agent.emit({
      type: EventType.RUN_STARTED,
    } as BaseEvent);
    await agent.emit({
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId,
      delta: "Checking weather",
    } as BaseEvent);
    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "getWeather",
      parentMessageId: messageId,
      delta: '{"location":"Paris"',
    } as BaseEvent);

    await waitFor(() => {
      const el = screen.getByTestId("tool-status");
      expect(el.textContent).toContain("getWeather INPROGRESS");
      expect(el.textContent).toContain("Paris");
    });

    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      parentMessageId: messageId,
      delta: ',"unit":"celsius"}',
    } as BaseEvent);

    await waitFor(() => {
      const el = screen.getByTestId("tool-status");
      expect(el.textContent).toContain("getWeather");
      expect(el.textContent).toContain("Paris");
      expect(el.textContent).toContain("celsius");
      expect(el.textContent).toMatch(/INPROGRESS/);
    });

    await agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      messageId: `${messageId}_result`,
      content: JSON.stringify({ temperature: 21, unit: "celsius" }),
    } as BaseEvent);

    await waitFor(() => {
      const el = screen.getByTestId("tool-status");
      expect(el.textContent).toMatch(/COMPLETE/);
      expect(el.textContent).toContain("temperature");
      expect(el.textContent).toContain("21");
    });

    await agent.emit({
      type: EventType.RUN_FINISHED,
    } as BaseEvent);
    await agent.complete();
  });
});

describe("Executing State Transitions", () => {
  it("should show Executing status while tool handler is running", async () => {
    const agent = new MockStepwiseAgent();
    let resolveHandler: (() => void) | undefined;

    const ToolWithDeferredHandler = defineComponent({
      setup() {
        const tool: VueFrontendTool<{ value: string }> = {
          name: "slowTool",
          parameters: z.object({ value: z.string() }),
          handler: async () =>
            new Promise((resolve) => {
              resolveHandler = () => resolve({ result: "done" });
            }),
          render: SlowToolStatusRenderer,
        };

        useFrontendTool(tool);
        return {};
      },
      template: `<div />`,
    });

    renderChatHarness({
      agent,
      registrar: ToolWithDeferredHandler,
    });

    await submitMessage("Run slow tool");
    await waitFor(() => {
      expect(screen.getByText("Run slow tool")).toBeDefined();
    });

    const messageId = "m_exec";
    const toolCallId = "tc_exec";

    await agent.emit({
      type: EventType.RUN_STARTED,
    } as BaseEvent);
    await agent.emit({
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

    await agent.emit({
      type: EventType.RUN_FINISHED,
    } as BaseEvent);
    await agent.complete();

    await waitFor(() => {
      const status = screen.getByTestId("slow-tool-status");
      expect(status.textContent).toMatch(/Status: executing/i);
      expect(resolveHandler).toBeTruthy();
    });

    resolveHandler?.();

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
    renderChatHarness({
      agent,
      frontendTools: [
        {
          name: "tool1",
          parameters: z.object({ id: z.string() }),
          render: Tool1Renderer,
        },
        {
          name: "tool2",
          parameters: z.object({ id: z.string() }),
          render: Tool2Renderer,
        },
      ],
    });

    await submitMessage("Multiple tools");
    await waitFor(() => {
      expect(screen.getByText("Multiple tools")).toBeDefined();
    });

    const messageId = "m_multi";
    const toolCallId1 = "tc_1";
    const toolCallId2 = "tc_2";
    const toolCallId3 = "tc_3";

    await agent.emit({
      type: EventType.RUN_STARTED,
    } as BaseEvent);
    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId: toolCallId1,
      toolCallName: "tool1",
      parentMessageId: messageId,
      delta: '{"id":"first"}',
    } as BaseEvent);
    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId: toolCallId2,
      toolCallName: "tool2",
      parentMessageId: messageId,
      delta: '{"id":"second"}',
    } as BaseEvent);
    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId: toolCallId3,
      toolCallName: "tool1",
      parentMessageId: messageId,
      delta: '{"id":"third"}',
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("tool1-first")).toBeDefined();
      expect(screen.getByTestId("tool2-second")).toBeDefined();
      expect(screen.getByTestId("tool1-third")).toBeDefined();
    });

    await agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: toolCallId2,
      messageId: `${messageId}_r2`,
      content: JSON.stringify({ result: "B" }),
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("tool2-second").textContent).toContain("B");
    });

    await agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: toolCallId1,
      messageId: `${messageId}_r1`,
      content: JSON.stringify({ result: "A" }),
    } as BaseEvent);
    await agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: toolCallId3,
      messageId: `${messageId}_r3`,
      content: JSON.stringify({ result: "C" }),
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("tool1-first").textContent).toContain("A");
      expect(screen.getByTestId("tool2-second").textContent).toContain("B");
      expect(screen.getByTestId("tool1-third").textContent).toContain("C");
    });

    await agent.emit({
      type: EventType.RUN_FINISHED,
    } as BaseEvent);
    await agent.complete();
  });
});

describe("Partial Args Accumulation", () => {
  it("should properly show InProgress status with accumulating partial args", async () => {
    const agent = new MockStepwiseAgent();
    renderChatHarness({
      agent,
      frontendTools: [
        {
          name: "complexTool",
          parameters: z.object({
            name: z.string().optional(),
            age: z.number().optional(),
            city: z.string().optional(),
          }),
          render: ComplexToolRenderer,
        },
      ],
    });

    await submitMessage("Complex tool test");
    await waitFor(() => {
      expect(screen.getByText("Complex tool test")).toBeDefined();
    });

    const messageId = "m_partial";
    const toolCallId = "tc_partial";

    await agent.emit({
      type: EventType.RUN_STARTED,
    } as BaseEvent);
    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "complexTool",
      parentMessageId: messageId,
      delta: '{"name":"',
    } as BaseEvent);

    await waitFor(() => {
      expect(screen.getByTestId("complex-tool")).toBeDefined();
    });

    await agent.emit({
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

    await agent.emit({
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

    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      parentMessageId: messageId,
      delta: ',"city":"Paris"}',
    } as BaseEvent);

    await waitFor(() => {
      const tool = screen.getByTestId("complex-tool");
      expect(tool.textContent).toContain("City: Paris");
      expect(tool.textContent).toMatch(/Status: (complete|inProgress)/i);
    });

    await agent.emit({
      type: EventType.RUN_FINISHED,
    } as BaseEvent);
    await agent.complete();
  });
});

describe("toolCallId parity for registered renderers", () => {
  const ToolCallIdStatusRenderer = defineComponent({
    props: {
      name: { type: String, required: true },
      toolCallId: { type: String, required: true },
      status: { type: String, required: true },
      args: {
        type: Object as PropType<Record<string, unknown>>,
        required: true,
      },
      result: { type: null as unknown as PropType<unknown>, required: false },
    },
    setup(props: VueToolCallRendererRenderProps<{ value: string }>) {
      const text = computed(
        () =>
          `id:${props.toolCallId}|status:${props.status}|result:${props.result ? "Complete" : "Pending"}`,
      );
      return { text };
    },
    template: `<div data-testid="tool-call-id-status">{{ text }}</div>`,
  });

  const WildcardToolCallIdRenderer = defineComponent({
    props: {
      name: { type: String, required: true },
      toolCallId: { type: String, required: true },
      status: { type: String, required: true },
      args: {
        type: Object as PropType<Record<string, unknown>>,
        required: true,
      },
      result: { type: null as unknown as PropType<unknown>, required: false },
    },
    setup(props: VueToolCallRendererRenderProps<unknown>) {
      const text = computed(
        () => `wildcard|id:${props.toolCallId}|name:${props.name}`,
      );
      return { text };
    },
    template: `<div data-testid="wildcard-tool-call-id">{{ text }}</div>`,
  });

  it("forwards the same toolCallId in inProgress, executing, and complete", async () => {
    const agent = new MockStepwiseAgent();
    let resolveHandler: (() => void) | undefined;

    const ToolWithDeferredHandler = defineComponent({
      setup() {
        const tool: VueFrontendTool<{ value: string }> = {
          name: "idTrackedTool",
          parameters: z.object({ value: z.string() }),
          handler: async () =>
            new Promise((resolve) => {
              resolveHandler = () => resolve({ result: "done" });
            }),
          render: ToolCallIdStatusRenderer,
        };

        useFrontendTool(tool);
        return {};
      },
      template: `<div />`,
    });

    renderChatHarness({
      agent,
      registrar: ToolWithDeferredHandler,
    });

    await submitMessage("Track tool id");
    await waitFor(() => {
      expect(screen.getByText("Track tool id")).toBeDefined();
    });

    const messageId = "m_id";
    const toolCallId = "tc_id_parity";

    await agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);
    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "idTrackedTool",
      parentMessageId: messageId,
      delta: '{"value":"go"}',
    } as BaseEvent);

    await waitFor(() => {
      const el = screen.getByTestId("tool-call-id-status");
      expect(el.textContent).toMatch(/status:inProgress/);
      expect(el.textContent).toContain(`id:${toolCallId}`);
    });

    await agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
    await agent.complete();

    await waitFor(() => {
      const el = screen.getByTestId("tool-call-id-status");
      expect(el.textContent).toMatch(/status:executing/);
      expect(el.textContent).toContain(`id:${toolCallId}`);
      expect(resolveHandler).toBeTruthy();
    });

    resolveHandler?.();

    await waitFor(() => {
      const el = screen.getByTestId("tool-call-id-status");
      expect(el.textContent).toMatch(/status:complete/);
      expect(el.textContent).toContain(`id:${toolCallId}`);
      expect(el.textContent).toMatch(/result:Complete/);
    });
  });

  it("passes toolCallId to the wildcard fallback renderer", async () => {
    const toolCallId = "tc_parity_id_wildcard";
    const assistantMessage = createAssistantMessage([
      { id: toolCallId, name: "unknownTool", argsJson: "{}" },
    ]);

    renderToolCallsHarness({
      message: assistantMessage,
      messages: [],
      frontendTools: [
        {
          name: "*",
          render: WildcardToolCallIdRenderer,
        } as unknown as VueFrontendTool,
      ],
    });

    await waitFor(() => {
      const el = screen.getByTestId("wildcard-tool-call-id");
      expect(el.textContent).toContain(`id:${toolCallId}`);
      expect(el.textContent).toContain("name:unknownTool");
    });
  });
});

describe("Status Persistence After Agent Stops", () => {
  it("should remain in InProgress status after agent stops if no result", async () => {
    const agent = new MockStepwiseAgent();
    renderChatHarness({
      agent,
      frontendTools: [
        {
          name: "testTool",
          parameters: z.object({ value: z.string() }),
          render: TestToolRenderer,
        },
      ],
    });

    await submitMessage("Test message");
    await waitFor(() => {
      expect(screen.getByText("Test message")).toBeDefined();
    });

    const messageId = "msg_status";
    const toolCallId = "tc_status";

    await agent.emit({
      type: EventType.RUN_STARTED,
    } as BaseEvent);
    await agent.emit({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: "testTool",
      parentMessageId: messageId,
      delta: '{"value":"test"}',
    } as BaseEvent);

    await waitFor(() => {
      const statusElement = screen.getByTestId("status");
      expect(statusElement.textContent).toBe("inProgress");
    });

    await agent.emit({
      type: EventType.RUN_FINISHED,
    } as BaseEvent);

    await waitFor(() => {
      const statusElement = screen.getByTestId("status");
      expect(statusElement.textContent).toBe("inProgress");
    });

    const statusElement = screen.getByTestId("status");
    expect(statusElement.textContent).toBe("inProgress");
    expect(statusElement.textContent).not.toBe("complete");

    await agent.emit({
      type: EventType.RUN_STARTED,
    } as BaseEvent);
    await agent.emit({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      messageId: `${messageId}_result`,
      content: JSON.stringify({ result: "Tool execution completed" }),
    } as BaseEvent);

    await waitFor(() => {
      const statusEl = screen.getByTestId("status");
      expect(statusEl.textContent).toBe("complete");
    });

    await agent.emit({
      type: EventType.RUN_FINISHED,
    } as BaseEvent);
    await agent.complete();
  });
});
