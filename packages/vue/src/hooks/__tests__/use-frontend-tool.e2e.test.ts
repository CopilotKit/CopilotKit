import { computed, defineComponent, onMounted, ref, watch } from "vue";
import type { PropType } from "vue";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AssistantMessage, Message } from "@ag-ui/core";
import { ToolCallStatus } from "@copilotkit/core";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  AgentSubscriber,
  BaseEvent,
  RunAgentInput,
  RunAgentParameters,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { useFrontendTool } from "../use-frontend-tool";
import type { VueFrontendTool } from "../../types";
import CopilotChat from "../../components/chat/CopilotChat.vue";
import CopilotChatToolCallsView from "../../components/chat/CopilotChatToolCallsView.vue";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  toolCallChunkEvent,
  toolCallResultEvent,
  textChunkEvent,
  testId,
} from "../../__tests__/utils/test-helpers";

afterEach(() => {
  cleanup();
});

function createChatHost(registrars: Record<string, unknown>, template: string) {
  return defineComponent({
    components: {
      CopilotChat,
      ...registrars,
    },
    template,
  });
}

async function submitMessage(value: string) {
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, value);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
}

describe("useFrontendTool E2E - Dynamic Registration", () => {
  describe("Minimal dynamic registration without chat run", () => {
    it("registers tool and renders tool call via ToolCallsView", async () => {
      const DynamicToolRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
        },
        template: `<div data-testid="dynamic-tool-render">{{ name }}: {{ args.message }}</div>`,
      });

      const DynamicToolComponent = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ message: string }> = {
            name: "dynamicTool",
            parameters: z.object({ message: z.string() }),
            render: DynamicToolRenderer,
          };
          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

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

      const ToolCallsHost = defineComponent({
        components: {
          DynamicToolComponent,
          CopilotChatToolCallsView,
        },
        setup() {
          return {
            assistantMessage,
            messages,
          };
        },
        template: `
          <div>
            <DynamicToolComponent />
            <CopilotChatToolCallsView :message="assistantMessage" :messages="messages" />
          </div>
        `,
      });

      const ui = renderWithCopilotKit({
        children: ToolCallsHost,
      });

      await waitFor(() => {
        const el = screen.getByTestId("dynamic-tool-render");
        expect(el).toBeDefined();
        expect(el.textContent).toContain("dynamicTool");
        expect(el.textContent).toContain("hello");
      });

      ui.unmount();
    });
  });

  describe("Register at runtime", () => {
    it("should register tool dynamically after provider is mounted", async () => {
      const agent = new MockStepwiseAgent();

      const DynamicToolRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
          result: { type: null as unknown as PropType<any>, required: false },
        },
        setup(props) {
          const resultText = computed(() =>
            props.result ? JSON.stringify(props.result) : "pending",
          );
          return { resultText };
        },
        template: `<div data-testid="dynamic-tool-render">{{ name }}: {{ args.message }} | Result: {{ resultText }}</div>`,
      });

      const ToolUser = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ message: string }> = {
            name: "dynamicTool",
            parameters: z.object({ message: z.string() }),
            render: DynamicToolRenderer,
            handler: async (args) => ({
              processed: args.message.toUpperCase(),
            }),
          };

          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const DynamicToolComponent = defineComponent({
        components: { ToolUser },
        setup() {
          const isRegistered = ref(false);
          onMounted(() => {
            isRegistered.value = true;
          });
          return { isRegistered };
        },
        template: `
          <div>
            <div data-testid="dynamic-status">{{ isRegistered ? "Registered" : "Not registered" }}</div>
            <ToolUser v-if="isRegistered" />
          </div>
        `,
      });

      const Host = createChatHost(
        { DynamicToolComponent },
        `
          <div>
            <DynamicToolComponent />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await waitFor(() => {
        expect(screen.getByTestId("dynamic-status").textContent).toBe(
          "Registered",
        );
      });

      await submitMessage("Use dynamic tool");

      await waitFor(() => {
        expect(screen.getByText("Use dynamic tool")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "dynamicTool",
          parentMessageId: messageId,
          delta: '{"message":"hello world"}',
        }),
      );

      await waitFor(() => {
        const toolRender = screen.getByTestId("dynamic-tool-render");
        expect(toolRender).toBeDefined();
        expect(toolRender.textContent).toContain("hello world");
      });

      await agent.emit(
        toolCallResultEvent({
          toolCallId,
          messageId: `${messageId}_result`,
          content: JSON.stringify({ processed: "HELLO WORLD" }),
        }),
      );

      await waitFor(() => {
        const toolRender = screen.getByTestId("dynamic-tool-render");
        expect(toolRender.textContent).toContain("HELLO WORLD");
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });

  describe("Streaming tool calls with incomplete JSON", () => {
    it("renders tool calls progressively as incomplete JSON chunks arrive", async () => {
      const agent = new MockStepwiseAgent();

      const StreamingToolRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
        },
        setup(props) {
          const nameText = computed(() => props.args.name || "undefined");
          const itemsText = computed(() =>
            Array.isArray(props.args.items)
              ? props.args.items.join(", ")
              : "undefined",
          );
          const countText = computed(() =>
            props.args.count !== undefined
              ? String(props.args.count)
              : "undefined",
          );
          return { nameText, itemsText, countText };
        },
        template: `
          <div data-testid="streaming-tool-render">
            <div data-testid="tool-name">{{ nameText }}</div>
            <div data-testid="tool-items">{{ itemsText }}</div>
            <div data-testid="tool-count">{{ countText }}</div>
          </div>
        `,
      });

      const StreamingTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{
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
            render: StreamingToolRenderer,
          };

          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { StreamingTool },
        `
          <div>
            <StreamingTool />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Test streaming");

      await waitFor(() => {
        expect(screen.getByText("Test streaming")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());

      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "streamingTool",
          parentMessageId: messageId,
          delta: '{"na',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("streaming-tool-render")).toBeDefined();
      });

      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          parentMessageId: messageId,
          delta: 'me":"Test Tool"',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("tool-name").textContent).toBe("Test Tool");
      });

      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          parentMessageId: messageId,
          delta: ',"items":["item1"',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("tool-items").textContent).toContain("item1");
      });

      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          parentMessageId: messageId,
          delta: ',"item2","item3"],"cou',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("tool-items").textContent).toBe(
          "item1, item2, item3",
        );
      });

      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          parentMessageId: messageId,
          delta: 'nt":42}',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("tool-count").textContent).toBe("42");
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });

  describe("Tool followUp property behavior", () => {
    it("stops agent execution when followUp is false", async () => {
      const agent = new MockStepwiseAgent();

      const NoFollowUpRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
          status: { type: String, required: true },
        },
        template: `
          <div data-testid="no-followup-tool">
            <div data-testid="tool-action">{{ args.action || "no action" }}</div>
            <div data-testid="tool-status">{{ status }}</div>
          </div>
        `,
      });

      const NoFollowUpTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ action: string }> = {
            name: "noFollowUpTool",
            parameters: z.object({ action: z.string() }),
            followUp: false,
            render: NoFollowUpRenderer,
          };

          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { NoFollowUpTool },
        `
          <div>
            <NoFollowUpTool />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Execute no followup");

      await waitFor(() => {
        expect(screen.getByText("Execute no followup")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "noFollowUpTool",
          parentMessageId: messageId,
          delta: '{"action":"stop-after-this"}',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("no-followup-tool")).toBeDefined();
        expect(screen.getByTestId("tool-action").textContent).toBe(
          "stop-after-this",
        );
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();

      const messages = screen.queryAllByRole("article");
      expect(messages.length).toBeLessThanOrEqual(2);
    });

    it("continues agent execution when followUp is true or undefined", async () => {
      const agent = new MockStepwiseAgent();

      const ContinueRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
        },
        template: `
          <div data-testid="continue-followup-tool">
            <div data-testid="tool-action">{{ args.action || "no action" }}</div>
          </div>
        `,
      });

      const ContinueFollowUpTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ action: string }> = {
            name: "continueFollowUpTool",
            parameters: z.object({ action: z.string() }),
            render: ContinueRenderer,
          };

          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { ContinueFollowUpTool },
        `
          <div>
            <ContinueFollowUpTool />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Execute with followup");

      await waitFor(() => {
        expect(screen.getByText("Execute with followup")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");
      const followUpMessageId = testId("followup");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "continueFollowUpTool",
          parentMessageId: messageId,
          delta: '{"action":"continue-after-this"}',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("continue-followup-tool")).toBeDefined();
        expect(screen.getByTestId("tool-action").textContent).toBe(
          "continue-after-this",
        );
      });

      await agent.emit(
        textChunkEvent(
          followUpMessageId,
          "This is a follow-up message after tool execution",
        ),
      );

      await waitFor(() => {
        expect(
          screen.getByText("This is a follow-up message after tool execution"),
        ).toBeDefined();
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });

  describe("Agent input plumbing", () => {
    it("forwards registered frontend tools to runAgent input", async () => {
      class InstrumentedMockAgent extends MockStepwiseAgent {
        private _capture: { lastRunParameters?: RunAgentParameters } = {};

        get lastRunParameters(): RunAgentParameters | undefined {
          return this._capture.lastRunParameters;
        }

        override clone(): this {
          const cloned = super.clone();
          (cloned as unknown as InstrumentedMockAgent)._capture = this._capture;
          return cloned;
        }

        async runAgent(
          parameters?: RunAgentParameters,
          subscriber?: AgentSubscriber,
        ) {
          this._capture.lastRunParameters = parameters;
          return super.runAgent(parameters, subscriber);
        }
      }

      const agent = new InstrumentedMockAgent();

      const ToolRegistrar = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ query: string }> = {
            name: "inspectionTool",
            parameters: z.object({ query: z.string() }),
            handler: async ({ query }) => `handled ${query}`,
          };
          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { ToolRegistrar },
        `
          <div>
            <ToolRegistrar />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Trigger inspection");

      await waitFor(() => {
        expect(agent.lastRunParameters).toBeDefined();
      });

      const messageId = testId("msg");
      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallResultEvent({
          toolCallId: testId("tc"),
          messageId: `${messageId}_result`,
          content: JSON.stringify({}),
        }),
      );
      await agent.emit(runFinishedEvent());
      await agent.complete();

      expect(agent.lastRunParameters?.tools).toBeDefined();
    });
  });

  describe("Unmount disables handler, render persists", () => {
    it("Tool is properly removed from copilotkit.tools after component unmounts", async () => {
      class OneShotToolCallAgent extends AbstractAgent {
        private runCount = 0;

        clone(): OneShotToolCallAgent {
          const cloned = new OneShotToolCallAgent();
          cloned.agentId = this.agentId;
          Object.defineProperty(cloned, "runCount", {
            get: () => this.runCount,
            set: (v: number) => {
              this.runCount = v;
            },
          });
          return cloned;
        }

        run(_input: RunAgentInput): Observable<BaseEvent> {
          return new Observable<BaseEvent>((observer) => {
            this.runCount += 1;
            const messageId = testId(`m-${this.runCount}`);
            const toolCallId = testId(`tc-${this.runCount}`);
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

      const TemporaryToolRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
          result: { type: null as unknown as PropType<any>, required: false },
          status: { type: String, required: true },
        },
        template: `<div data-testid="temporary-tool">{{ name }}: {{ args.value }} | Status: {{ status }} | Result: {{ String(result ?? "") }}</div>`,
      });

      const ToggleableToolComponent = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ value: string }> = {
            name: "temporaryTool",
            parameters: z.object({ value: z.string() }),
            followUp: false,
            handler: async ({ value }) => {
              handlerCalls += 1;
              return `HANDLED ${value.toUpperCase()}`;
            },
            render: TemporaryToolRenderer,
          };
          useFrontendTool(tool);
          return {};
        },
        template: `<div data-testid="tool-mounted">Tool is mounted</div>`,
      });

      const TestWrapper = defineComponent({
        components: { ToggleableToolComponent, CopilotChat },
        setup() {
          const showTool = ref(true);
          const toggleTool = () => {
            showTool.value = !showTool.value;
          };
          return { showTool, toggleTool };
        },
        template: `
          <div>
            <button @click="toggleTool" data-testid="toggle-button">Toggle Tool</button>
            <ToggleableToolComponent v-if="showTool" />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      });

      renderWithCopilotKit({ agent, children: TestWrapper });

      expect(screen.getByTestId("tool-mounted")).toBeDefined();

      await submitMessage("Trigger 1");

      await waitFor(() => {
        const toolRender = screen.getByTestId("temporary-tool");
        expect(toolRender.textContent).toContain("first call");
        expect(toolRender.textContent).toContain("HANDLED FIRST CALL");
        expect(handlerCalls).toBe(1);
      });

      fireEvent.click(screen.getByTestId("toggle-button"));
      await waitFor(() => {
        expect(screen.queryByTestId("tool-mounted")).toBeNull();
      });

      await submitMessage("Trigger 2");

      await waitFor(() => {
        const toolRender = screen.getAllByTestId("temporary-tool");
        const last = toolRender[toolRender.length - 1];
        expect(last?.textContent).toContain("second call");
        expect(handlerCalls).toBe(1);
      });
    });
  });

  describe("Override behavior", () => {
    it("should use latest registration when same tool name is registered multiple times", async () => {
      const agent = new MockStepwiseAgent();

      const FirstRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
        },
        template: `<div data-testid="first-version">First Version: {{ args.text }} ({{ name }})</div>`,
      });

      const SecondRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
        },
        template: `<div data-testid="second-version">Second Version (Override): {{ args.text }} ({{ name }})</div>`,
      });

      const FirstToolComponent = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ text: string }> = {
            name: "overridableTool",
            parameters: z.object({ text: z.string() }),
            render: FirstRenderer,
          };

          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const SecondToolComponent = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ text: string }> = {
            name: "overridableTool",
            parameters: z.object({ text: z.string() }),
            render: SecondRenderer,
          };

          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const TestWrapper = defineComponent({
        components: {
          FirstToolComponent,
          SecondToolComponent,
          CopilotChat,
        },
        setup() {
          const showSecond = ref(false);
          const activateOverride = () => {
            showSecond.value = true;
          };
          return { showSecond, activateOverride };
        },
        template: `
          <div>
            <FirstToolComponent />
            <SecondToolComponent v-if="showSecond" />
            <button @click="activateOverride" data-testid="activate-override">
              Activate Override
            </button>
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      });

      renderWithCopilotKit({ agent, children: TestWrapper });

      await submitMessage("Test original");

      await waitFor(() => {
        expect(screen.getByText("Test original")).toBeDefined();
      });

      const messageId1 = testId("msg1");
      const toolCallId1 = testId("tc1");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId1,
          toolCallName: "overridableTool",
          parentMessageId: messageId1,
          delta: '{"text":"before override"}',
        }),
      );

      await waitFor(() => {
        const firstVersion = screen.getByTestId("first-version");
        expect(firstVersion.textContent).toContain("before override");
      });

      await agent.emit(runFinishedEvent());

      const overrideButton = screen.getByTestId("activate-override");
      fireEvent.click(overrideButton);

      await submitMessage("Test override");

      await waitFor(() => {
        expect(screen.getByText("Test override")).toBeDefined();
      });

      const messageId2 = testId("msg2");
      const toolCallId2 = testId("tc2");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId2,
          toolCallName: "overridableTool",
          parentMessageId: messageId2,
          delta: '{"text":"after override"}',
        }),
      );

      await waitFor(() => {
        const secondVersions = screen.getAllByTestId("second-version");
        const afterOverride = secondVersions.find((el) =>
          el.textContent?.includes("after override"),
        );
        expect(afterOverride).toBeDefined();
        expect(afterOverride?.textContent).toContain("after override");
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });

  describe("Integration with Chat UI", () => {
    it("should render tool output correctly in chat interface", async () => {
      const agent = new MockStepwiseAgent();

      const IntegratedRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
          result: { type: null as unknown as PropType<any>, required: false },
          status: { type: String, required: true },
        },
        setup(props) {
          const resultText = computed(() => JSON.stringify(props.result));
          return { resultText };
        },
        template: `
          <div data-testid="integrated-tool" class="tool-render">
            <div>Tool: {{ name }}</div>
            <div>Action: {{ args.action }}</div>
            <div>Target: {{ args.target }}</div>
            <div>Status: {{ status }}</div>
            <div v-if="result">Result: {{ resultText }}</div>
          </div>
        `,
      });

      const IntegratedToolComponent = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ action: string; target: string }> = {
            name: "chatIntegratedTool",
            parameters: z.object({
              action: z.string(),
              target: z.string(),
            }),
            render: IntegratedRenderer,
            handler: async (args) => ({
              success: true,
              message: `${args.action} completed on ${args.target}`,
            }),
          };

          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { IntegratedToolComponent },
        `
          <div>
            <IntegratedToolComponent />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Perform an action");

      await waitFor(() => {
        expect(screen.getByText("Perform an action")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "chatIntegratedTool",
          parentMessageId: messageId,
          delta: '{"action":"process","target":"data"}',
        }),
      );

      await waitFor(() => {
        const toolRender = screen.getByTestId("integrated-tool");
        expect(toolRender).toBeDefined();
        expect(toolRender.textContent).toContain("Action: process");
        expect(toolRender.textContent).toContain("Target: data");
        expect(toolRender.classList.contains("tool-render")).toBe(true);
      });

      await agent.emit(
        toolCallResultEvent({
          toolCallId,
          messageId: `${messageId}_result`,
          content: JSON.stringify({
            success: true,
            message: "process completed on data",
          }),
        }),
      );

      await waitFor(() => {
        const toolRender = screen.getByTestId("integrated-tool");
        expect(toolRender.textContent).toContain("Result:");
        expect(toolRender.textContent).toContain("process completed on data");
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });

  describe("Tool Executing State", () => {
    it("should be in executing state while handler is running", async () => {
      const statusHistory: ToolCallStatus[] = [];
      let handlerStarted = false;
      let handlerCompleted = false;
      let handlerResult: any = null;

      const agent = new MockStepwiseAgent();

      const ExecutingRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
          status: { type: String as PropType<ToolCallStatus>, required: true },
          result: { type: null as unknown as PropType<any>, required: false },
        },
        setup(props) {
          watch(
            () => props.status,
            (status) => {
              if (!statusHistory.includes(status)) {
                statusHistory.push(status);
              }
            },
            { immediate: true },
          );

          const resultText = computed(() =>
            props.result ? JSON.stringify(props.result) : "no-result",
          );
          return { resultText };
        },
        template: `
          <div data-testid="executing-tool">
            <div data-testid="tool-status">{{ status }}</div>
            <div data-testid="tool-value">{{ args.value || "undefined" }}</div>
            <div data-testid="tool-result">{{ resultText }}</div>
          </div>
        `,
      });

      const ExecutingStateTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ value: string }> = {
            name: "executingStateTool",
            parameters: z.object({ value: z.string() }),
            render: ExecutingRenderer,
            handler: async (args) => {
              handlerStarted = true;
              await new Promise((resolve) => setTimeout(resolve, 50));
              handlerCompleted = true;
              handlerResult = { processed: args.value.toUpperCase() };
              return handlerResult;
            },
          };

          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { ExecutingStateTool },
        `
          <div>
            <ExecutingStateTool />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Test executing state");

      await waitFor(() => {
        expect(screen.getByText("Test executing state")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "executingStateTool",
          parentMessageId: messageId,
          delta: '{"value":"test"}',
        }),
      );

      await waitFor(() => {
        const toolEl = screen.getByTestId("executing-tool");
        expect(toolEl).toBeDefined();
        expect(screen.getByTestId("tool-value").textContent).toBe("test");
        expect(screen.getByTestId("tool-status").textContent).toBe(
          ToolCallStatus.InProgress,
        );
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();

      await waitFor(
        async () => {
          expect(handlerStarted).toBe(true);
        },
        { timeout: 3000 },
      );

      await waitFor(
        () => {
          expect(handlerCompleted).toBe(true);
        },
        { timeout: 3000 },
      );

      expect(handlerStarted).toBe(true);
      expect(handlerCompleted).toBe(true);
      expect(handlerResult).toEqual({ processed: "TEST" });

      await waitFor(
        () => {
          expect(statusHistory).toContain(ToolCallStatus.Complete);
        },
        { timeout: 3000 },
      );

      expect(statusHistory).toContain(ToolCallStatus.InProgress);
      expect(statusHistory).toContain(ToolCallStatus.Executing);

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
      let defaultAgentHandlerCalled = false;
      let specificAgentHandlerCalled = false;
      let wrongAgentHandlerCalled = false;

      const agent = new MockStepwiseAgent();

      const WrongAgentRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
        },
        template: `<div data-testid="wrong-agent-tool">Wrong Agent Tool: {{ args.message }}</div>`,
      });
      const DefaultAgentRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
          result: { type: null as unknown as PropType<any>, required: false },
        },
        setup(props) {
          const resultText = computed(() => JSON.stringify(props.result));
          return { resultText };
        },
        template: `
          <div data-testid="default-agent-tool">
            Default Agent Tool: {{ args.message }}
            <div data-testid="default-result" v-if="result">{{ resultText }}</div>
          </div>
        `,
      });
      const SpecificAgentRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
        },
        template: `<div data-testid="specific-agent-tool">Specific Agent Tool: {{ args.message }}</div>`,
      });

      const WrongAgentTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ message: string }> = {
            name: "testTool",
            parameters: z.object({ message: z.string() }),
            agentId: "wrongAgent",
            render: WrongAgentRenderer,
            handler: async (args) => {
              wrongAgentHandlerCalled = true;
              return { result: `Wrong agent processed: ${args.message}` };
            },
          };
          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const DefaultAgentTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ message: string }> = {
            name: "testTool",
            parameters: z.object({ message: z.string() }),
            agentId: "default",
            render: DefaultAgentRenderer,
            handler: async (args) => {
              defaultAgentHandlerCalled = true;
              return { result: `Default agent processed: ${args.message}` };
            },
          };
          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const SpecificAgentTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ message: string }> = {
            name: "testTool",
            parameters: z.object({ message: z.string() }),
            agentId: "specificAgent",
            render: SpecificAgentRenderer,
            handler: async (args) => {
              specificAgentHandlerCalled = true;
              return { result: `Specific agent processed: ${args.message}` };
            },
          };
          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { WrongAgentTool, DefaultAgentTool, SpecificAgentTool },
        `
          <div>
            <WrongAgentTool />
            <DefaultAgentTool />
            <SpecificAgentTool />
            <div style="height: 400px;">
              <CopilotChat agentId="default" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Test agent scoping");

      await waitFor(() => {
        expect(screen.getByText("Test agent scoping")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "testTool",
          parentMessageId: messageId,
          delta: '{"message":"test message"}',
        }),
      );
      await agent.emit(runFinishedEvent());

      await waitFor(() => {
        const defaultTool = screen.queryByTestId("default-agent-tool");
        expect(defaultTool).not.toBeNull();
        expect(defaultTool!.textContent).toContain("test message");
      });

      await agent.complete();

      await waitFor(() => {
        expect(defaultAgentHandlerCalled).toBe(true);
      });

      expect(defaultAgentHandlerCalled).toBe(true);
      expect(wrongAgentHandlerCalled).toBe(false);
      expect(specificAgentHandlerCalled).toBe(false);
    });

    it("demonstrates that agent scoping prevents execution of tools for wrong agents", async () => {
      let scopedHandlerCalled = false;
      let globalHandlerCalled = false;

      const agent = new MockStepwiseAgent();

      const ScopedRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
          result: { type: null as unknown as PropType<any>, required: false },
        },
        setup(props) {
          const resultText = computed(() => JSON.stringify(props.result));
          return { resultText };
        },
        template: `
          <div data-testid="scoped-tool">
            Scoped Tool: {{ args.message }}
            <div data-testid="scoped-result" v-if="result">{{ resultText }}</div>
          </div>
        `,
      });

      const GlobalRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
          result: { type: null as unknown as PropType<any>, required: false },
        },
        setup(props) {
          const resultText = computed(() => JSON.stringify(props.result));
          return { resultText };
        },
        template: `
          <div data-testid="global-tool">
            Global Tool: {{ args.message }}
            <div data-testid="global-result" v-if="result">{{ resultText }}</div>
          </div>
        `,
      });

      const ScopedTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ message: string }> = {
            name: "scopedTool",
            parameters: z.object({ message: z.string() }),
            agentId: "differentAgent",
            render: ScopedRenderer,
            handler: async (args) => {
              scopedHandlerCalled = true;
              return { result: `Scoped processed: ${args.message}` };
            },
          };
          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const GlobalTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ message: string }> = {
            name: "globalTool",
            parameters: z.object({ message: z.string() }),
            render: GlobalRenderer,
            handler: async (args) => {
              globalHandlerCalled = true;
              return { result: `Global processed: ${args.message}` };
            },
          };
          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { ScopedTool, GlobalTool },
        `
          <div>
            <ScopedTool />
            <GlobalTool />
            <div style="height: 400px;">
              <CopilotChat agentId="default" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Test scoping");

      await waitFor(() => {
        expect(screen.getByText("Test scoping")).toBeDefined();
      });

      const messageId = testId("msg");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc1"),
          toolCallName: "scopedTool",
          parentMessageId: messageId,
          delta: '{"message":"trying scoped"}',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("scoped-tool")).toBeDefined();
      });

      await agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc2"),
          toolCallName: "globalTool",
          parentMessageId: messageId,
          delta: '{"message":"trying global"}',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("global-tool")).toBeDefined();
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();

      await waitFor(() => {
        expect(globalHandlerCalled).toBe(true);
      });

      expect(scopedHandlerCalled).toBe(false);
      expect(globalHandlerCalled).toBe(true);

      const scopedResult = screen.queryByTestId("scoped-result");
      expect(scopedResult).toBeNull();

      await waitFor(() => {
        const globalResult = screen.getByTestId("global-result");
        expect(globalResult.textContent).toContain(
          "Global processed: trying global",
        );
      });
    });
  });

  describe("Nested Tool Calls", () => {
    it("should enable tool calls that render other tools", async () => {
      const agent = new MockStepwiseAgent();
      let childToolRegistered = false;

      const ChildRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
        },
        template: `<div data-testid="child-tool">Child: {{ args.childValue }}</div>`,
      });
      const ParentRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
        },
        template: `<div data-testid="parent-tool">Parent: {{ args.parentValue }}</div>`,
      });

      const ChildTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ childValue: string }> = {
            name: "childTool",
            parameters: z.object({ childValue: z.string() }),
            render: ChildRenderer,
          };

          useFrontendTool(tool);

          onMounted(() => {
            childToolRegistered = true;
          });

          return {};
        },
        template: `<div />`,
      });

      const ParentTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ parentValue: string }> = {
            name: "parentTool",
            parameters: z.object({ parentValue: z.string() }),
            render: ParentRenderer,
          };

          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { ParentTool, ChildTool },
        `
          <div>
            <ParentTool />
            <ChildTool />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      expect(childToolRegistered).toBe(true);

      await submitMessage("Test nested tools");

      await waitFor(() => {
        expect(screen.getByText("Test nested tools")).toBeDefined();
      });

      const messageId = testId("msg");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("parent-tc"),
          toolCallName: "parentTool",
          parentMessageId: messageId,
          delta: '{"parentValue":"test parent"}',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("parent-tool")).toBeDefined();
      });

      await agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("child-tc"),
          toolCallName: "childTool",
          parentMessageId: messageId,
          delta: '{"childValue":"test child"}',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("child-tool")).toBeDefined();
        expect(screen.getByTestId("child-tool").textContent).toContain(
          "test child",
        );
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });

  describe("Tool Availability", () => {
    it("should ensure tools are available when request is made", async () => {
      const agent = new MockStepwiseAgent();

      const AvailabilityRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
        },
        template: `<div data-testid="availability-tool">{{ args.test }}</div>`,
      });

      const AvailabilityTestTool = defineComponent({
        props: {
          onRegistered: {
            type: Function as PropType<() => void>,
            required: false,
          },
        },
        setup(props) {
          const tool: VueFrontendTool<{ test: string }> = {
            name: "availabilityTool",
            parameters: z.object({ test: z.string() }),
            render: AvailabilityRenderer,
            handler: async (args) => ({ received: args.test }),
          };

          useFrontendTool(tool);

          onMounted(() => {
            props.onRegistered?.();
          });

          return {};
        },
        template: `<div />`,
      });

      let toolRegistered = false;
      const onRegistered = () => {
        toolRegistered = true;
      };

      const Host = defineComponent({
        components: { AvailabilityTestTool, CopilotChat },
        setup() {
          return { onRegistered };
        },
        template: `
          <div>
            <AvailabilityTestTool :on-registered="onRegistered" />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      });

      renderWithCopilotKit({ agent, children: Host });

      await waitFor(() => {
        expect(toolRegistered).toBe(true);
      });

      await submitMessage("Test availability");

      await waitFor(() => {
        expect(screen.getByText("Test availability")).toBeDefined();
      });

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc"),
          toolCallName: "availabilityTool",
          parentMessageId: testId("msg"),
          delta: '{"test":"available"}',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("availability-tool")).toBeDefined();
        expect(screen.getByTestId("availability-tool").textContent).toBe(
          "available",
        );
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });

  describe("Re-render Idempotence", () => {
    it("should not create duplicates on re-render", async () => {
      const agent = new MockStepwiseAgent();
      let renderCount = 0;

      const IdempotentRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
        },
        setup(props) {
          renderCount += 1;
          const text = computed(
            () =>
              `Value: ${String(props.args.value)} | Renders: ${renderCount}`,
          );
          return { text };
        },
        template: `<div data-testid="idempotent-tool">{{ text }}</div>`,
      });

      const IdempotentTool = defineComponent({
        setup() {
          const counter = ref(0);

          const tool: VueFrontendTool<{ value: string }> = {
            name: "idempotentTool",
            parameters: z.object({ value: z.string() }),
            render: IdempotentRenderer,
          };

          useFrontendTool(tool);

          const rerender = () => {
            counter.value += 1;
          };

          return { counter, rerender };
        },
        template: `
          <div>
            <button data-testid="rerender-button" @click="rerender">
              Re-render ({{ counter }})
            </button>
          </div>
        `,
      });

      const Host = createChatHost(
        { IdempotentTool },
        `
          <div>
            <IdempotentTool />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Test idempotence");

      await waitFor(() => {
        expect(screen.getByText("Test idempotence")).toBeDefined();
      });

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc"),
          toolCallName: "idempotentTool",
          parentMessageId: testId("msg"),
          delta: '{"value":"test"}',
        }),
      );

      await waitFor(() => {
        const tools = screen.getAllByTestId("idempotent-tool");
        expect(tools).toHaveLength(1);
        expect(tools[0]?.textContent).toContain("Value: test");
      });

      const initialRenderCount = renderCount;

      fireEvent.click(screen.getByTestId("rerender-button"));

      await waitFor(() => {
        const button = screen.getByTestId("rerender-button");
        expect(button.textContent).toContain("1");
      });

      const toolsAfterRerender = screen.getAllByTestId("idempotent-tool");
      expect(toolsAfterRerender).toHaveLength(1);

      expect(renderCount).toBeLessThanOrEqual(initialRenderCount + 2);

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });

  describe("useFrontendTool dependencies", () => {
    it("updates tool renderer when optional deps change", async () => {
      const DependencyDrivenTool = defineComponent({
        components: { CopilotChatToolCallsView },
        setup() {
          const version = ref(0);

          const DependencyRenderer = defineComponent({
            props: {
              args: {
                type: Object as PropType<Record<string, any>>,
                required: true,
              },
            },
            setup(props) {
              const text = computed(
                () => `${String(props.args.message)} (v${version.value})`,
              );
              return { text };
            },
            template: `<div data-testid="dependency-tool-render">{{ text }}</div>`,
          });

          const tool: VueFrontendTool<{ message: string }> = {
            name: "dependencyTool",
            parameters: z.object({ message: z.string() }),
            render: DependencyRenderer,
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

          const bumpVersion = () => {
            version.value += 1;
          };

          return { assistantMessage, messages, bumpVersion };
        },
        template: `
          <div>
            <button data-testid="bump-version" type="button" @click="bumpVersion">
              Bump
            </button>
            <CopilotChatToolCallsView :message="assistantMessage" :messages="messages" />
          </div>
        `,
      });

      renderWithCopilotKit({ children: DependencyDrivenTool });

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

      const ErrorRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
          status: { type: String, required: true },
          result: { type: null as unknown as PropType<any>, required: false },
        },
        setup(props) {
          const resultText = computed(() =>
            props.result ? String(props.result) : "no-result",
          );
          return { resultText };
        },
        template: `
          <div data-testid="error-tool">
            <div data-testid="error-status">{{ status }}</div>
            <div data-testid="error-message">{{ args.message }}</div>
            <div data-testid="error-result">{{ resultText }}</div>
          </div>
        `,
      });

      const ErrorTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{
            shouldError: boolean;
            message: string;
          }> = {
            name: "errorTool",
            parameters: z.object({
              shouldError: z.boolean(),
              message: z.string(),
            }),
            render: ErrorRenderer,
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
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { ErrorTool },
        `
          <div>
            <ErrorTool />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Test error");

      await waitFor(() => {
        expect(screen.getByText("Test error")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "errorTool",
          parentMessageId: messageId,
          delta: '{"shouldError":true,"message":"test error"}',
        }),
      );
      await agent.emit(runFinishedEvent());

      await waitFor(() => {
        expect(screen.getByTestId("error-tool")).toBeDefined();
      });

      await agent.complete();

      await waitFor(() => {
        expect(handlerCalled).toBe(true);
        expect(errorThrown).toBe(true);
      });

      await waitFor(() => {
        const resultEl = screen.getByTestId("error-result");
        const resultText = resultEl.textContent || "";
        expect(resultText).not.toBe("no-result");
        expect(resultText).toContain("Error:");
        expect(resultText).toContain("Handler error: test error");
      });

      expect(screen.getByTestId("error-status").textContent).toBe(
        ToolCallStatus.Complete,
      );
    });

    it("should handle async errors in handler", async () => {
      const agent = new MockStepwiseAgent();

      const AsyncErrorRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
          status: { type: String, required: true },
          result: { type: null as unknown as PropType<any>, required: false },
        },
        template: `
          <div data-testid="async-error-tool">
            <div data-testid="async-status">{{ status }}</div>
            <div data-testid="async-delay">Delay: {{ args.delay }}ms</div>
            <div data-testid="async-error-msg">{{ args.errorMessage }}</div>
            <div data-testid="async-result" v-if="result">{{ result }}</div>
          </div>
        `,
      });

      const AsyncErrorTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ delay: number; errorMessage: string }> =
            {
              name: "asyncErrorTool",
              parameters: z.object({
                delay: z.number(),
                errorMessage: z.string(),
              }),
              render: AsyncErrorRenderer,
              handler: async (args) => {
                await new Promise((resolve) => setTimeout(resolve, args.delay));
                throw new Error(args.errorMessage);
              },
            };

          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { AsyncErrorTool },
        `
          <div>
            <AsyncErrorTool />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Test async error");

      await waitFor(() => {
        expect(screen.getByText("Test async error")).toBeDefined();
      });

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc"),
          toolCallName: "asyncErrorTool",
          parentMessageId: testId("msg"),
          delta:
            '{"delay":10,"errorMessage":"Async operation failed after delay"}',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("async-error-tool")).toBeDefined();
        expect(screen.getByTestId("async-delay").textContent).toContain("10ms");
        expect(screen.getByTestId("async-error-msg").textContent).toContain(
          "Async operation failed",
        );
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });

  describe("Wildcard Handler", () => {
    it("should handle unknown tools with wildcard", async () => {
      const agent = new MockStepwiseAgent();
      const wildcardHandlerCalls: { name: string; args: any }[] = [];

      const WildcardRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
          status: { type: String, required: true },
          result: { type: null as unknown as PropType<any>, required: false },
        },
        setup(props) {
          const rootTestId = computed(() => `wildcard-render-${props.name}`);
          const argsText = computed(
            () => `Args: ${JSON.stringify(props.args)}`,
          );
          const statusText = computed(() => `Status: ${props.status}`);
          const resultText = computed(() => `Result: ${props.result}`);
          return { rootTestId, argsText, statusText, resultText };
        },
        template: `
          <div :data-testid="rootTestId">
            <div data-testid="wildcard-tool-name">Wildcard caught: {{ name }}</div>
            <div data-testid="wildcard-args">{{ argsText }}</div>
            <div data-testid="wildcard-status">{{ statusText }}</div>
            <div data-testid="wildcard-result" v-if="result">{{ resultText }}</div>
          </div>
        `,
      });

      const WildcardTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<any> = {
            name: "*",
            parameters: z.any(),
            render: WildcardRenderer,
            handler: async (args: any) => {
              wildcardHandlerCalls.push({ name: "wildcard", args });
              return { handled: "by wildcard", receivedArgs: args };
            },
          };

          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { WildcardTool },
        `
          <div>
            <WildcardTool />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Test wildcard");

      await waitFor(() => {
        expect(screen.getByText("Test wildcard")).toBeDefined();
      });

      await agent.emit(runStartedEvent());

      await agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc1"),
          toolCallName: "undefinedTool",
          parentMessageId: testId("msg"),
          delta: '{"someParam":"value","anotherParam":123}',
        }),
      );

      await waitFor(() => {
        const nameEl = screen.getByTestId("wildcard-tool-name");
        expect(nameEl.textContent).toContain("undefinedTool");
        const argsEl = screen.getByTestId("wildcard-args");
        expect(argsEl.textContent).toContain("someParam");
        expect(argsEl.textContent).toContain("value");
        expect(argsEl.textContent).toContain("123");
      });

      await waitFor(() => {
        const statusEl = screen.getByTestId("wildcard-status");
        expect(statusEl.textContent).toMatch(/Status: (inProgress|complete)/);
      });

      await agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc2"),
          toolCallName: "anotherUnknownTool",
          parentMessageId: testId("msg"),
          delta: '{"differentArg":"test"}',
        }),
      );

      await waitFor(() => {
        const tool1 = screen.getByTestId("wildcard-render-undefinedTool");
        const tool2 = screen.getByTestId("wildcard-render-anotherUnknownTool");
        expect(tool1).toBeDefined();
        expect(tool2).toBeDefined();
      });

      await agent.emit(
        toolCallResultEvent({
          toolCallId: testId("tc1"),
          messageId: testId("msg_result"),
          content: "Tool executed successfully",
        }),
      );

      await waitFor(() => {
        const resultEl = screen.queryByTestId("wildcard-result");
        if (resultEl) {
          expect(resultEl.textContent).toContain("Tool executed successfully");
        }
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });

  describe("Renderer Precedence", () => {
    it("should use specific renderer over wildcard", async () => {
      const agent = new MockStepwiseAgent();

      const SpecificRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, any>>,
            required: true,
          },
        },
        template: `<div data-testid="specific-render">Specific: {{ args.value }}</div>`,
      });
      const WildcardRenderer = defineComponent({
        props: { name: { type: String, required: true } },
        template: `<div data-testid="wildcard-render">Wildcard: {{ name }}</div>`,
      });

      const SpecificTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<{ value: string }> = {
            name: "specificTool",
            parameters: z.object({ value: z.string() }),
            render: SpecificRenderer,
          };
          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const WildcardTool = defineComponent({
        setup() {
          const tool: VueFrontendTool<any> = {
            name: "*",
            parameters: z.any(),
            render: WildcardRenderer,
          };
          useFrontendTool(tool);
          return {};
        },
        template: `<div />`,
      });

      const Host = createChatHost(
        { SpecificTool, WildcardTool },
        `
          <div>
            <SpecificTool />
            <WildcardTool />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      );

      renderWithCopilotKit({ agent, children: Host });

      await submitMessage("Test precedence");

      await waitFor(() => {
        expect(screen.getByText("Test precedence")).toBeDefined();
      });

      await agent.emit(runStartedEvent());

      await agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc1"),
          toolCallName: "specificTool",
          parentMessageId: testId("msg"),
          delta: '{"value":"test specific"}',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("specific-render")).toBeDefined();
        expect(screen.getByTestId("specific-render").textContent).toContain(
          "test specific",
        );
      });

      await agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc2"),
          toolCallName: "unknownTool",
          parentMessageId: testId("msg"),
          delta: '{"someArg":"test wildcard"}',
        }),
      );

      await waitFor(() => {
        const wildcards = screen.getAllByTestId("wildcard-render");
        expect(wildcards.length).toBeGreaterThan(0);
        const unknownToolRender = wildcards.find((el) =>
          el.textContent?.includes("unknownTool"),
        );
        expect(unknownToolRender).toBeDefined();
      });

      expect(screen.getByTestId("specific-render")).toBeDefined();

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });
});
