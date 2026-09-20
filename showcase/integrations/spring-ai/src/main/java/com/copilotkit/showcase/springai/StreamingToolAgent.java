package com.copilotkit.showcase.springai;

import com.agui.core.agent.AgentSubscriber;
import com.agui.core.agent.AgentSubscriberParams;
import com.agui.core.agent.RunAgentInput;
import com.agui.core.event.BaseEvent;
import com.agui.core.exception.AGUIException;
import com.agui.core.function.FunctionCall;
import com.agui.core.message.AssistantMessage;
import com.agui.core.message.BaseMessage;
import com.agui.core.message.Role;
import com.agui.core.message.ToolMessage;
import com.agui.core.state.State;
import com.agui.core.tool.Tool;
import com.agui.core.tool.ToolCall;
import com.copilotkit.showcase.springai.cvdiag.CvdiagBackend;
import com.copilotkit.showcase.springai.tools.GenerateA2uiTool;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import com.copilotkit.showcase.springai.cvdiag.CvdiagRunContext;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagOutcome;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.PromptChatMemoryAdvisor;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.ToolResponseMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.ToolContext;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.definition.ToolDefinition;
import org.springframework.util.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static com.agui.server.EventFactory.runErrorEvent;
import static com.agui.server.EventFactory.runFinishedEvent;
import static com.agui.server.EventFactory.runStartedEvent;
import static com.agui.server.EventFactory.textMessageContentEvent;
import static com.agui.server.EventFactory.textMessageEndEvent;
import static com.agui.server.EventFactory.textMessageStartEvent;
import static com.agui.server.EventFactory.toolCallArgsEvent;
import static com.agui.server.EventFactory.toolCallEndEvent;
import static com.agui.server.EventFactory.toolCallResultEvent;
import static com.agui.server.EventFactory.toolCallStartEvent;

/**
 * Streaming agent that advertises backend and runtime tool schemas while
 * keeping tool selection separate from execution.
 *
 * <ol>
 *   <li><b>Stream and detect:</b> The first request includes backend callbacks
 *       and runtime-provided tool definitions with
 *       {@code internalToolExecutionEnabled=false}. Text is emitted in real
 *       time; selected tool calls are captured without executing them.</li>
 *   <li><b>Preserve runtime selections:</b> If any selected call belongs to
 *       the runtime/frontend, preserve the original calls and emit their
 *       AG-UI envelopes. Execute backend-only members of a mixed selection
 *       directly with the request's tool context and emit their actual
 *       results. Runtime members remain resultless for CopilotKit to execute.
 *       Re-asking with backend-only schemas would lose those runtime calls;
 *       a backend placeholder cannot execute the real runtime handler.</li>
 *   <li><b>Backend-only Phase 2:</b> If no selected call belongs to the
 *       runtime/frontend, re-invoke the model via {@code .call()} with backend
 *       callbacks. Spring AI's internal tool loop handles execution, and the
 *       final text response is emitted as AG-UI events.</li>
 * </ol>
 *
 * <p>When no tools are selected, the streamed text is the response. Runtime
 * selections do not enter the backend-only {@code .call()} path.
 */
public class StreamingToolAgent extends PropagatingLocalAgent {

    private static final Logger log = LoggerFactory.getLogger(StreamingToolAgent.class);

    private static final ObjectMapper TOOL_SCHEMA_MAPPER = new ObjectMapper();

    private final ChatClient chatClient;
    private final ChatMemory chatMemory;
    private final List<ToolCallback> toolCallbacks;
    private final String systemMessage;

    private StreamingToolAgent(Builder builder) {
        super(builder.agentId, new State(), new ArrayList<>());
        this.chatClient = ChatClient.builder(builder.chatModel).build();
        this.chatMemory = builder.chatMemory;
        this.toolCallbacks = builder.toolCallbacks;
        this.systemMessage = builder.systemMessage;
    }

    @Override
    protected void run(RunAgentInput input, AgentSubscriber subscriber) {
        this.combineMessages(input);

        String messageId = UUID.randomUUID().toString();
        String threadId = input.threadId();
        String runId = input.runId();

        // CVDIAG backend.agent.enter (no-op when emission OFF / run unbound).
        CvdiagBackend.CvdiagRun cvdiag = CvdiagRunContext.get();
        if (cvdiag != null) {
            cvdiag.agentEnter(this.agentId, "gpt-4.1");
        }

        // RUN_STARTED must precede every terminal RUN_ERROR — AG-UI clients
        // drop a RUN_ERROR that arrives without a started run, hanging the
        // UI. Emit it BEFORE reading the user message so the no-user-message
        // / null-content error paths still terminate a started run.
        this.emitEvent(runStartedEvent(threadId, runId), subscriber);

        // Null-guard the message + content: getLatestUserMessage only throws
        // AGUIException when NO user message exists; a present-but-empty or
        // null-content message returns normally and would NPE downstream.
        // Treat empty content as a handled error.
        String userContent;
        try {
            var userMessage = this.getLatestUserMessage(messages);
            userContent = userMessage.getContent();
        } catch (AGUIException e) {
            log.error("Failed to read latest user message", e);
            this.emitEvent(runErrorEvent(String.format(
                    "agent run failed: %s (see server logs)",
                    e.getClass().getSimpleName())), subscriber);
            this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
            subscriber.onRunFinalized(
                    new AgentSubscriberParams(input.messages(), state, this, input));
            return;
        }
        if (!StringUtils.hasText(userContent)) {
            log.warn("Latest user message has null/blank content");
            this.emitEvent(runErrorEvent(
                    "agent run failed: user message was empty"), subscriber);
            this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
            subscriber.onRunFinalized(
                    new AgentSubscriberParams(input.messages(), state, this, input));
            return;
        }

        this.emitEvent(textMessageStartEvent(messageId, "assistant"), subscriber);

        var assistantMessage = new AssistantMessage();
        assistantMessage.setId(messageId);
        assistantMessage.setName(this.agentId);
        assistantMessage.setContent("");

        List<BaseEvent> deferredEvents = new ArrayList<>();

        try {
            // Phase 1: Advertise tool schemas but disable tool execution.
            // Detect selected calls while emitting text chunks in real time.
            List<DetectedToolCall> detectedToolCalls = streamFirstTurn(
                    input, userContent, messageId, assistantMessage, subscriber);

            if (!detectedToolCalls.isEmpty()) {
                // Classify tool calls as frontend vs backend.
                // A tool registered on BOTH sides (e.g. useRenderTool for
                // a backend-registered tool) is treated as FRONTEND because
                // the frontend registration means "I want to render this
                // tool's result in a custom component". The runtime will
                // re-invoke the agent with the tool result after the
                // frontend handler runs.
                Set<String> frontendToolNames = getFrontendToolNames(input);
                boolean hasFrontendToolCalls = detectedToolCalls.stream()
                        .anyMatch(tc -> frontendToolNames.contains(tc.name()));

                if (hasFrontendToolCalls) {
                    // Preserve the model's selected calls. Backend members of a
                    // mixed response execute here; runtime members remain pending
                    // for CopilotKit. Re-asking with backend-only schemas loses them.
                    GenerateA2uiTool.UiContext ui = GenerateA2uiTool.uiContext(input.context());
                    ToolContext toolContext = new ToolContext(ui == null ? Map.of()
                            : Map.of(GenerateA2uiTool.UI_CONTEXT_KEY, ui));
                    assistantMessage.setContent("");
                    try {
                        emitSelectedToolCalls(detectedToolCalls, frontendToolNames,
                                toolCallbacks, toolContext, messageId, assistantMessage,
                                subscriber, event -> this.emitEvent(event, subscriber));
                    } catch (Exception error) {
                        // Call identities and completed results were already emitted.
                        // Retain the assistant attachment before the terminal failure;
                        // do not reselect or retry any executed backend side effects.
                        subscriber.onNewMessage(assistantMessage);
                        throw error;
                    }
                } else {
                    // Backend-only tools needed.
                    // Discard the streamed text and re-invoke with .call()
                    // + tool callbacks so Spring AI's internal loop handles
                    // execution.
                    assistantMessage.setContent("");
                    callWithTools(input, userContent, messageId,
                            assistantMessage, deferredEvents, subscriber);
                }
            }
        } catch (Exception e) {
            log.error("Agent run failed", e);
            // CVDIAG backend.error.caught + sse.aborted + agent.exit: the agent
            // loop threw; record the scrubbed error and the abnormal stream
            // termination, then the terminal agent exit (err).
            if (cvdiag != null) {
                cvdiag.errorCaught(e);
                cvdiag.sseAborted("agent_exception", 0L);
                cvdiag.agentExit(CvdiagOutcome.ERR);
            }
            // textMessageStart was already emitted — close the message before
            // RUN_ERROR so subscribers tear down cleanly, then finalize so the
            // SSE stream completes (no double textMessageEnd: this path returns
            // before the happy-path textMessageEnd below).
            this.emitEvent(textMessageEndEvent(messageId), subscriber);
            this.emitEvent(runErrorEvent(String.format(
                    "agent run failed: %s (see server logs)",
                    e.getClass().getSimpleName())), subscriber);
            this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
            subscriber.onRunFinalized(
                    new AgentSubscriberParams(input.messages(), state, this, input));
            return;
        }

        // Emit tool call events BEFORE textMessageEnd so the frontend's
        // useRenderTool sees them while the message is still "open". Events
        // emitted after textMessageEnd may be missed by renderers.
        for (BaseEvent ev : deferredEvents) {
            this.emitEvent(ev, subscriber);
        }
        this.emitEvent(textMessageEndEvent(messageId), subscriber);
        subscriber.onNewMessage(assistantMessage);
        this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
        subscriber.onRunFinalized(
                new AgentSubscriberParams(input.messages(), state, this, input));
        // CVDIAG backend.agent.exit: terminal success.
        if (cvdiag != null) {
            cvdiag.agentExit(CvdiagOutcome.OK);
        }
    }

    /** Preserves selected runtime calls while executing only actual backend callbacks. */
    static void emitSelectedToolCalls(
            List<DetectedToolCall> selected, Set<String> frontendNames,
            List<ToolCallback> backendCallbacks, ToolContext toolContext,
            String messageId, AssistantMessage assistantMessage,
            AgentSubscriber subscriber, Consumer<BaseEvent> emit) {
        List<ToolCall> calls = new ArrayList<>();
        for (DetectedToolCall selectedCall : selected) {
            String id = selectedCall.id() != null ? selectedCall.id() : UUID.randomUUID().toString();
            String arguments = selectedCall.arguments() != null ? selectedCall.arguments() : "{}";
            ToolCall call = new ToolCall(id, "function", new FunctionCall(selectedCall.name(), arguments));
            calls.add(call);
            if (assistantMessage.getToolCalls() == null) {
                assistantMessage.setToolCalls(new ArrayList<>());
            }
            assistantMessage.getToolCalls().add(call);
            subscriber.onNewToolCall(call);
            emit.accept(toolCallStartEvent(messageId, selectedCall.name(), id));
            emit.accept(toolCallArgsEvent(arguments, id));
            emit.accept(toolCallEndEvent(id));
        }
        // Publish every selected identity before running side effects. Publish
        // each completed result immediately so a later failure cannot discard it.
        for (int index = 0; index < selected.size(); index++) {
            DetectedToolCall selectedCall = selected.get(index);
            if (frontendNames.contains(selectedCall.name())) {
                continue;
            }
            for (ToolCallback backend : backendCallbacks) {
                if (backend.getToolDefinition().name().equals(selectedCall.name())) {
                    String arguments = selectedCall.arguments() != null ? selectedCall.arguments() : "{}";
                    String result = backend.call(arguments, toolContext);
                    emit.accept(toolCallResultEvent(calls.get(index).id(), result,
                            UUID.randomUUID().toString(), Role.tool));
                    break;
                }
            }
        }
    }

    /** Captured tool call from the streaming phase. */
    record DetectedToolCall(String id, String name, String arguments) {}

    /**
     * Streams the first model turn with schemas from streamingToolCallbacks
     * and internal tool execution disabled. Text chunks are emitted as AG-UI
     * events in real time. Returns detected call IDs, names, and arguments
     * (empty if none) for selected-call handling or backend-only Phase 2.
     */
    private List<DetectedToolCall> streamFirstTurn(
            RunAgentInput input, String userContent, String messageId,
            AssistantMessage assistantMessage, AgentSubscriber subscriber)
            throws InterruptedException {

        StringBuilder textAccumulator = new StringBuilder();
        CopyOnWriteArrayList<DetectedToolCall> detectedToolCalls = new CopyOnWriteArrayList<>();
        AtomicReference<Throwable> streamError = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);

        // CVDIAG backend.llm.call.start + a 10s heartbeat scheduler that fires
        // backend.llm.call.heartbeat while the streaming call is outstanding
        // (verbose+ per §6). first_byte/sse.event fire on the first/each
        // streamed chunk below; the response boundary fires after the latch.
        final CvdiagBackend.CvdiagRun cvdiag = CvdiagRunContext.get();
        final long llmStart = System.currentTimeMillis();
        final java.util.concurrent.atomic.AtomicBoolean firstByteSeen =
                new java.util.concurrent.atomic.AtomicBoolean(false);
        java.util.concurrent.ScheduledExecutorService heartbeat = null;
        if (cvdiag != null) {
            cvdiag.llmCallStart("openai", "gpt-4.1", estimatePromptTokens(userContent));
            heartbeat = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "cvdiag-llm-heartbeat");
                t.setDaemon(true);
                return t;
            });
            heartbeat.scheduleAtFixedRate(cvdiag::llmHeartbeat, 10, 10,
                    java.util.concurrent.TimeUnit.SECONDS);
        }

        // Build request WITH tool definitions but with internal tool
        // execution disabled — the LLM (or aimock) needs to see the tool
        // schemas to decide whether to emit tool_calls, but we don't want
        // Spring AI's model layer to auto-execute them through the global
        // ToolCallingManager. The caller preserves runtime selections or
        // uses Phase 2 for backend-only selections.
        ChatClient.ChatClientRequestSpec request = buildBaseRequest(
                input, userContent, true);
        List<ToolCallback> streamingCallbacks = streamingToolCallbacks(toolCallbacks, input.tools());
        if (!streamingCallbacks.isEmpty()) {
            request = request.toolCallbacks(streamingCallbacks);
        }

        request.stream()
                .chatResponse()
                .subscribe(
                        evt -> {
                            if (evt.hasToolCalls()) {
                                var tcs = evt.getResult().getOutput().getToolCalls();
                                for (var tc : tcs) {
                                    detectedToolCalls.add(new DetectedToolCall(
                                            tc.id(), tc.name(), tc.arguments()));
                                }
                            }
                            String content = evt.getResult().getOutput().getText();
                            if (StringUtils.hasText(content)) {
                                // CVDIAG backend.sse.first_byte (once) +
                                // backend.sse.event (each chunk; DEBUG tier).
                                if (cvdiag != null) {
                                    if (firstByteSeen.compareAndSet(false, true)) {
                                        cvdiag.sseFirstByte();
                                    }
                                    cvdiag.sseEvent("TEXT_MESSAGE_CONTENT",
                                            content.getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
                                }
                                this.emitEvent(
                                        textMessageContentEvent(messageId, content),
                                        subscriber);
                                textAccumulator.append(content);
                            }
                        },
                        err -> {
                            streamError.set(err);
                            latch.countDown();
                        },
                        latch::countDown
                );

        boolean completed;
        try {
            completed = latch.await(120, TimeUnit.SECONDS);
        } finally {
            if (heartbeat != null) {
                heartbeat.shutdownNow();
            }
        }

        long latencyMs = System.currentTimeMillis() - llmStart;
        if (!completed) {
            if (cvdiag != null) {
                cvdiag.llmCallResponse("openai", "gpt-4.1", null, latencyMs, "TimeoutException");
            }
            throw new RuntimeException("Streaming timed out after 120 seconds");
        }

        Throwable err = streamError.get();
        if (err != null) {
            if (cvdiag != null) {
                cvdiag.llmCallResponse("openai", "gpt-4.1", null, latencyMs,
                        err.getClass().getSimpleName());
            }
            throw new RuntimeException("Streaming failed", err);
        }

        // CVDIAG backend.llm.call.response: the streamed LLM call finished. A
        // response_token_count is not exposed on the reactive stream chunks, so
        // it rides null (the closed-world keeps the optional field absent).
        if (cvdiag != null) {
            cvdiag.llmCallResponse("openai", "gpt-4.1", null, latencyMs, null);
        }

        assistantMessage.setContent(textAccumulator.toString());
        return new ArrayList<>(detectedToolCalls);
    }

    /**
     * Coarse prompt-token estimate (≈4 chars/token) for
     * {@code backend.llm.call.start.prompt_token_count_estimate}. Instrumentation
     * only — never used to alter the request.
     */
    private static int estimatePromptTokens(String userContent) {
        if (userContent == null || userContent.isEmpty()) {
            return 0;
        }
        return Math.max(1, userContent.length() / 4);
    }

    /** Advertise runtime tools without executing them inside Spring AI. */
    static List<ToolCallback> streamingToolCallbacks(
            List<ToolCallback> backendCallbacks, List<Tool> runtimeTools) {
        List<ToolCallback> callbacks = new ArrayList<>(backendCallbacks);
        Set<String> names = new HashSet<>();
        for (ToolCallback callback : backendCallbacks) {
            names.add(callback.getToolDefinition().name());
        }
        if (runtimeTools == null) {
            return callbacks;
        }
        for (Tool tool : runtimeTools) {
            if (tool == null || !StringUtils.hasText(tool.name()) || !names.add(tool.name())) {
                continue;
            }
            String schema;
            try {
                schema = TOOL_SCHEMA_MAPPER.writeValueAsString(tool.parameters());
            } catch (JsonProcessingException e) {
                throw new IllegalArgumentException("Cannot serialize runtime tool " + tool.name(), e);
            }
            ToolDefinition definition = ToolDefinition.builder()
                    .name(tool.name())
                    .description(tool.description() != null ? tool.description() : "")
                    .inputSchema(schema)
                    .build();
            callbacks.add(new ToolCallback() {
                @Override
                public ToolDefinition getToolDefinition() {
                    return definition;
                }

                @Override
                public String call(String input) {
                    throw new IllegalStateException(
                            "Runtime tool must execute through CopilotKit: " + definition.name());
                }
            });
        }
        return callbacks;
    }

    /**
     * Returns the set of tool names injected by the CopilotKit runtime
     * (frontend tools). These are tools registered on the frontend via
     * useHumanInTheLoop, useFrontendTool, etc.
     */
    private Set<String> getFrontendToolNames(RunAgentInput input) {
        Set<String> names = new HashSet<>();
        List<Tool> tools = input.tools();
        if (tools != null) {
            for (Tool tool : tools) {
                names.add(tool.name());
            }
        }
        return names;
    }

    /**
     * Re-invokes the model via .call() WITH tool callbacks. Spring AI's
     * built-in tool execution loop handles all iterations. Tool AG-UI events
     * are emitted via the wrapper callbacks.
     *
     * <p>Internal tool execution is left ENABLED here (unlike Phase 1) so
     * Spring AI's loop can execute backend tools. Frontend tools (injected
     * by the CopilotKit runtime but unknown to this agent) are handled by
     * the {@code LenientToolCallbackResolver} in
     * {@link BoundedToolCallingManagerConfig}, which returns a placeholder
     * callback instead of crashing.
     */
    private void callWithTools(
            RunAgentInput input, String userContent, String messageId,
            AssistantMessage assistantMessage, List<BaseEvent> deferredEvents,
            AgentSubscriber subscriber) {

        ChatClient.ChatClientRequestSpec request = buildBaseRequest(
                input, userContent, false);

        // Wrap each tool callback to emit AG-UI events when invoked
        if (!toolCallbacks.isEmpty()) {
            List<ToolCallback> wrapped = new ArrayList<>();
            for (ToolCallback cb : toolCallbacks) {
                wrapped.add(new AgUiToolCallbackWrapper(
                        cb, messageId, deferredEvents));
            }
            request = request.toolCallbacks(wrapped);
        }

        ChatResponse response = request.call().chatResponse();

        String text = response != null
                ? response.getResult().getOutput().getText()
                : null;
        if (StringUtils.hasText(text)) {
            this.emitEvent(textMessageContentEvent(messageId, text), subscriber);
            assistantMessage.setContent(text);
        }
    }

    /**
     * Builds a base ChatClient request with system prompt and the full
     * conversation history converted from AG-UI messages to Spring AI messages.
     *
     * <p>Including the full history (not just the latest user message) is
     * essential for multi-turn conversations, especially HITL flows where
     * the CopilotKit runtime re-invokes the agent with tool result messages.
     * Without the full history, the LLM (or aimock fixture matcher) would
     * not see the tool result and would repeat the tool call instead of
     * producing a follow-up text response.
     *
     * @param disableInternalToolExecution when {@code true}, sets
     *        {@code internalToolExecutionEnabled=false} on the request
     *        options. This prevents Spring AI's model layer from
     *        auto-executing tool calls through the global
     *        {@link org.springframework.ai.model.tool.ToolCallingManager}.
     *        Used by the streaming path (Phase 1) so that tool_calls in
     *        the stream are detected but not executed. The caller delegates
     *        runtime members and directly executes backend members of mixed
     *        selections; backend-only selections use Phase 2 via {@code .call()}.
     */
    private ChatClient.ChatClientRequestSpec buildBaseRequest(
            RunAgentInput input, String userContent,
            boolean disableInternalToolExecution) {

        // Check if the INPUT messages (not the persistent singleton messages)
        // contain tool results. If so, we need to send the full conversation
        // history so aimock (and the LLM) can see the tool result and produce
        // a follow-up text response instead of repeating the tool call. This
        // is essential for HITL re-invocation where the CopilotKit runtime
        // sends back the tool result from the frontend handler.
        List<? extends BaseMessage> inputMessages = input.messages();
        boolean hasToolResults = inputMessages != null && inputMessages.stream()
                .anyMatch(m -> m != null && m.getRole() == Role.tool);

        ChatClient.ChatClientRequestSpec request;
        if (hasToolResults) {
            List<Message> springMessages = convertMessages(inputMessages);
            request = chatClient.prompt(new Prompt(springMessages))
                    .system(systemMessage);
        } else {
            request = chatClient.prompt(
                    Prompt.builder().content(userContent).build())
                    .system(systemMessage);
        }

        GenerateA2uiTool.UiContext ui = GenerateA2uiTool.uiContext(input.context());
        if (ui != null) {
            request.system(systemMessage + "\nFor this A2UI page, call generate_a2ui with userRequest "
                    + "to generate the requested surface using the supplied catalog and facts.\n"
                    + ui.instructions());
            request.toolContext(Map.of(GenerateA2uiTool.UI_CONTEXT_KEY, ui));
        }

        if (disableInternalToolExecution) {
            request = request.options(
                    OpenAiChatOptions.builder()
                            .internalToolExecutionEnabled(false)
                            .build());
        }

        if (chatMemory != null) {
            request.advisors(PromptChatMemoryAdvisor.builder(chatMemory).build());
            request.advisors(a -> a.param(
                    ChatMemory.CONVERSATION_ID, input.threadId()));
        }

        return request;
    }

    /**
     * Converts AG-UI messages to Spring AI messages. This preserves the full
     * conversation history including assistant messages with tool calls and
     * tool result messages, which is essential for aimock fixture matching
     * (hasToolResult) and for LLMs to understand the conversation context.
     */
    private List<Message> convertMessages(List<? extends BaseMessage> aguiMessages) {
        List<Message> result = new ArrayList<>();
        if (aguiMessages == null) return result;

        for (BaseMessage msg : aguiMessages) {
            if (msg == null) continue;
            Role role = msg.getRole();
            if (role == null) continue;

            switch (role) {
                case user -> {
                    String content = msg.getContent();
                    if (StringUtils.hasText(content)) {
                        result.add(new org.springframework.ai.chat.messages.UserMessage(content));
                    }
                }
                case assistant -> {
                    if (msg instanceof AssistantMessage am) {
                        List<org.springframework.ai.chat.messages.AssistantMessage.ToolCall> springToolCalls
                                = new ArrayList<>();
                        if (am.getToolCalls() != null) {
                            for (ToolCall tc : am.getToolCalls()) {
                                springToolCalls.add(
                                    new org.springframework.ai.chat.messages.AssistantMessage.ToolCall(
                                        tc.id(),
                                        tc.type() != null ? tc.type() : "function",
                                        tc.function() != null ? tc.function().name() : "",
                                        tc.function() != null ? tc.function().arguments() : "{}"));
                            }
                        }
                        String content = am.getContent() != null ? am.getContent() : "";
                        result.add(new org.springframework.ai.chat.messages.AssistantMessage(
                                content, java.util.Map.of(), springToolCalls));
                    }
                }
                case tool -> {
                    if (msg instanceof ToolMessage tm) {
                        String toolCallId = tm.getToolCallId();
                        String content = tm.getContent() != null ? tm.getContent() : "";
                        // Spring AI uses ToolResponseMessage with ToolResponse entries
                        var response = new ToolResponseMessage.ToolResponse(
                                toolCallId != null ? toolCallId : "",
                                "",  // name not available on ToolMessage
                                content);
                        result.add(new ToolResponseMessage(List.of(response), java.util.Map.of()));
                    }
                }
                default -> {
                    // system, developer messages — skip (system is set separately)
                }
            }
        }
        return result;
    }

    /**
     * Wraps a Spring AI ToolCallback to emit AG-UI tool call events when
     * the tool is invoked during .call()'s internal tool execution loop.
     */
    static class AgUiToolCallbackWrapper implements ToolCallback {
        private final ToolCallback delegate;
        private final String parentMessageId;
        private final List<BaseEvent> deferredEvents;

        AgUiToolCallbackWrapper(ToolCallback delegate, String parentMessageId,
                                List<BaseEvent> deferredEvents) {
            this.delegate = delegate;
            this.parentMessageId = parentMessageId;
            this.deferredEvents = deferredEvents;
        }

        @Override
        public org.springframework.ai.tool.definition.ToolDefinition getToolDefinition() {
            return delegate.getToolDefinition();
        }

        @Override
        public String call(String toolInput) {
            return call(toolInput, null);
        }

        @Override
        public String call(String toolInput,
                           org.springframework.ai.chat.model.ToolContext toolContext) {
            String result = delegate.call(toolInput, toolContext);

            String toolCallId = UUID.randomUUID().toString();
            String toolName = delegate.getToolDefinition().name();

            deferredEvents.add(toolCallStartEvent(parentMessageId, toolName, toolCallId));
            deferredEvents.add(toolCallArgsEvent(toolInput, toolCallId));
            deferredEvents.add(toolCallEndEvent(toolCallId));
            // The tool result message MUST have its own unique messageId.
            // Reusing parentMessageId causes the React deduplicateMessages()
            // to overwrite the assistant message with the tool message (they
            // share the same id key in the Map), hiding the assistant text
            // from the DOM.
            String toolResultMessageId = UUID.randomUUID().toString();
            deferredEvents.add(toolCallResultEvent(
                    toolCallId, result, toolResultMessageId, Role.tool));

            return result;
        }
    }

    // -- Builder --

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String agentId;
        private ChatModel chatModel;
        private ChatMemory chatMemory;
        private String systemMessage;
        private final List<ToolCallback> toolCallbacks = new ArrayList<>();

        public Builder agentId(String agentId) {
            this.agentId = agentId;
            return this;
        }

        public Builder chatModel(ChatModel chatModel) {
            this.chatModel = chatModel;
            return this;
        }

        public Builder chatMemory(ChatMemory chatMemory) {
            this.chatMemory = chatMemory;
            return this;
        }

        public Builder systemMessage(String systemMessage) {
            this.systemMessage = systemMessage;
            return this;
        }

        public Builder toolCallback(ToolCallback toolCallback) {
            this.toolCallbacks.add(toolCallback);
            return this;
        }

        public Builder toolCallbacks(List<ToolCallback> toolCallbacks) {
            this.toolCallbacks.addAll(toolCallbacks);
            return this;
        }

        public StreamingToolAgent build() {
            if (agentId == null) {
                throw new IllegalArgumentException("agentId is required");
            }
            if (chatModel == null) {
                throw new IllegalArgumentException("chatModel is required");
            }
            if (systemMessage == null) {
                throw new IllegalArgumentException("systemMessage is required");
            }
            return new StreamingToolAgent(this);
        }
    }
}
