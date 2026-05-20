import { cleanup, fireEvent, screen, waitFor } from "@testing-library/vue";
import { computed, defineComponent, onMounted } from "vue";
import type { PropType } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/client";
import { z } from "zod";
import { useConfigureSuggestions } from "../../../hooks/use-configure-suggestions";
import {
  SuggestionsProviderAgent,
  emitReasoningSequence,
  MockStepwiseAgent,
  reasoningEndEvent,
  reasoningMessageContentEvent,
  reasoningMessageEndEvent,
  reasoningMessageStartEvent,
  reasoningStartEvent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  testId,
  textChunkEvent,
  toolCallChunkEvent,
  toolCallResultEvent,
} from "../../../__tests__/utils/test-helpers";
import CopilotChat from "../CopilotChat.vue";

afterEach(() => {
  cleanup();
});

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

const ChatWithSuggestions = defineComponent({
  components: { CopilotChat },
  props: {
    consumerAgentId: { type: String, required: true },
    providerAgentId: { type: String, required: true },
    instructions: { type: String, required: false, default: undefined },
    minSuggestions: { type: Number, required: false, default: undefined },
    maxSuggestions: { type: Number, required: false, default: undefined },
    onReady: {
      type: Function as PropType<(() => void) | undefined>,
      required: false,
      default: undefined,
    },
  },
  setup(props) {
    useConfigureSuggestions({
      instructions: props.instructions || "Suggest helpful next actions",
      providerAgentId: props.providerAgentId,
      consumerAgentId: props.consumerAgentId,
      minSuggestions: props.minSuggestions || 2,
      maxSuggestions: props.maxSuggestions || 4,
    });

    onMounted(() => {
      props.onReady?.();
    });

    return {};
  },
  template: `
    <CopilotChat :welcome-screen="false" />
  `,
});

describe("CopilotChat E2E - Chat Basics and Streaming Patterns", () => {
  describe("Chat Basics: text input + run", () => {
    it("should display user message and start agent run when Enter is pressed", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      await submitMessageAndWaitForUserMessage("Hello AI!");

      const messageId = testId("msg");
      await agent.emit(runStartedEvent());
      agent.emit(textChunkEvent(messageId, "Hello! "));
      agent.emit(textChunkEvent(messageId, "How can I help you today?"));
      agent.emit(runFinishedEvent());
      agent.complete();

      await waitFor(() => {
        const assistantMessage = screen.getByText(
          "Hello! How can I help you today?",
        );
        expect(assistantMessage).toBeDefined();
      });
    });

    it("should accumulate text chunks progressively", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      await submitMessageAndWaitForUserMessage("Tell me a story");

      const messageId = testId("msg");
      await agent.emit(runStartedEvent());

      agent.emit(textChunkEvent(messageId, "Once upon"));

      await waitFor(() => {
        expect(screen.getByText(/Once upon/)).toBeDefined();
      });

      agent.emit(textChunkEvent(messageId, " a time"));

      await waitFor(() => {
        expect(screen.getByText(/Once upon a time/)).toBeDefined();
      });

      agent.emit(textChunkEvent(messageId, " there was a robot."));

      await waitFor(() => {
        expect(
          screen.getByText(/Once upon a time there was a robot\./),
        ).toBeDefined();
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });

    it("should reset chat running state when backend emits RUN_ERROR", async () => {
      const agent = new MockStepwiseAgent();

      const StatusProbeHost = defineComponent({
        components: { CopilotChat },
        template: `
          <CopilotChat :welcome-screen="false">
            <template #chat-view="{ isRunning, onStop, onSubmitMessage }">
              <div>
                <button data-testid="submit" @click="onSubmitMessage('trigger run')">submit</button>
                <span data-testid="running">{{ isRunning ? "running" : "idle" }}</span>
                <span data-testid="stop-availability">{{ onStop ? "available" : "missing" }}</span>
              </div>
            </template>
          </CopilotChat>
        `,
      });

      renderWithCopilotKit({ agent, children: StatusProbeHost });

      expect(screen.getByTestId("running").textContent).toBe("idle");
      expect(screen.getByTestId("stop-availability").textContent).toBe(
        "missing",
      );

      await fireEvent.click(screen.getByTestId("submit"));
      await agent.emit(runStartedEvent());

      await waitFor(() => {
        expect(screen.getByTestId("running").textContent).toBe("running");
        expect(screen.getByTestId("stop-availability").textContent).toBe(
          "available",
        );
      });

      await agent.emit({ type: EventType.RUN_ERROR } as any);
      await agent.complete();

      await waitFor(() => {
        expect(screen.getByTestId("running").textContent).toBe("idle");
        expect(screen.getByTestId("stop-availability").textContent).toBe(
          "missing",
        );
      });
    });
  });

  describe("Single Tool Flow", () => {
    it("should handle complete tool call lifecycle", async () => {
      const agent = new MockStepwiseAgent();

      const WeatherToolRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          status: { type: String, required: true },
          args: {
            type: Object as PropType<Record<string, unknown>>,
            required: true,
          },
          result: {
            type: String as PropType<string | undefined>,
            required: false,
            default: undefined,
          },
        },
        setup(props: {
          name: string;
          status: string;
          args: { location?: string };
          result?: string;
        }) {
          const text = computed(
            () =>
              `Tool: ${props.name} | Status: ${props.status} | Location: ${String(props.args.location ?? "")} |${props.result ? ` Result: ${props.result}` : ""}`,
          );
          return { text };
        },
        template: `<div data-testid="weather-tool">{{ text }}</div>`,
      });

      renderWithCopilotKit({
        agent,
        frontendTools: [
          {
            name: "getWeather",
            parameters: z.object({
              location: z.string(),
              unit: z.string().optional(),
            }),
            render: WeatherToolRenderer,
          },
        ],
      });

      await submitMessageAndWaitForUserMessage("What's the weather?");

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());
      agent.emit(
        textChunkEvent(messageId, "Let me check the weather for you."),
      );

      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "getWeather",
          parentMessageId: messageId,
          delta: '{"location":"Paris"',
        }),
      );

      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          parentMessageId: messageId,
          delta: ',"unit":"celsius"}',
        }),
      );

      await waitFor(() => {
        const tool = screen.getByTestId("weather-tool");
        expect(tool.textContent).toContain("Tool: getWeather");
        expect(tool.textContent).toContain("Location: Paris");
      });

      agent.emit(
        toolCallResultEvent({
          toolCallId,
          messageId: `${messageId}_result`,
          content: JSON.stringify({ temperature: 22, condition: "Sunny" }),
        }),
      );

      await waitFor(() => {
        const tool = screen.getByTestId("weather-tool");
        expect(tool.textContent).toContain("temperature");
        expect(tool.textContent).toContain("22");
        expect(tool.textContent).toContain("Sunny");
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Multiple Tools Interleaved", () => {
    it("should handle multiple tool calls in one assistant message", async () => {
      const agent = new MockStepwiseAgent();

      const WeatherRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          args: {
            type: Object as PropType<Record<string, unknown>>,
            required: true,
          },
          result: {
            type: String as PropType<string | undefined>,
            required: false,
            default: undefined,
          },
        },
        setup(props: {
          name: string;
          args: { location?: string };
          result?: string;
        }) {
          const testIdValue = computed(
            () => `weather-${String(props.args.location ?? "")}`,
          );
          const text = computed(
            () =>
              `[${props.name}] Weather for ${String(props.args.location ?? "")}: ${props.result ? props.result : "Loading..."}`,
          );
          return { testIdValue, text };
        },
        template: `<div :data-testid="testIdValue">{{ text }}</div>`,
      });

      const TimeRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          args: {
            type: Object as PropType<Record<string, unknown>>,
            required: true,
          },
          result: {
            type: String as PropType<string | undefined>,
            required: false,
            default: undefined,
          },
        },
        setup(props: {
          name: string;
          args: { timezone?: string };
          result?: string;
        }) {
          const testIdValue = computed(
            () => `time-${String(props.args.timezone ?? "")}`,
          );
          const text = computed(
            () =>
              `[${props.name}] Time in ${String(props.args.timezone ?? "")}: ${props.result ? props.result : "Loading..."}`,
          );
          return { testIdValue, text };
        },
        template: `<div :data-testid="testIdValue">{{ text }}</div>`,
      });

      renderWithCopilotKit({
        agent,
        frontendTools: [
          {
            name: "getWeather",
            parameters: z.object({ location: z.string() }),
            render: WeatherRenderer,
          },
          {
            name: "getTime",
            parameters: z.object({ timezone: z.string() }),
            render: TimeRenderer,
          },
        ],
      });

      await submitMessageAndWaitForUserMessage("Weather and time please");

      const messageId = testId("msg");
      const toolCallId1 = testId("tc1");
      const toolCallId2 = testId("tc2");

      await agent.emit(runStartedEvent());
      agent.emit(textChunkEvent(messageId, "I'll check both for you."));

      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId1,
          toolCallName: "getWeather",
          parentMessageId: messageId,
          delta: '{"location":"London"}',
        }),
      );

      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId2,
          toolCallName: "getTime",
          parentMessageId: messageId,
          delta: '{"timezone":"UTC"}',
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("weather-London")).toBeDefined();
        expect(screen.getByTestId("time-UTC")).toBeDefined();
      });

      agent.emit(
        toolCallResultEvent({
          toolCallId: toolCallId2,
          messageId: `${messageId}_result2`,
          content: JSON.stringify({ time: "12:00 PM" }),
        }),
      );

      agent.emit(
        toolCallResultEvent({
          toolCallId: toolCallId1,
          messageId: `${messageId}_result1`,
          content: JSON.stringify({ temp: 18, condition: "Cloudy" }),
        }),
      );

      await waitFor(() => {
        const weatherTool = screen.getByTestId("weather-London");
        const timeTool = screen.getByTestId("time-UTC");

        expect(weatherTool.textContent).toContain("[getWeather]");
        expect(weatherTool.textContent).toContain("18");
        expect(weatherTool.textContent).toContain("Cloudy");
        expect(timeTool.textContent).toContain("[getTime]");
        expect(timeTool.textContent).toContain("12:00 PM");
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Wildcard Fallback", () => {
    it("should use wildcard renderer when no specific renderer exists", async () => {
      const agent = new MockStepwiseAgent();

      const WildcardRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          args: {
            type: Object as PropType<Record<string, unknown>>,
            required: true,
          },
        },
        setup(props: { name: string; args: Record<string, unknown> }) {
          const text = computed(
            () =>
              `Unknown tool: ${props.name} with args: ${JSON.stringify(props.args)}`,
          );
          return { text };
        },
        template: `<div data-testid="wildcard-renderer">{{ text }}</div>`,
      });

      renderWithCopilotKit({
        agent,
        frontendTools: [
          {
            name: "*",
            render: WildcardRenderer,
          },
        ],
      });

      await submitMessageAndWaitForUserMessage("Do something unknown");

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());

      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "unknownTool",
          parentMessageId: messageId,
          delta: '{"param":"value"}',
        }),
      );

      await waitFor(() => {
        const wildcard = screen.getByTestId("wildcard-renderer");
        expect(wildcard).toBeDefined();
        expect(wildcard.textContent).toContain("Unknown tool: unknownTool");
        expect(wildcard.textContent).toContain("value");
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });

    it("should use wildcard renderer without args definition", async () => {
      const agent = new MockStepwiseAgent();

      const WildcardNoArgsRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          args: {
            type: Object as PropType<Record<string, unknown>>,
            required: true,
          },
        },
        setup(props: { name: string; args: Record<string, unknown> }) {
          const argsText = computed(() => JSON.stringify(props.args));
          return { argsText };
        },
        template: `
          <div data-testid="wildcard-no-args">
            <span data-testid="tool-name">{{ name }}</span>
            <span data-testid="tool-args">{{ argsText }}</span>
          </div>
        `,
      });

      renderWithCopilotKit({
        agent,
        frontendTools: [
          {
            name: "*",
            render: WildcardNoArgsRenderer,
          },
        ],
      });

      await submitMessageAndWaitForUserMessage("Do something");

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());

      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "myCustomTool",
          parentMessageId: messageId,
          delta: '{"param":"test","value":123}',
        }),
      );

      await waitFor(() => {
        const wildcard = screen.getByTestId("wildcard-no-args");
        expect(wildcard).toBeDefined();

        const toolName = screen.getByTestId("tool-name");
        expect(toolName.textContent).toBe("myCustomTool");
        expect(toolName.textContent).not.toBe("*");

        const toolArgs = screen.getByTestId("tool-args");
        const parsedArgs = JSON.parse(toolArgs.textContent || "{}");
        expect(parsedArgs.param).toBe("test");
        expect(parsedArgs.value).toBe(123);
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });

    it("should not show toolbar for messages with only tool calls and no content", async () => {
      const agent = new MockStepwiseAgent();

      const TestToolRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, unknown>>,
            required: true,
          },
        },
        setup(props: { args: { value?: string } }) {
          const text = computed(
            () => `Tool: ${String(props.args.value ?? "")}`,
          );
          return { text };
        },
        template: `<div data-testid="test-tool">{{ text }}</div>`,
      });

      renderWithCopilotKit({
        agent,
        frontendTools: [
          {
            name: "testTool",
            parameters: z.object({ value: z.string() }),
            render: TestToolRenderer,
          },
        ],
      });

      await submitMessageAndWaitForUserMessage("Use test tool");

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());

      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "testTool",
          parentMessageId: messageId,
          delta: '{"value":"test"}',
        }),
      );

      await waitFor(() => {
        const toolRender = screen.getByTestId("test-tool");
        expect(toolRender).toBeDefined();
        expect(toolRender.textContent).toContain("Tool: test");
      });

      await waitFor(() => {
        const assistantMessageDiv = screen
          .getByTestId("test-tool")
          .closest("[data-message-id]");

        if (assistantMessageDiv) {
          const copyButtonsInAssistant = assistantMessageDiv.querySelectorAll(
            "button[aria-label*='Copy' i], button[aria-label*='copy' i]",
          );
          expect(copyButtonsInAssistant.length).toBe(0);
        }
      });

      const messageWithContentId = testId("msg2");
      agent.emit(
        textChunkEvent(
          messageWithContentId,
          "Here is some actual text content",
        ),
      );

      await waitFor(() => {
        const allMessages = screen.getAllByText(
          /Here is some actual text content/,
        );
        expect(allMessages.length).toBeGreaterThan(0);

        const toolbarButtons = screen.getAllByRole("button");
        const copyButton = toolbarButtons.find((btn) =>
          btn.getAttribute("aria-label")?.toLowerCase().includes("copy"),
        );
        expect(copyButton).toBeDefined();
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });

    it("should prefer specific renderer over wildcard when both exist", async () => {
      const agent = new MockStepwiseAgent();

      const SpecificRenderer = defineComponent({
        props: {
          args: {
            type: Object as PropType<Record<string, unknown>>,
            required: true,
          },
        },
        setup(props: { args: { value?: string } }) {
          const text = computed(
            () => `Specific: ${String(props.args.value ?? "")}`,
          );
          return { text };
        },
        template: `<div data-testid="specific-renderer">{{ text }}</div>`,
      });

      const WildcardRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
        },
        setup(props: { name: string }) {
          const text = computed(() => `Wildcard: ${props.name}`);
          return { text };
        },
        template: `<div data-testid="wildcard-renderer">{{ text }}</div>`,
      });

      renderWithCopilotKit({
        agent,
        frontendTools: [
          {
            name: "specificTool",
            parameters: z.object({ value: z.string() }),
            render: SpecificRenderer,
          },
          {
            name: "*",
            render: WildcardRenderer,
          },
        ],
      });

      await submitMessageAndWaitForUserMessage("Test specific");

      const messageId = testId("msg");
      const toolCallId1 = testId("tc1");
      const toolCallId2 = testId("tc2");

      await agent.emit(runStartedEvent());

      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId1,
          toolCallName: "specificTool",
          parentMessageId: messageId,
          delta: '{"value":"test123"}',
        }),
      );

      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId2,
          toolCallName: "unknownTool",
          parentMessageId: messageId,
          delta: '{"data":"xyz"}',
        }),
      );

      await waitFor(() => {
        const specific = screen.getByTestId("specific-renderer");
        expect(specific).toBeDefined();
        expect(specific.textContent).toContain("test123");
      });

      await waitFor(() => {
        const wildcard = screen.getByTestId("wildcard-renderer");
        expect(wildcard).toBeDefined();
        expect(wildcard.textContent).toContain("Wildcard: unknownTool");
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Suggestions Flow", () => {
    it("should display suggestions when configured", async () => {
      const consumerAgent = new MockStepwiseAgent();
      const providerAgent = new SuggestionsProviderAgent();

      providerAgent.setSuggestions([
        { title: "Option A", message: "Take action A" },
        { title: "Option B", message: "Take action B" },
      ]);

      let suggestionsReady = false;

      const SuggestionsHost = defineComponent({
        components: { ChatWithSuggestions },
        setup() {
          return {
            onReady: () => {
              suggestionsReady = true;
            },
          };
        },
        template: `
          <div style="height: 400px;">
            <ChatWithSuggestions
              consumer-agent-id="default"
              provider-agent-id="suggestions-provider"
              :on-ready="onReady"
            />
          </div>
        `,
      });

      renderWithCopilotKit({
        agents: {
          default: consumerAgent,
          "suggestions-provider": providerAgent,
        },
        agentId: "default",
        children: SuggestionsHost,
      });

      await waitFor(() => {
        expect(suggestionsReady).toBe(true);
      });

      await submitMessageAndWaitForUserMessage("Help me");

      const messageId = testId("msg");
      await consumerAgent.emit(runStartedEvent());
      consumerAgent.emit(textChunkEvent(messageId, "I can help with that."));
      consumerAgent.emit(runFinishedEvent());
      consumerAgent.complete();

      await waitFor(() => {
        expect(screen.getByText(/I can help with that/)).toBeDefined();
      });

      await waitFor(
        () => {
          expect(screen.getByText("Option A")).toBeDefined();
          expect(screen.getByText("Option B")).toBeDefined();
        },
        { timeout: 5000 },
      );

      const suggestionA = screen.getByText("Option A");
      await fireEvent.click(suggestionA);

      await waitFor(() => {
        const messages = screen.getAllByText(/Take action A/);
        expect(messages.length).toBeGreaterThan(0);
      });
    });

    it("should stream suggestion titles token by token", async () => {
      const consumerAgent = new MockStepwiseAgent();
      const providerAgent = new SuggestionsProviderAgent();

      providerAgent.setSuggestions([
        { title: "First Action", message: "Do first action" },
        { title: "Second Action", message: "Do second action" },
      ]);

      let suggestionsReady = false;

      const SuggestionsHost = defineComponent({
        components: { ChatWithSuggestions },
        setup() {
          return {
            onReady: () => {
              suggestionsReady = true;
            },
          };
        },
        template: `
          <div style="height: 400px;">
            <ChatWithSuggestions
              consumer-agent-id="default"
              provider-agent-id="suggestions-provider"
              :on-ready="onReady"
            />
          </div>
        `,
      });

      renderWithCopilotKit({
        agents: {
          default: consumerAgent,
          "suggestions-provider": providerAgent,
        },
        agentId: "default",
        children: SuggestionsHost,
      });

      await waitFor(() => {
        expect(suggestionsReady).toBe(true);
      });

      await submitMessageAndWaitForUserMessage("What can I do?");

      const messageId = testId("msg");
      await consumerAgent.emit(runStartedEvent());
      consumerAgent.emit(textChunkEvent(messageId, "Here are some options."));
      consumerAgent.emit(runFinishedEvent());
      consumerAgent.complete();

      await waitFor(
        () => {
          expect(screen.getByText("First Action")).toBeDefined();
          expect(screen.getByText("Second Action")).toBeDefined();
        },
        { timeout: 5000 },
      );
    });

    it("should handle multiple suggestions streaming concurrently", async () => {
      const consumerAgent = new MockStepwiseAgent();
      const providerAgent = new SuggestionsProviderAgent();

      providerAgent.setSuggestions([
        { title: "Alpha", message: "Do alpha" },
        { title: "Beta", message: "Do beta" },
        { title: "Gamma", message: "Do gamma" },
      ]);

      let suggestionsReady = false;

      const SuggestionsHost = defineComponent({
        components: { ChatWithSuggestions },
        setup() {
          return {
            onReady: () => {
              suggestionsReady = true;
            },
          };
        },
        template: `
          <div style="height: 400px;">
            <ChatWithSuggestions
              consumer-agent-id="default"
              provider-agent-id="suggestions-provider"
              :min-suggestions="3"
              :max-suggestions="5"
              :on-ready="onReady"
            />
          </div>
        `,
      });

      renderWithCopilotKit({
        agents: {
          default: consumerAgent,
          "suggestions-provider": providerAgent,
        },
        agentId: "default",
        children: SuggestionsHost,
      });

      await waitFor(() => {
        expect(suggestionsReady).toBe(true);
      });

      await submitMessageAndWaitForUserMessage("Show me options");

      const messageId = testId("msg");
      await consumerAgent.emit(runStartedEvent());
      consumerAgent.emit(textChunkEvent(messageId, "Here you go."));
      consumerAgent.emit(runFinishedEvent());
      consumerAgent.complete();

      await waitFor(
        () => {
          expect(screen.getByText("Alpha")).toBeDefined();
          expect(screen.getByText("Beta")).toBeDefined();
          expect(screen.getByText("Gamma")).toBeDefined();
        },
        { timeout: 5000 },
      );
    });
  });

  describe("Reasoning Message Flow", () => {
    it("should display reasoning message with 'Thinking...' label while streaming", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      await submitMessageAndWaitForUserMessage("Think about this");

      const reasoningId = testId("reasoning");

      await agent.emit(runStartedEvent());
      await agent.emit(reasoningStartEvent(reasoningId));
      await agent.emit(reasoningMessageStartEvent(reasoningId));
      await agent.emit(
        reasoningMessageContentEvent(reasoningId, "Let me analyze..."),
      );

      await agent.emit(reasoningMessageEndEvent(reasoningId));
      await agent.emit(reasoningEndEvent(reasoningId));
      await agent.emit(runFinishedEvent());
      await agent.complete();
    });

    it("should display 'Thought for X seconds' after reasoning completes", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      await submitMessageAndWaitForUserMessage("Reason please");

      const reasoningId = testId("reasoning");
      const textId = testId("text");

      await agent.emit(runStartedEvent());
      await emitReasoningSequence(agent, reasoningId, "Some deep thought");
      await agent.emit(textChunkEvent(textId, "Here is my answer."));
      await agent.emit(runFinishedEvent());
      await agent.complete();

      await waitFor(() => {
        expect(screen.getByText(/Thought for/)).toBeDefined();
      });
    });

    it("should accumulate content from multiple delta events", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      await submitMessageAndWaitForUserMessage("Elaborate");

      const reasoningId = testId("reasoning");

      await agent.emit(runStartedEvent());
      await agent.emit(reasoningStartEvent(reasoningId));
      await agent.emit(reasoningMessageStartEvent(reasoningId));
      await agent.emit(reasoningMessageContentEvent(reasoningId, "Part 1"));
      await agent.emit(reasoningMessageContentEvent(reasoningId, " Part 2"));
      await agent.emit(reasoningMessageContentEvent(reasoningId, " Part 3"));
      await agent.emit(reasoningMessageEndEvent(reasoningId));
      await agent.emit(reasoningEndEvent(reasoningId));

      await waitFor(() => {
        expect(screen.getByText(/Part 1 Part 2 Part 3/)).toBeDefined();
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });

    it("should render reasoning before text in a single agent run", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      await submitMessageAndWaitForUserMessage("Answer with thought");

      const reasoningId = testId("reasoning");
      const textId = testId("text");

      await agent.emit(runStartedEvent());
      await emitReasoningSequence(
        agent,
        reasoningId,
        "Thinking about the answer",
      );
      await agent.emit(textChunkEvent(textId, "The answer is 42."));
      await agent.emit(runFinishedEvent());
      await agent.complete();

      await waitFor(() => {
        expect(screen.getByText(/Thought for/)).toBeDefined();
        expect(screen.getByText("The answer is 42.")).toBeDefined();
      });

      const reasoningEl = screen
        .getByText(/Thought for/)
        .closest("[data-message-id]");
      const textEl = screen
        .getByText("The answer is 42.")
        .closest("[data-message-id]");

      if (reasoningEl && textEl) {
        const position = reasoningEl.compareDocumentPosition(textEl);
        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    });

    it("should handle reasoning-only response (no text output)", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      await submitMessageAndWaitForUserMessage("Just think");

      const reasoningId = testId("reasoning");

      await agent.emit(runStartedEvent());
      await emitReasoningSequence(
        agent,
        reasoningId,
        "Only reasoning, no text",
      );
      await agent.emit(runFinishedEvent());
      await agent.complete();

      await waitFor(() => {
        expect(screen.getByText(/Thought for/)).toBeDefined();
      });
    });

    it("should not show cursor when last message is reasoning", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      await submitMessageAndWaitForUserMessage("Think deeply");

      const reasoningId = testId("reasoning");

      await agent.emit(runStartedEvent());
      await agent.emit(reasoningStartEvent(reasoningId));
      await agent.emit(reasoningMessageStartEvent(reasoningId));
      await agent.emit(
        reasoningMessageContentEvent(reasoningId, "Deep reasoning..."),
      );

      await waitFor(() => {
        const chatLevelCursor = screen.queryByTestId("copilot-chat-cursor");
        expect(chatLevelCursor).toBeNull();
      });

      await agent.emit(reasoningMessageEndEvent(reasoningId));
      await agent.emit(reasoningEndEvent(reasoningId));
      await agent.emit(runFinishedEvent());
      await agent.complete();
    });

    it("should show cursor after reasoning when text message follows", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      await submitMessageAndWaitForUserMessage("Think then answer");

      const reasoningId = testId("reasoning");
      const textId = testId("text");

      await agent.emit(runStartedEvent());
      await emitReasoningSequence(agent, reasoningId, "Let me think first");

      await agent.emit(textChunkEvent(textId, "Starting answer..."));

      await waitFor(() => {
        expect(screen.getByText(/Starting answer/)).toBeDefined();
      });

      await waitFor(() => {
        const chatLevelCursor = screen.queryByTestId("copilot-chat-cursor");
        expect(chatLevelCursor).not.toBeNull();
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });

    it("should not auto-collapse when user manually toggled during streaming", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      await submitMessageAndWaitForUserMessage("User toggle test");

      const reasoningId = testId("reasoning");
      const textId = testId("text");

      await agent.emit(runStartedEvent());
      await agent.emit(reasoningStartEvent(reasoningId));
      await agent.emit(reasoningMessageStartEvent(reasoningId));
      await agent.emit(
        reasoningMessageContentEvent(reasoningId, "Deep analysis in progress"),
      );

      await waitFor(() => {
        const button = screen.getByText("Thinking…").closest("button");
        expect(button?.getAttribute("aria-expanded")).toBe("true");
      });

      const streamingHeaderButton = screen
        .getByText("Thinking…")
        .closest("button");
      if (streamingHeaderButton) {
        await fireEvent.click(streamingHeaderButton);
      }

      await waitFor(() => {
        const button = screen.getByText("Thinking…").closest("button");
        expect(button?.getAttribute("aria-expanded")).toBe("false");
      });

      await agent.emit(reasoningMessageEndEvent(reasoningId));
      await agent.emit(reasoningEndEvent(reasoningId));
      await agent.emit(textChunkEvent(textId, "Done."));
      await agent.emit(runFinishedEvent());
      await agent.complete();

      await waitFor(() => {
        const button = screen.getByText(/Thought for/).closest("button");
        expect(button?.getAttribute("aria-expanded")).toBe("false");
      });
    });

    it("should keep panel open when user re-expands during streaming", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      await submitMessageAndWaitForUserMessage("Re-expand toggle test");

      const reasoningId = testId("reasoning");
      const textId = testId("text");

      await agent.emit(runStartedEvent());
      await agent.emit(reasoningStartEvent(reasoningId));
      await agent.emit(reasoningMessageStartEvent(reasoningId));
      await agent.emit(
        reasoningMessageContentEvent(reasoningId, "Thinking hard"),
      );

      await waitFor(() => {
        const button = screen.getByText("Thinking…").closest("button");
        expect(button?.getAttribute("aria-expanded")).toBe("true");
      });

      const streamingHeaderButton = screen
        .getByText("Thinking…")
        .closest("button");
      if (streamingHeaderButton) {
        await fireEvent.click(streamingHeaderButton);
        await fireEvent.click(streamingHeaderButton);
      }

      await waitFor(() => {
        const button = screen.getByText("Thinking…").closest("button");
        expect(button?.getAttribute("aria-expanded")).toBe("true");
      });

      await agent.emit(reasoningMessageEndEvent(reasoningId));
      await agent.emit(reasoningEndEvent(reasoningId));
      await agent.emit(textChunkEvent(textId, "All done."));
      await agent.emit(runFinishedEvent());
      await agent.complete();

      await waitFor(() => {
        const button = screen.getByText(/Thought for/).closest("button");
        expect(button?.getAttribute("aria-expanded")).toBe("true");
      });
    });

    it("should expand and collapse reasoning content on click", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      await submitMessageAndWaitForUserMessage("Toggle test");

      const reasoningId = testId("reasoning");
      const textId = testId("text");

      await agent.emit(runStartedEvent());
      await emitReasoningSequence(
        agent,
        reasoningId,
        "This is expandable reasoning content",
      );
      await agent.emit(textChunkEvent(textId, "Done thinking."));
      await agent.emit(runFinishedEvent());
      await agent.complete();

      await waitFor(() => {
        const header = screen.getByText(/Thought for/);
        expect(header).toBeDefined();
        const button = header.closest("button");
        expect(button?.getAttribute("aria-expanded")).toBe("false");
      });

      const header = screen.getByText(/Thought for/);
      const button = header.closest("button");
      if (button) {
        await fireEvent.click(button);
      }

      await waitFor(() => {
        const expandedButton = screen
          .getByText(/Thought for/)
          .closest("button");
        expect(expandedButton?.getAttribute("aria-expanded")).toBe("true");
      });
    });
  });
});
