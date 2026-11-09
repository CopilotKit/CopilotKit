import React, { useEffect } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { z } from "zod";
import { onTestFinished } from "vitest";
import { randomUUID } from "@copilotkit/shared";
import type { ReactToolCallRenderer } from "../../../types";
import { defineToolCallRenderer } from "../../../types";
import {
  MockStepwiseAgent,
  SuggestionsProviderAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  textChunkEvent,
  toolCallChunkEvent,
  toolCallResultEvent,
  testId,
  emitSuggestionToolCall,
  emitReasoningSequence,
  reasoningStartEvent,
  reasoningMessageStartEvent,
  reasoningMessageContentEvent,
  reasoningMessageEndEvent,
  reasoningEndEvent,
} from "../../../__tests__/utils/test-helpers";
import { useConfigureSuggestions } from "../../../hooks/use-configure-suggestions";
import { useHumanInTheLoop } from "../../../hooks/use-human-in-the-loop";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChat } from "../CopilotChat";
import { CopilotChatUserMessage } from "../CopilotChatUserMessage";
import { LastUserMessageContext } from "../last-user-message-context";
import type { LastUserMessageState } from "../last-user-message-context";

describe("CopilotChat E2E - Chat Basics and Streaming Patterns", () => {
  describe("Chat Basics: text input + run", () => {
    it("should display user message and start agent run when Enter is pressed", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      // Type a message and press Enter
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Hello AI!" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // User message should appear
      await waitFor(() => {
        const userMessage = screen.getByText("Hello AI!");
        expect(userMessage).toBeDefined();
      });

      // Agent starts running
      const messageId = testId("msg");
      agent.emit(runStartedEvent());
      agent.emit(textChunkEvent(messageId, "Hello! "));
      agent.emit(textChunkEvent(messageId, "How can I help you today?"));
      agent.emit(runFinishedEvent());
      agent.complete();

      // Assistant message should accumulate
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

      // Submit a message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Tell me a story" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for user message to appear
      await waitFor(() => {
        expect(screen.getByText("Tell me a story")).toBeDefined();
      });

      const messageId = testId("msg");
      agent.emit(runStartedEvent());

      // Stream text progressively
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
  });

  describe("Single Tool Flow", () => {
    it("should handle complete tool call lifecycle", async () => {
      const agent = new MockStepwiseAgent();
      const renderToolCalls = [
        defineToolCallRenderer({
          name: "getWeather",
          args: z.object({
            location: z.string(),
            unit: z.string().optional(),
          }),
          render: ({ name, args, result, status }) => (
            <div data-testid="weather-tool">
              Tool: {name} | Status: {status} | Location: {args.location} |
              {result && ` Result: ${JSON.stringify(result)}`}
            </div>
          ),
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      renderWithCopilotKit({ agent, renderToolCalls });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "What's the weather?" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for user message to appear
      await waitFor(() => {
        expect(screen.getByText("What's the weather?")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      // Stream: RUN_STARTED → TEXT_MESSAGE_CHUNK → TOOL_CALL_CHUNK → TOOL_CALL_RESULT → RUN_FINISHED
      agent.emit(runStartedEvent());
      agent.emit(
        textChunkEvent(messageId, "Let me check the weather for you."),
      );

      // Start tool call with partial args
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "getWeather",
          parentMessageId: messageId,
          delta: '{"location":"Paris"',
        }),
      );

      // Continue streaming args
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          parentMessageId: messageId,
          delta: ',"unit":"celsius"}',
        }),
      );

      // Wait for tool to render with complete args and verify name is provided
      await waitFor(() => {
        const tool = screen.getByTestId("weather-tool");
        expect(tool.textContent).toContain("Tool: getWeather");
        expect(tool.textContent).toContain("Location: Paris");
      });

      // Send tool result
      agent.emit(
        toolCallResultEvent({
          toolCallId,
          messageId: `${messageId}_result`,
          content: JSON.stringify({ temperature: 22, condition: "Sunny" }),
        }),
      );

      // Check result appears
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
      const renderToolCalls = [
        defineToolCallRenderer({
          name: "getWeather",
          args: z.object({ location: z.string() }),
          render: ({ name, args, result }) => (
            <div data-testid={`weather-${args.location}`}>
              [{name}] Weather for {args.location}:{" "}
              {result ? JSON.stringify(result) : "Loading..."}
            </div>
          ),
        }),
        defineToolCallRenderer({
          name: "getTime",
          args: z.object({ timezone: z.string() }),
          render: ({ name, args, result }) => (
            <div data-testid={`time-${args.timezone}`}>
              [{name}] Time in {args.timezone}:{" "}
              {result ? JSON.stringify(result) : "Loading..."}
            </div>
          ),
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      renderWithCopilotKit({ agent, renderToolCalls });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Weather and time please" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for user message to appear
      await waitFor(() => {
        expect(screen.getByText("Weather and time please")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId1 = testId("tc1");
      const toolCallId2 = testId("tc2");

      agent.emit(runStartedEvent());
      agent.emit(textChunkEvent(messageId, "I'll check both for you."));

      // Start first tool call (weather) with complete JSON in one chunk
      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId1,
          toolCallName: "getWeather",
          parentMessageId: messageId,
          delta: '{"location":"London"}',
        }),
      );

      // Start second tool call (time) with complete JSON in one chunk
      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId2,
          toolCallName: "getTime",
          parentMessageId: messageId,
          delta: '{"timezone":"UTC"}',
        }),
      );

      // Both tools should render with partial/complete args
      await waitFor(() => {
        expect(screen.getByTestId("weather-London")).toBeDefined();
        expect(screen.getByTestId("time-UTC")).toBeDefined();
      });

      // Send results in different order
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

      // Both results should appear with correct names
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
      const renderToolCalls = [
        defineToolCallRenderer({
          name: "*",
          args: z.any(),
          render: ({ name, args }) => (
            <div data-testid="wildcard-renderer">
              Unknown tool: {name} with args: {JSON.stringify(args)}
            </div>
          ),
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      renderWithCopilotKit({ agent, renderToolCalls });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Do something unknown" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for user message to appear
      await waitFor(() => {
        expect(screen.getByText("Do something unknown")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      agent.emit(runStartedEvent());

      // Call an undefined tool
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "unknownTool",
          parentMessageId: messageId,
          delta: '{"param":"value"}',
        }),
      );

      // Wildcard renderer should handle it
      await waitFor(() => {
        const wildcard = screen.getByTestId("wildcard-renderer");
        expect(wildcard).toBeDefined();
        // Check that the wildcard renders with the tool name
        expect(wildcard.textContent).toContain("Unknown tool: unknownTool");
        expect(wildcard.textContent).toContain("value");
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });

    it("should use wildcard renderer without args definition", async () => {
      const agent = new MockStepwiseAgent();
      // Test that wildcard tool works without explicit args definition
      const renderToolCalls = [
        defineToolCallRenderer({
          name: "*",
          // No args field - should default to z.any()
          render: ({ name, args }) => (
            <div data-testid="wildcard-no-args">
              <span data-testid="tool-name">{name}</span>
              <span data-testid="tool-args">{JSON.stringify(args)}</span>
            </div>
          ),
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      renderWithCopilotKit({ agent, renderToolCalls });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Do something" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for user message to appear
      await waitFor(() => {
        expect(screen.getByText("Do something")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      agent.emit(runStartedEvent());

      // Call an undefined tool with a specific name
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "myCustomTool",
          parentMessageId: messageId,
          delta: '{"param":"test","value":123}',
        }),
      );

      // Wildcard renderer should receive the actual tool name, not "*"
      await waitFor(() => {
        const wildcard = screen.getByTestId("wildcard-no-args");
        expect(wildcard).toBeDefined();

        // Verify the actual tool name is passed, not "*"
        const toolName = screen.getByTestId("tool-name");
        expect(toolName.textContent).toBe("myCustomTool");
        expect(toolName.textContent).not.toBe("*");

        // Verify args are passed correctly
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
      const renderToolCalls = [
        defineToolCallRenderer({
          name: "testTool",
          args: z.object({ value: z.string() }),
          render: ({ args }) => (
            <div data-testid="test-tool">Tool: {args.value}</div>
          ),
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      renderWithCopilotKit({ agent, renderToolCalls });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Use test tool" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for user message to appear
      await waitFor(() => {
        expect(screen.getByText("Use test tool")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      agent.emit(runStartedEvent());

      // Emit tool call WITHOUT any text content
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "testTool",
          parentMessageId: messageId,
          delta: '{"value":"test"}',
        }),
      );

      // Tool call should be rendered
      await waitFor(() => {
        const toolRender = screen.getByTestId("test-tool");
        expect(toolRender).toBeDefined();
        expect(toolRender.textContent).toContain("Tool: test");
      });

      // Toolbar should NOT be visible for assistant message since it has no text content
      await waitFor(() => {
        // Find the assistant message container (it should have the tool render)
        const assistantMessageDiv = screen
          .getByTestId("test-tool")
          .closest("[data-message-id]");

        if (assistantMessageDiv) {
          // Check that within the assistant message, there's no copy button
          const copyButtonsInAssistant = assistantMessageDiv.querySelectorAll(
            "button[aria-label*='Copy' i], button[aria-label*='copy' i]",
          );
          expect(copyButtonsInAssistant.length).toBe(0);
        }
      });

      // Now emit a NEW message WITH text content
      const messageWithContentId = testId("msg2");
      agent.emit(
        textChunkEvent(
          messageWithContentId,
          "Here is some actual text content",
        ),
      );

      // Toolbar SHOULD be visible now for the message with content
      await waitFor(() => {
        const allMessages = screen.getAllByText(
          /Here is some actual text content/,
        );
        expect(allMessages.length).toBeGreaterThan(0);

        // Should now have copy button
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
      const renderToolCalls = [
        defineToolCallRenderer({
          name: "specificTool",
          args: z.object({ value: z.string() }),
          render: ({ args }) => (
            <div data-testid="specific-renderer">Specific: {args.value}</div>
          ),
        }),
        defineToolCallRenderer({
          name: "*",
          args: z.any(),
          render: ({ name }) => (
            <div data-testid="wildcard-renderer">Wildcard: {name}</div>
          ),
        }),
      ] as unknown as ReactToolCallRenderer<unknown>[];

      renderWithCopilotKit({ agent, renderToolCalls });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test specific" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for user message to appear
      await waitFor(() => {
        expect(screen.getByText("Test specific")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId1 = testId("tc1");
      const toolCallId2 = testId("tc2");

      agent.emit(runStartedEvent());

      // Call the specific tool
      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId1,
          toolCallName: "specificTool",
          parentMessageId: messageId,
          delta: '{"value":"test123"}',
        }),
      );

      // Call an unknown tool
      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId2,
          toolCallName: "unknownTool",
          parentMessageId: messageId,
          delta: '{"data":"xyz"}',
        }),
      );

      // Specific renderer should be used for specificTool
      await waitFor(() => {
        const specific = screen.getByTestId("specific-renderer");
        expect(specific).toBeDefined();
        expect(specific.textContent).toContain("test123");
      });

      // Wildcard should be used for unknownTool
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
    // Helper component to configure suggestions
    const ChatWithSuggestions: React.FC<{
      consumerAgentId: string;
      providerAgentId: string;
      instructions?: string;
      minSuggestions?: number;
      maxSuggestions?: number;
      onReady?: () => void;
    }> = ({
      consumerAgentId,
      providerAgentId,
      instructions,
      minSuggestions,
      maxSuggestions,
      onReady,
    }) => {
      useConfigureSuggestions({
        instructions: instructions || "Suggest helpful next actions",
        providerAgentId,
        consumerAgentId,
        minSuggestions: minSuggestions || 2,
        maxSuggestions: maxSuggestions || 4,
      });

      useEffect(() => {
        if (onReady) {
          onReady();
        }
      }, [onReady]);

      return <CopilotChat />;
    };

    it("should display suggestions when configured", async () => {
      const consumerAgent = new MockStepwiseAgent();
      const providerAgent = new SuggestionsProviderAgent();

      // Configure provider agent with suggestions
      providerAgent.setSuggestions([
        { title: "Option A", message: "Take action A" },
        { title: "Option B", message: "Take action B" },
      ]);

      let suggestionsReady = false;

      renderWithCopilotKit({
        agents: {
          default: consumerAgent,
          "suggestions-provider": providerAgent,
        },
        agentId: "default",
        children: (
          <div style={{ height: 400 }}>
            <ChatWithSuggestions
              consumerAgentId="default"
              providerAgentId="suggestions-provider"
              onReady={() => {
                suggestionsReady = true;
              }}
            />
          </div>
        ),
      });

      // Wait for suggestions config to be ready
      await waitFor(() => {
        expect(suggestionsReady).toBe(true);
      });

      // Submit a message to trigger suggestions
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Help me" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Wait for user message
      await waitFor(() => {
        expect(screen.getByText("Help me")).toBeDefined();
      });

      // Consumer agent responds
      const messageId = testId("msg");
      consumerAgent.emit(runStartedEvent());
      consumerAgent.emit(textChunkEvent(messageId, "I can help with that."));
      consumerAgent.emit(runFinishedEvent());
      consumerAgent.complete();

      // Wait for assistant message
      await waitFor(() => {
        expect(screen.getByText(/I can help with that/)).toBeDefined();
      });

      // Verify suggestions appear (provider agent's run() method will be called automatically)
      await waitFor(
        () => {
          expect(screen.getByText("Option A")).toBeDefined();
          expect(screen.getByText("Option B")).toBeDefined();
        },
        { timeout: 5000 },
      );

      // Click on a suggestion
      const suggestionA = screen.getByText("Option A");
      fireEvent.click(suggestionA);

      // Verify the suggestion message is added
      await waitFor(() => {
        const messages = screen.getAllByText(/Take action A/);
        expect(messages.length).toBeGreaterThan(0);
      });
    });

    it("should stream suggestion titles token by token", async () => {
      const consumerAgent = new MockStepwiseAgent();
      const providerAgent = new SuggestionsProviderAgent();

      // Configure provider agent with suggestions
      providerAgent.setSuggestions([
        { title: "First Action", message: "Do first action" },
        { title: "Second Action", message: "Do second action" },
      ]);

      let suggestionsReady = false;

      renderWithCopilotKit({
        agents: {
          default: consumerAgent,
          "suggestions-provider": providerAgent,
        },
        agentId: "default",
        children: (
          <div style={{ height: 400 }}>
            <ChatWithSuggestions
              consumerAgentId="default"
              providerAgentId="suggestions-provider"
              onReady={() => {
                suggestionsReady = true;
              }}
            />
          </div>
        ),
      });

      await waitFor(() => {
        expect(suggestionsReady).toBe(true);
      });

      // Submit a message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "What can I do?" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("What can I do?")).toBeDefined();
      });

      // Consumer agent responds
      const messageId = testId("msg");
      consumerAgent.emit(runStartedEvent());
      consumerAgent.emit(textChunkEvent(messageId, "Here are some options."));
      consumerAgent.emit(runFinishedEvent());
      consumerAgent.complete();

      // Verify both suggestions are visible after streaming completes
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

      // Configure provider agent with suggestions
      providerAgent.setSuggestions([
        { title: "Alpha", message: "Do alpha" },
        { title: "Beta", message: "Do beta" },
        { title: "Gamma", message: "Do gamma" },
      ]);

      let suggestionsReady = false;

      renderWithCopilotKit({
        agents: {
          default: consumerAgent,
          "suggestions-provider": providerAgent,
        },
        agentId: "default",
        children: (
          <div style={{ height: 400 }}>
            <ChatWithSuggestions
              consumerAgentId="default"
              providerAgentId="suggestions-provider"
              minSuggestions={3}
              maxSuggestions={5}
              onReady={() => {
                suggestionsReady = true;
              }}
            />
          </div>
        ),
      });

      await waitFor(() => {
        expect(suggestionsReady).toBe(true);
      });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Show me options" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Show me options")).toBeDefined();
      });

      // Consumer agent responds
      const messageId = testId("msg");
      consumerAgent.emit(runStartedEvent());
      consumerAgent.emit(textChunkEvent(messageId, "Here you go."));
      consumerAgent.emit(runFinishedEvent());
      consumerAgent.complete();

      // Verify all suggestions appear
      await waitFor(
        () => {
          expect(screen.getByText("Alpha")).toBeDefined();
          expect(screen.getByText("Beta")).toBeDefined();
          expect(screen.getByText("Gamma")).toBeDefined();
        },
        { timeout: 5000 },
      );
    });

    // Regression for the suggestion-path in-flight gap (deferred from PR #5195).
    // `onSubmitInput` awaits an in-flight run before dispatching, but selecting
    // a suggestion mid-run used to call runAgent() directly, pre-empting/aborting
    // the active run — the same consecutive-interrupt bug #5195 fixed for the
    // typed-Enter path. Selecting a suggestion while a run is in flight must
    // NOT abort it; the suggestion send must be QUEUED until the run settles.
    it("queues a selected suggestion until the in-flight run settles (does not abort it)", async () => {
      const consumerAgent = new MockStepwiseAgent();
      const providerAgent = new SuggestionsProviderAgent();

      providerAgent.setSuggestions([
        { title: "Option A", message: "Take action A" },
        { title: "Option B", message: "Take action B" },
      ]);

      let suggestionsReady = false;

      renderWithCopilotKit({
        agents: {
          default: consumerAgent,
          "suggestions-provider": providerAgent,
        },
        agentId: "default",
        children: (
          <div style={{ height: 400 }}>
            <ChatWithSuggestions
              consumerAgentId="default"
              providerAgentId="suggestions-provider"
              onReady={() => {
                suggestionsReady = true;
              }}
            />
          </div>
        ),
      });

      await waitFor(() => {
        expect(suggestionsReady).toBe(true);
      });

      // Prime a turn so suggestions surface.
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Help me" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      await waitFor(() => {
        expect(screen.getByText("Help me")).toBeDefined();
      });

      const messageId = testId("msg");
      consumerAgent.emit(runStartedEvent());
      consumerAgent.emit(textChunkEvent(messageId, "I can help with that."));
      consumerAgent.emit(runFinishedEvent());
      consumerAgent.complete();

      await waitFor(() => {
        expect(screen.getByText(/I can help with that/)).toBeDefined();
      });

      await waitFor(
        () => {
          expect(screen.getByText("Option A")).toBeDefined();
        },
        { timeout: 5000 },
      );

      // A new run goes in flight on the consumer agent (e.g. an interrupt
      // RESUME still streaming). Attach a controllable completion promise so
      // the suggestion send must park on it — exactly the typed-Enter contract.
      const stopSpy = vi.spyOn(consumerAgent, "abortRun");
      const addMessageSpy = vi.spyOn(consumerAgent, "addMessage");
      consumerAgent.emit(runStartedEvent());
      await waitFor(() => {
        expect(consumerAgent.isRunning).toBe(true);
      });
      let resolveInFlight: () => void = () => {};
      const inFlight = new Promise<void>((resolve) => {
        resolveInFlight = resolve;
      });
      consumerAgent.setActiveRunCompletionPromise(inFlight);

      addMessageSpy.mockClear();

      // Select a suggestion while the run is in flight.
      fireEvent.click(screen.getByText("Option A"));

      // The in-flight run was NOT aborted by selecting the suggestion.
      expect(stopSpy).not.toHaveBeenCalled();

      // The suggestion send is PARKED on the in-flight promise: not dispatched
      // and not in the transcript while the promise is unresolved. Goes RED if
      // handleSelectSuggestion dispatches immediately (the pre-fix behavior).
      await act(async () => {
        await Promise.resolve();
      });
      expect(addMessageSpy).not.toHaveBeenCalled();
      expect(screen.queryByText("Take action A")).toBeNull();

      // Release the in-flight run — only now does the queued suggestion dispatch.
      await act(async () => {
        resolveInFlight();
        await Promise.resolve();
      });
      consumerAgent.emit(runFinishedEvent());
      consumerAgent.complete();
      await waitFor(() => {
        expect(addMessageSpy).toHaveBeenCalled();
        expect(screen.getByText("Take action A")).toBeDefined();
      });
    });
  });

  describe("Reasoning Message Flow", () => {
    it("should display reasoning message with 'Thinking...' label while streaming", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      // Submit message
      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Think about this" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Think about this")).toBeDefined();
      });

      const reasoningId = testId("reasoning");

      agent.emit(runStartedEvent());
      agent.emit(reasoningStartEvent(reasoningId));
      agent.emit(reasoningMessageStartEvent(reasoningId));
      agent.emit(
        reasoningMessageContentEvent(reasoningId, "Let me analyze..."),
      );

      // "Thinking..." label should appear while streaming
      await waitFor(() => {
        expect(screen.getByText("Thinking…")).toBeDefined();
      });

      // Clean up
      agent.emit(reasoningMessageEndEvent(reasoningId));
      agent.emit(reasoningEndEvent(reasoningId));
      agent.emit(runFinishedEvent());
      agent.complete();
    });

    it("should display 'Thought for X seconds' after reasoning completes", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Reason please" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Reason please")).toBeDefined();
      });

      const reasoningId = testId("reasoning");
      const textId = testId("text");

      agent.emit(runStartedEvent());
      emitReasoningSequence(agent, reasoningId, "Some deep thought");
      agent.emit(textChunkEvent(textId, "Here is my answer."));
      agent.emit(runFinishedEvent());
      agent.complete();

      // After reasoning finishes, should show elapsed time label
      await waitFor(() => {
        expect(screen.getByText(/Thought for/)).toBeDefined();
      });
    });

    it("should accumulate content from multiple delta events", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Elaborate" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Elaborate")).toBeDefined();
      });

      const reasoningId = testId("reasoning");

      agent.emit(runStartedEvent());
      agent.emit(reasoningStartEvent(reasoningId));
      agent.emit(reasoningMessageStartEvent(reasoningId));
      agent.emit(reasoningMessageContentEvent(reasoningId, "Part 1"));
      agent.emit(reasoningMessageContentEvent(reasoningId, " Part 2"));
      agent.emit(reasoningMessageContentEvent(reasoningId, " Part 3"));
      agent.emit(reasoningMessageEndEvent(reasoningId));
      agent.emit(reasoningEndEvent(reasoningId));

      // The accumulated content should be present
      await waitFor(() => {
        expect(screen.getByText(/Part 1 Part 2 Part 3/)).toBeDefined();
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });

    it("should render reasoning before text in a single agent run", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Answer with thought" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Answer with thought")).toBeDefined();
      });

      const reasoningId = testId("reasoning");
      const textId = testId("text");

      agent.emit(runStartedEvent());
      emitReasoningSequence(agent, reasoningId, "Thinking about the answer");
      agent.emit(textChunkEvent(textId, "The answer is 42."));
      agent.emit(runFinishedEvent());
      agent.complete();

      // Both should appear
      await waitFor(() => {
        expect(screen.getByText(/Thought for/)).toBeDefined();
        expect(screen.getByText("The answer is 42.")).toBeDefined();
      });

      // Reasoning should come before text in the DOM
      const reasoningEl = screen
        .getByText(/Thought for/)
        .closest("[data-message-id]");
      const textEl = screen
        .getByText("The answer is 42.")
        .closest("[data-message-id]");

      if (reasoningEl && textEl) {
        // Use compareDocumentPosition to verify ordering
        const position = reasoningEl.compareDocumentPosition(textEl);
        // DOCUMENT_POSITION_FOLLOWING means textEl comes after reasoningEl
        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    });

    it("should handle reasoning-only response (no text output)", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Just think" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Just think")).toBeDefined();
      });

      const reasoningId = testId("reasoning");

      agent.emit(runStartedEvent());
      emitReasoningSequence(agent, reasoningId, "Only reasoning, no text");
      agent.emit(runFinishedEvent());
      agent.complete();

      // Reasoning message should appear
      await waitFor(() => {
        expect(screen.getByText(/Thought for/)).toBeDefined();
      });
    });

    it("should not show cursor when last message is reasoning", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Think deeply" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Think deeply")).toBeDefined();
      });

      const reasoningId = testId("reasoning");

      agent.emit(runStartedEvent());
      agent.emit(reasoningStartEvent(reasoningId));
      agent.emit(reasoningMessageStartEvent(reasoningId));
      agent.emit(
        reasoningMessageContentEvent(reasoningId, "Deep reasoning..."),
      );

      // "Thinking..." should appear (reasoning is streaming)
      await waitFor(() => {
        expect(screen.getByText("Thinking…")).toBeDefined();
      });

      // Chat-level cursor (pulsing dot) should NOT be visible when last message is reasoning
      // The cursor has animate-pulse-cursor class
      const cursors = document.querySelectorAll(".cpk\\:animate-pulse-cursor");
      // Only the reasoning indicator should be present, not the chat-level cursor
      // The chat-level cursor is a direct child of the message view container
      const chatLevelCursor = document.querySelector(
        ".cpk\\:flex.cpk\\:flex-col > .cpk\\:mt-2 .cpk\\:animate-pulse-cursor",
      );
      expect(chatLevelCursor).toBeNull();

      // Clean up
      agent.emit(reasoningMessageEndEvent(reasoningId));
      agent.emit(reasoningEndEvent(reasoningId));
      agent.emit(runFinishedEvent());
      agent.complete();
    });

    it("should show cursor after reasoning when text message follows", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Think then answer" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Think then answer")).toBeDefined();
      });

      const reasoningId = testId("reasoning");
      const textId = testId("text");

      agent.emit(runStartedEvent());
      emitReasoningSequence(agent, reasoningId, "Let me think first");

      // Now start streaming text - text is now the last message, cursor should show
      agent.emit(textChunkEvent(textId, "Starting answer..."));

      await waitFor(() => {
        expect(screen.getByText(/Starting answer/)).toBeDefined();
      });

      // Chat-level cursor should now be visible since last message is text (not reasoning)
      // Note: The cursor shows while isRunning=true and last message is not reasoning
      await waitFor(() => {
        const chatLevelCursor = document.querySelector(
          ".cpk\\:animate-pulse-cursor",
        );
        expect(chatLevelCursor).not.toBeNull();
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });

    it("should not auto-collapse when user manually toggled during streaming", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "User toggle test" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("User toggle test")).toBeDefined();
      });

      const reasoningId = testId("reasoning");
      const textId = testId("text");

      // Start streaming reasoning — panel should auto-open
      agent.emit(runStartedEvent());
      agent.emit(reasoningStartEvent(reasoningId));
      agent.emit(reasoningMessageStartEvent(reasoningId));
      agent.emit(
        reasoningMessageContentEvent(reasoningId, "Deep analysis in progress"),
      );

      await waitFor(() => {
        expect(screen.getByText("Thinking…")).toBeDefined();
      });

      // Panel should be open (aria-expanded="true") while streaming
      await waitFor(() => {
        const header = screen.getByText("Thinking…");
        const button = header.closest("button");
        expect(button?.getAttribute("aria-expanded")).toBe("true");
      });

      // User manually collapses during streaming — this sets userToggledRef
      const header = screen.getByText("Thinking…");
      const button = header.closest("button");
      act(() => {
        if (button) {
          fireEvent.click(button);
        }
      });

      // Should now be collapsed by user action
      await waitFor(() => {
        const btn = screen.getByText("Thinking…").closest("button");
        expect(btn?.getAttribute("aria-expanded")).toBe("false");
      });

      // Now streaming ends — because userToggledRef is true, the panel
      // should stay in whatever state the user set (collapsed).
      agent.emit(reasoningMessageEndEvent(reasoningId));
      agent.emit(reasoningEndEvent(reasoningId));
      agent.emit(textChunkEvent(textId, "Done."));
      agent.emit(runFinishedEvent());
      agent.complete();

      // Panel should remain collapsed (not flash open then closed)
      await waitFor(() => {
        const btn = screen.getByText(/Thought for/).closest("button");
        expect(btn?.getAttribute("aria-expanded")).toBe("false");
      });
    });

    it("should keep panel open when user re-expands during streaming", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, {
        target: { value: "Re-expand toggle test" },
      });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Re-expand toggle test")).toBeDefined();
      });

      const reasoningId = testId("reasoning");
      const textId = testId("text");

      // Start streaming reasoning — panel auto-opens
      agent.emit(runStartedEvent());
      agent.emit(reasoningStartEvent(reasoningId));
      agent.emit(reasoningMessageStartEvent(reasoningId));
      agent.emit(reasoningMessageContentEvent(reasoningId, "Thinking hard"));

      await waitFor(() => {
        const btn = screen.getByText("Thinking…").closest("button");
        expect(btn?.getAttribute("aria-expanded")).toBe("true");
      });

      // User collapses, then re-expands (both set userToggledRef = true)
      const headerEl = screen.getByText("Thinking…");
      const btn = headerEl.closest("button");
      act(() => {
        if (btn) {
          fireEvent.click(btn); // collapse
          fireEvent.click(btn); // re-expand
        }
      });

      await waitFor(() => {
        const b = screen.getByText("Thinking…").closest("button");
        expect(b?.getAttribute("aria-expanded")).toBe("true");
      });

      // Streaming ends — because userToggledRef is true, panel should
      // stay in the user's chosen state (open).
      agent.emit(reasoningMessageEndEvent(reasoningId));
      agent.emit(reasoningEndEvent(reasoningId));
      agent.emit(textChunkEvent(textId, "All done."));
      agent.emit(runFinishedEvent());
      agent.complete();

      // Panel should remain open (not auto-collapse)
      await waitFor(() => {
        const b = screen.getByText(/Thought for/).closest("button");
        expect(b?.getAttribute("aria-expanded")).toBe("true");
      });
    });

    it("should expand and collapse reasoning content on click", async () => {
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Toggle test" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Toggle test")).toBeDefined();
      });

      const reasoningId = testId("reasoning");
      const textId = testId("text");

      agent.emit(runStartedEvent());
      emitReasoningSequence(
        agent,
        reasoningId,
        "This is expandable reasoning content",
      );
      agent.emit(textChunkEvent(textId, "Done thinking."));
      agent.emit(runFinishedEvent());
      agent.complete();

      // After reasoning finishes, it should auto-collapse
      await waitFor(() => {
        const header = screen.getByText(/Thought for/);
        expect(header).toBeDefined();
        // The header's button should have aria-expanded="false" after collapsing
        const button = header.closest("button");
        expect(button?.getAttribute("aria-expanded")).toBe("false");
      });

      // Click to expand — wrap in act() so React 18 flushes the state
      // update synchronously instead of deferring it through the scheduler,
      // which can race with waitFor polling on slow CI runners.
      const header = screen.getByText(/Thought for/);
      const button = header.closest("button");
      act(() => {
        if (button) {
          fireEvent.click(button);
        }
      });

      // Should now be expanded
      await waitFor(() => {
        const expandedButton = screen
          .getByText(/Thought for/)
          .closest("button");
        expect(expandedButton?.getAttribute("aria-expanded")).toBe("true");
      });
    });
  });

  describe("Enter routing while a background run is in flight", () => {
    // The shared test setup mocks randomUUID to one constant. Queued messages
    // are told apart by id, so tests that rely on that hand out distinct ids
    // and restore the constant when they finish.
    const useDistinctIds = () => {
      let next = 0;
      vi.mocked(randomUUID).mockImplementation(() => `uuid-${++next}`);
      onTestFinished(() => {
        vi.mocked(randomUUID).mockImplementation(() => "mock-thread-id");
      });
    };

    // Repro for the consecutive-interrupt bug: in gen-ui-interrupt, the
    // user picks turn-1's time slot, which flips the card to "Booked"
    // immediately, then resolves the interrupt ~500ms later — kicking off
    // a resume run that streams the confirmation. While that resume run is
    // still in flight (`agent.isRunning === true`), the user types a brand
    // new message (turn-2's pill) and presses Enter. Enter MUST send the
    // new message, not be hijacked into stopping the in-flight run — the
    // composer has sendable text, so the user's clear intent is "send".
    it("routes Enter to send (not stop) while a run is in flight, queuing the new message until the run settles", async () => {
      useDistinctIds();
      const agent = new MockStepwiseAgent();
      const stopSpy = vi.spyOn(agent, "abortRun");
      const addMessageSpy = vi.spyOn(agent, "addMessage");
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");

      // Turn 1: send a message, agent starts running.
      fireEvent.change(input, { target: { value: "Book a sales call" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      await waitFor(() => {
        expect(screen.getByText("Book a sales call")).toBeDefined();
      });

      // The (resume) run is in flight: RUN_STARTED but NOT yet finished —
      // `agent.isRunning` is true (exactly the turn-2-Enter window).
      agent.emit(runStartedEvent());
      await waitFor(() => {
        expect(agent.isRunning).toBe(true);
      });

      // Open the await window: attach a controllable completion promise to the
      // in-flight run. `onSubmitInput` awaits THIS before dispatching the new
      // message, so the queued send must NOT land until we resolve it. Without
      // this the await-branch is skipped entirely and the test would pass even
      // if the whole await-block were deleted (false confidence). Attached
      // AFTER the run is in flight so the run setup does not overwrite it.
      let resolveInFlight: () => void = () => {};
      const inFlight = new Promise<void>((resolve) => {
        resolveInFlight = resolve;
      });
      agent.setActiveRunCompletionPromise(inFlight);

      addMessageSpy.mockClear();

      // Turn 2: the user composes a brand-new message and presses Enter while
      // the run is still active. A non-empty composer is unambiguous "send"
      // intent — Enter must NOT route to onStop (the pre-fix bug aborted the
      // run and swallowed the message). Instead the new message is QUEUED:
      // CopilotChat awaits the in-flight run's completion before sending, so
      // an interrupt RESUME finishes (graph completes) before the new turn
      // starts a fresh run — the fix for the 2nd interrupt's card never
      // mounting.
      fireEvent.change(input, {
        target: { value: "Schedule a 1:1 with Alice" },
      });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // The in-flight run was NOT stopped/aborted by the Enter press.
      expect(stopSpy).not.toHaveBeenCalled();
      // The composer cleared immediately (the send was accepted, not routed
      // to stop), even though the actual dispatch is deferred until the run
      // settles.
      await waitFor(() => {
        expect((input as HTMLTextAreaElement).value).toBe("");
      });

      // The queued message is PARKED on the in-flight promise: it has NOT been
      // dispatched (addMessage not called) and is shown optimistically in the
      // transcript (so it never looks lost) while the promise is unresolved.
      // This is the actual await-path assertion — it goes RED if
      // onSubmitInput's await-block is removed (the message would dispatch
      // immediately).
      await act(async () => {
        await Promise.resolve();
      });
      expect(addMessageSpy).not.toHaveBeenCalled();
      expect(screen.getAllByText("Schedule a 1:1 with Alice")).toHaveLength(1);

      // Release the in-flight run — only now does the queued message dispatch.
      await act(async () => {
        resolveInFlight();
        await Promise.resolve();
      });
      agent.emit(runFinishedEvent());
      agent.complete();
      await waitFor(() => {
        expect(addMessageSpy).toHaveBeenCalled();
        // Queued placeholder is replaced by the real message — never doubled.
        expect(screen.getAllByText("Schedule a 1:1 with Alice")).toHaveLength(
          1,
        );
      });
    });

    it("shows messages queued behind an in-flight run once each, in submission order", async () => {
      useDistinctIds();
      const agent = new MockStepwiseAgent();
      const addMessageSpy = vi.spyOn(agent, "addMessage");
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");

      fireEvent.change(input, { target: { value: "Book a sales call" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      await waitFor(() => {
        expect(screen.getByText("Book a sales call")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      await waitFor(() => {
        expect(agent.isRunning).toBe(true);
      });

      let resolveInFlight!: () => void;
      const inFlight = new Promise<void>((resolve) => {
        resolveInFlight = resolve;
      });
      agent.setActiveRunCompletionPromise(inFlight);

      addMessageSpy.mockClear();

      fireEvent.change(input, { target: { value: "First queued" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      fireEvent.change(input, { target: { value: "Second queued" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await act(async () => {
        await Promise.resolve();
      });
      expect(addMessageSpy).not.toHaveBeenCalled();
      const firstShown = screen.getAllByText("First queued");
      const secondShown = screen.getAllByText("Second queued");
      expect(firstShown).toHaveLength(1);
      expect(secondShown).toHaveLength(1);
      expect(
        firstShown[0]!.compareDocumentPosition(secondShown[0]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      await act(async () => {
        resolveInFlight();
        await Promise.resolve();
      });
      agent.emit(runFinishedEvent());
      agent.complete();
      await waitFor(() => {
        expect(addMessageSpy).toHaveBeenCalled();
      });
      expect(addMessageSpy.mock.calls[0]![0]).toMatchObject({
        content: "First queued",
      });
      expect(screen.getAllByText("First queued")).toHaveLength(1);
      // Dispatching the first never hides the second, still waiting its turn.
      expect(screen.getAllByText("Second queued")).toHaveLength(1);
    });

    it("keeps the queued message's id when it is dispatched", async () => {
      useDistinctIds();
      const agent = new MockStepwiseAgent();
      const addMessageSpy = vi.spyOn(agent, "addMessage");
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");

      fireEvent.change(input, { target: { value: "Book a sales call" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      await waitFor(() => {
        expect(screen.getByText("Book a sales call")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      await waitFor(() => {
        expect(agent.isRunning).toBe(true);
      });

      let resolveInFlight!: () => void;
      const inFlight = new Promise<void>((resolve) => {
        resolveInFlight = resolve;
      });
      agent.setActiveRunCompletionPromise(inFlight);

      addMessageSpy.mockClear();

      fireEvent.change(input, { target: { value: "Keep my id" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await act(async () => {
        await Promise.resolve();
      });
      const queuedId = screen
        .getByText("Keep my id")
        .closest("[data-message-id]")
        ?.getAttribute("data-message-id");
      expect(typeof queuedId).toBe("string");
      expect(queuedId).not.toBe("");

      await act(async () => {
        resolveInFlight();
        await Promise.resolve();
      });
      agent.emit(runFinishedEvent());
      agent.complete();
      await waitFor(() => {
        expect(addMessageSpy).toHaveBeenCalled();
      });
      expect(addMessageSpy.mock.calls[0]![0].id).toBe(queuedId);
    });

    it("pins a queued message when it is accepted", async () => {
      useDistinctIds();
      const pins: LastUserMessageState[] = [];
      const PinRecordingUserMessage = (
        props: React.ComponentProps<typeof CopilotChatUserMessage>,
      ) => {
        const pin = React.useContext(LastUserMessageContext);
        useEffect(() => {
          pins.push(pin);
        }, [pin]);
        return <CopilotChatUserMessage {...props} />;
      };
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({
        agent,
        children: (
          <div style={{ height: 400 }}>
            <CopilotChat
              welcomeScreen={false}
              messageView={{
                userMessage:
                  PinRecordingUserMessage as typeof CopilotChatUserMessage,
              }}
            />
          </div>
        ),
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Book a sales call" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      await waitFor(() => {
        expect(screen.getByText("Book a sales call")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      await waitFor(() => {
        expect(agent.isRunning).toBe(true);
      });
      agent.setActiveRunCompletionPromise(new Promise<void>(() => {}));
      const nonceBeforeQueue = pins[pins.length - 1]!.sendNonce;

      fireEvent.change(input, { target: { value: "Pin me" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      await waitFor(() => {
        expect(screen.getByText("Pin me")).toBeDefined();
      });
      const queuedId = screen
        .getByText("Pin me")
        .closest("[data-message-id]")
        ?.getAttribute("data-message-id");

      // The run never settles, so the message is still only queued.
      await waitFor(() => {
        const latest = pins[pins.length - 1]!;
        expect(latest.id).toBe(queuedId);
        expect(latest.sendNonce).toBeGreaterThan(nonceBeforeQueue);
      });
    });

    it("drops a queued message's placeholder when the thread switches", async () => {
      const agent = new MockStepwiseAgent();

      const { rerender } = render(
        <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
          <CopilotChatConfigurationProvider
            threadId="thread-A"
            hasExplicitThreadId={false}
          >
            <CopilotChat welcomeScreen={false} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      const input = await screen.findByRole("textbox");

      agent.emit(runStartedEvent());
      await waitFor(() => {
        expect(agent.isRunning).toBe(true);
      });

      // Never resolved: the queued send stays parked on thread A.
      agent.setActiveRunCompletionPromise(new Promise<void>(() => {}));

      fireEvent.change(input, { target: { value: "Left behind on A" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getAllByText("Left behind on A")).toHaveLength(1);

      rerender(
        <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
          <CopilotChatConfigurationProvider
            threadId="thread-B"
            hasExplicitThreadId={false}
          >
            <CopilotChat welcomeScreen={false} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      await waitFor(() =>
        expect(screen.queryByText("Left behind on A")).toBeNull(),
      );
    });

    it("pins the earlier queued message when it is dispatched, not the last one queued", async () => {
      useDistinctIds();
      const pins: LastUserMessageState[] = [];
      const PinRecorder = () => {
        const pin = React.useContext(LastUserMessageContext);
        useEffect(() => {
          pins.push(pin);
        }, [pin]);
        return null;
      };
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({
        agent,
        children: (
          <div style={{ height: 400 }}>
            <CopilotChat
              welcomeScreen={false}
              input={{ disclaimer: PinRecorder }}
            />
          </div>
        ),
      });

      const input = await screen.findByRole("textbox");
      agent.emit(runStartedEvent());
      await waitFor(() => {
        expect(agent.isRunning).toBe(true);
      });
      let resolveInFlight!: () => void;
      agent.setActiveRunCompletionPromise(
        new Promise<void>((resolve) => {
          resolveInFlight = resolve;
        }),
      );

      fireEvent.change(input, { target: { value: "First queued" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      fireEvent.change(input, { target: { value: "Second queued" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      const idOf = (text: string) =>
        screen
          .getByText(text)
          .closest("[data-message-id]")
          ?.getAttribute("data-message-id");
      await waitFor(() => {
        expect(pins[pins.length - 1]!.id).toBe(idOf("Second queued"));
      });
      const firstId = idOf("First queued");
      const nonceWhenBothQueued = pins[pins.length - 1]!.sendNonce;

      await act(async () => {
        resolveInFlight();
        await Promise.resolve();
      });

      // The first message's send pins the first message, whose reply comes
      // next; the second is still waiting below it.
      await waitFor(() => {
        expect(pins[pins.length - 1]).toEqual({
          id: firstId,
          sendNonce: nonceWhenBothQueued + 1,
        });
      });
    });

    it("does not pin when a queued message is dropped unsent", async () => {
      const pins: LastUserMessageState[] = [];
      // The input's disclaimer renders whether or not any message does.
      const PinRecorder = () => {
        const pin = React.useContext(LastUserMessageContext);
        useEffect(() => {
          pins.push(pin);
        }, [pin]);
        return null;
      };
      const agent = new MockStepwiseAgent();
      const chatOn = (threadId: string) => (
        <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
          <CopilotChatConfigurationProvider
            threadId={threadId}
            hasExplicitThreadId={false}
          >
            <CopilotChat
              welcomeScreen={false}
              input={{ disclaimer: PinRecorder }}
            />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      );

      const { rerender } = render(chatOn("thread-A"));
      const input = await screen.findByRole("textbox");

      agent.emit(runStartedEvent());
      await waitFor(() => {
        expect(agent.isRunning).toBe(true);
      });
      // Never resolved: the queued send stays parked on thread A.
      agent.setActiveRunCompletionPromise(new Promise<void>(() => {}));

      fireEvent.change(input, { target: { value: "Left behind on A" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      await waitFor(() => {
        expect(pins[pins.length - 1]!.id).not.toBeNull();
      });
      const pinWhenQueued = pins[pins.length - 1]!;

      rerender(chatOn("thread-B"));
      await waitFor(() =>
        expect(screen.queryByText("Left behind on A")).toBeNull(),
      );
      await act(async () => {
        await Promise.resolve();
      });

      expect(pins[pins.length - 1]).toEqual(pinWhenQueued);
    });

    it("mounts an idle send's message once, never as a queued copy first", async () => {
      const mounts: string[] = [];
      const CountingUserMessage = (
        props: React.ComponentProps<typeof CopilotChatUserMessage>,
      ) => {
        useEffect(() => {
          mounts.push("mount");
          return () => {
            mounts.push("unmount");
          };
        }, []);
        return <CopilotChatUserMessage {...props} />;
      };
      const agent = new MockStepwiseAgent();
      renderWithCopilotKit({
        agent,
        children: (
          <div style={{ height: 400 }}>
            <CopilotChat
              welcomeScreen={false}
              messageView={{
                userMessage:
                  CountingUserMessage as typeof CopilotChatUserMessage,
              }}
            />
          </div>
        ),
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Hello AI!" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      await waitFor(() => {
        expect(screen.getByText("Hello AI!")).toBeDefined();
      });
      await act(async () => {
        await Promise.resolve();
      });

      // Nothing was in flight, so the message went straight to the agent.
      expect(mounts).toEqual(["mount"]);
    });

    it("shows a message sent while a confirmation card is pending, and sends it once the card is answered", async () => {
      useDistinctIds();
      const agent = new MockStepwiseAgent();
      const addMessageSpy = vi.spyOn(agent, "addMessage");

      const ConfirmationTool = () => {
        useHumanInTheLoop({
          name: "confirmCall",
          description: "Asks the user to confirm",
          parameters: z.object({ when: z.string() }),
          render: ({ respond }) =>
            respond ? (
              <button
                data-testid="confirm-call"
                onClick={() => respond(JSON.stringify({ confirmed: true }))}
              >
                Confirm
              </button>
            ) : null,
        });
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <ConfirmationTool />
            <div style={{ height: 400 }}>
              <CopilotChat welcomeScreen={false} />
            </div>
          </>
        ),
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Book a sales call" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      await waitFor(() => {
        expect(screen.getByText("Book a sales call")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId: testId("tc"),
          toolCallName: "confirmCall",
          parentMessageId: testId("msg"),
          delta: JSON.stringify({ when: "tomorrow" }),
        }),
      );
      agent.emit(runFinishedEvent());
      agent.complete();

      const confirm = await screen.findByTestId("confirm-call");
      // The run itself has ended; only the card holds the chat.
      expect(agent.isRunning).toBe(false);
      addMessageSpy.mockClear();

      fireEvent.change(input, { target: { value: "Make it 3pm" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getAllByText("Make it 3pm")).toHaveLength(1);
      expect(addMessageSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ content: "Make it 3pm" }),
      );

      fireEvent.click(confirm);
      await waitFor(() => {
        expect(addMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({ content: "Make it 3pm" }),
        );
      });
      expect(screen.getAllByText("Make it 3pm")).toHaveLength(1);
    });

    it("still routes Enter to stop when the composer is empty during a run", async () => {
      const agent = new MockStepwiseAgent();
      const stopSpy = vi.spyOn(agent, "abortRun");
      renderWithCopilotKit({ agent });

      const input = await screen.findByRole("textbox");

      // Send a message; agent starts running.
      fireEvent.change(input, { target: { value: "Tell me a story" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      await waitFor(() => {
        expect(screen.getByText("Tell me a story")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      await waitFor(() => {
        expect(agent.isRunning).toBe(true);
      });

      // Composer is empty — Enter should stop the genuinely-running agent.
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(stopSpy).toHaveBeenCalled();
      });
    });
  });
});
