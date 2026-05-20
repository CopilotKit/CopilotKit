package com.copilotkit.showcase.springai;

// @region[state-streaming-middleware]
import com.agui.core.agent.AgentSubscriber;
import com.agui.core.agent.AgentSubscriberParams;
import com.agui.core.agent.RunAgentInput;
import com.agui.core.event.BaseEvent;
import com.agui.core.exception.AGUIException;
import com.agui.core.function.FunctionCall;
import com.agui.core.message.AssistantMessage;
import com.agui.core.message.Role;
import com.agui.core.state.State;
import com.agui.core.tool.ToolCall;
import com.agui.server.LocalAgent;
import com.agui.server.spring.AgUiParameters;
import com.agui.server.spring.AgUiService;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.util.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.function.FunctionToolCallback;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static com.agui.server.EventFactory.runErrorEvent;
import static com.agui.server.EventFactory.runFinishedEvent;
import static com.agui.server.EventFactory.runStartedEvent;
import static com.agui.server.EventFactory.stateSnapshotEvent;
import static com.agui.server.EventFactory.textMessageContentEvent;
import static com.agui.server.EventFactory.textMessageEndEvent;
import static com.agui.server.EventFactory.textMessageStartEvent;
import static com.agui.server.EventFactory.toolCallArgsEvent;
import static com.agui.server.EventFactory.toolCallEndEvent;
import static com.agui.server.EventFactory.toolCallResultEvent;
import static com.agui.server.EventFactory.toolCallStartEvent;

/**
 * Shared State Streaming demo — dedicated controller at
 * {@code /shared-state-streaming/run}.
 *
 * Demonstrates per-token state streaming for Spring AI, mirroring the
 * LangGraph Python reference's {@code StateStreamingMiddleware} pattern.
 * The agent has a {@code write_document} tool. As the LLM streams the
 * tool-call arguments for {@code write_document.content}, this controller
 * detects the growing argument string, extracts the partial content value,
 * and emits {@code STATE_SNAPSHOT} events with the growing document text.
 * The frontend's {@code useAgent({ updates: [OnStateChanged] })} subscription
 * re-renders on each snapshot, producing per-token document updates.
 *
 * <p><b>Implementation approach:</b> Spring AI's {@code ChatClient.stream()}
 * delivers accumulated tool call arguments across chunks. On each chunk that
 * carries tool call data for {@code write_document}, we extract the partial
 * value of the {@code content} JSON key and emit a {@code STATE_SNAPSHOT}
 * with the growing document. This avoids the need for the AG-UI Java SDK
 * to support {@code StateDeltaEvent} with a {@code delta} field (the current
 * SDK version has an empty {@code StateDeltaEvent} class with no payload).
 */
@RestController
public class SharedStateStreamingController {

    private static final Logger log =
            LoggerFactory.getLogger(SharedStateStreamingController.class);

    private static final String AGENT_ID = "shared-state-streaming";

    private final AgUiService agUiService;
    private final ChatModel chatModel;

    @Autowired
    public SharedStateStreamingController(AgUiService agUiService, ChatModel chatModel) {
        this.agUiService = agUiService;
        this.chatModel = chatModel;
    }

    @PostMapping("/shared-state-streaming/run")
    public ResponseEntity<SseEmitter> run(@RequestBody AgUiParameters params) throws Exception {
        MessageListFilter.filterNulls(params);
        SharedStateStreamingAgent agent = new SharedStateStreamingAgent(chatModel);
        SseEmitter emitter = agUiService.runAgent(agent, params);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }

    /**
     * Per-request agent that streams tool call arguments and emits
     * STATE_SNAPSHOT events as the {@code write_document.content} argument
     * grows token-by-token.
     */
    static class SharedStateStreamingAgent extends LocalAgent {

        private final ChatClient chatClient;

        SharedStateStreamingAgent(ChatModel chatModel) throws AGUIException {
            super(AGENT_ID, new State(), new ArrayList<>());
            this.chatClient = ChatClient.builder(chatModel).build();
        }

        @Override
        protected void run(RunAgentInput input, AgentSubscriber subscriber) {
            this.combineMessages(input);

            String messageId = UUID.randomUUID().toString();
            String threadId = input.threadId();
            String runId = input.runId();

            State runState = input.state() != null ? input.state() : new State();
            this.state = runState;

            String userContent;
            try {
                userContent = this.getLatestUserMessage(messages).getContent();
            } catch (AGUIException e) {
                log.error("Failed to read latest user message", e);
                this.emitEvent(runErrorEvent(String.format(
                        "agent run failed: %s (see server logs)",
                        e.getClass().getSimpleName())), subscriber);
                return;
            }

            this.emitEvent(runStartedEvent(threadId, runId), subscriber);

            AssistantMessage assistantMessage = new AssistantMessage();
            assistantMessage.setId(messageId);
            assistantMessage.setName(this.agentId);
            assistantMessage.setContent("");

            this.emitEvent(textMessageStartEvent(messageId, "assistant"), subscriber);

            List<BaseEvent> deferredEvents = new ArrayList<>();

            try {
                streamWithStateUpdates(input, userContent, messageId, runState,
                        assistantMessage, deferredEvents, subscriber);
            } catch (Exception e) {
                log.error("Agent run failed", e);
                this.emitEvent(runErrorEvent(String.format(
                        "agent run failed: %s (see server logs)",
                        e.getClass().getSimpleName())), subscriber);
                return;
            }

            // Emit tool call events BEFORE textMessageEnd so the frontend sees
            // them while the message is still "open".
            for (BaseEvent ev : deferredEvents) {
                this.emitEvent(ev, subscriber);
            }
            this.emitEvent(textMessageEndEvent(messageId), subscriber);
            subscriber.onNewMessage(assistantMessage);
            this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
            subscriber.onRunFinalized(
                    new AgentSubscriberParams(input.messages(), runState, this, input));
        }

        /**
         * Streams the LLM response with tool execution disabled. When the model
         * generates a {@code write_document} tool call, the growing arguments
         * string is parsed per-chunk to extract the partial {@code content}
         * value, and a {@code STATE_SNAPSHOT} is emitted for each increment.
         *
         * <p>This produces the per-token state-streaming effect: the frontend
         * sees {@code state.document} grow character-by-character as the LLM
         * generates the tool call arguments.
         */
        private void streamWithStateUpdates(
                RunAgentInput input, String userContent, String messageId,
                State runState, AssistantMessage assistantMessage,
                List<BaseEvent> deferredEvents, AgentSubscriber subscriber)
                throws InterruptedException {

            StringBuilder textAccumulator = new StringBuilder();
            AtomicReference<Throwable> streamError = new AtomicReference<>();
            CountDownLatch latch = new CountDownLatch(1);

            // Track the write_document tool call arguments as they accumulate
            AtomicReference<String> lastDocContent = new AtomicReference<>("");
            CopyOnWriteArrayList<DetectedToolCall> detectedToolCalls = new CopyOnWriteArrayList<>();

            // Register the write_document tool so the model knows about it,
            // but disable internal tool execution so Spring AI doesn't
            // auto-invoke it. We intercept the streaming arguments ourselves.
            ToolCallback writeDocCallback = FunctionToolCallback
                    .builder("write_document", (WriteDocumentRequest req) -> {
                        // This handler is never called because internal tool
                        // execution is disabled during streaming. The tool
                        // call is intercepted and handled manually above.
                        return "Document written.";
                    })
                    .description(
                        "Write a document for the user. Always call this tool when the "
                        + "user asks you to write or draft something of any length. "
                        + "The content argument should contain the full document text.")
                    .inputType(WriteDocumentRequest.class)
                    .build();

            ChatClient.ChatClientRequestSpec request = chatClient.prompt(
                    Prompt.builder().content(userContent).build())
                    .system(SYSTEM_PROMPT)
                    .toolCallbacks(writeDocCallback)
                    .options(OpenAiChatOptions.builder()
                            .internalToolExecutionEnabled(false)
                            .build());

            request.stream()
                    .chatResponse()
                    .subscribe(
                            evt -> {
                                // Handle text content (non-tool-call chunks)
                                String content = evt.getResult().getOutput().getText();
                                if (StringUtils.hasText(content)) {
                                    this.emitEvent(
                                            textMessageContentEvent(messageId, content),
                                            subscriber);
                                    textAccumulator.append(content);
                                }

                                // Spring AI equivalent of LangGraph's
                                // StateStreamingMiddleware(StateItem(...)): as the LLM
                                // streams the `write_document` tool's `content` argument,
                                // forward the growing partial value into state.document
                                // and emit a STATE_SNAPSHOT so the UI re-renders per token.
                                if (evt.hasToolCalls()) {
                                    var tcs = evt.getResult().getOutput().getToolCalls();
                                    for (var tc : tcs) {
                                        // Track the latest detected tool call
                                        detectedToolCalls.add(new DetectedToolCall(
                                                tc.id(), tc.name(), tc.arguments()));

                                        // If this is a write_document call, extract
                                        // the partial content from the growing args
                                        if ("write_document".equals(tc.name())
                                                && tc.arguments() != null) {
                                            String partialContent = extractContentValue(
                                                    tc.arguments());
                                            String prev = lastDocContent.get();
                                            if (partialContent != null
                                                    && partialContent.length() > prev.length()) {
                                                lastDocContent.set(partialContent);
                                                // Forward tool argument -> state key
                                                runState.set("document", partialContent);
                                                this.emitEvent(
                                                        stateSnapshotEvent(runState),
                                                        subscriber);
                                            }
                                        }
                                    }
                                }
                                // @endregion[state-streaming-middleware]
                            },
                            err -> {
                                streamError.set(err);
                                latch.countDown();
                            },
                            latch::countDown
                    );

            if (!latch.await(120, TimeUnit.SECONDS)) {
                throw new RuntimeException("Streaming timed out after 120 seconds");
            }

            Throwable err = streamError.get();
            if (err != null) {
                throw new RuntimeException("Streaming failed", err);
            }

            // Set final text content
            assistantMessage.setContent(textAccumulator.toString());

            // Emit tool call envelope events for detected write_document calls.
            // Deduplicate by tool call id (streaming delivers the same tool call
            // in multiple chunks with growing arguments; take the last one per id).
            java.util.Map<String, DetectedToolCall> byId = new java.util.LinkedHashMap<>();
            for (DetectedToolCall dtc : detectedToolCalls) {
                if (dtc.id() != null) {
                    byId.put(dtc.id(), dtc);
                }
            }
            for (DetectedToolCall dtc : byId.values()) {
                String toolCallId = dtc.id() != null ? dtc.id()
                        : UUID.randomUUID().toString();
                String args = dtc.arguments() != null ? dtc.arguments() : "{}";

                deferredEvents.add(toolCallStartEvent(messageId, dtc.name(), toolCallId));
                deferredEvents.add(toolCallArgsEvent(args, toolCallId));
                deferredEvents.add(toolCallEndEvent(toolCallId));
                deferredEvents.add(toolCallResultEvent(
                        toolCallId,
                        "Document written to shared state.",
                        UUID.randomUUID().toString(),
                        Role.tool));

                // Attach to assistant message
                FunctionCall fc = new FunctionCall(dtc.name(), args);
                ToolCall call = new ToolCall(toolCallId, "function", fc);
                if (assistantMessage.getToolCalls() == null) {
                    assistantMessage.setToolCalls(new ArrayList<>());
                }
                assistantMessage.getToolCalls().add(call);
                subscriber.onNewToolCall(call);
            }

            // Final state snapshot with the complete document
            String finalDoc = lastDocContent.get();
            if (StringUtils.hasText(finalDoc)) {
                runState.set("document", finalDoc);
                this.emitEvent(stateSnapshotEvent(runState), subscriber);
            }
        }

        /** Captured tool call from streaming. */
        private record DetectedToolCall(String id, String name, String arguments) {}

        /**
         * Extracts the value of the {@code "content"} key from a partial JSON
         * arguments string. Since the arguments are streamed incrementally, the
         * JSON may be incomplete (e.g. {@code {"content": "Once upon a ti}).
         *
         * <p>Strategy: find {@code "content"} key, skip to the opening quote of
         * the value, then extract everything up to the closing quote or end of
         * string. Handles JSON escape sequences (\\, \", \n, \t, etc.) to
         * reconstruct the actual content string.
         *
         * @return the partial content string, or null if not found
         */
        static String extractContentValue(String argsJson) {
            if (argsJson == null) return null;

            // Find "content" key — look for "content" followed by optional
            // whitespace and a colon
            int keyIdx = argsJson.indexOf("\"content\"");
            if (keyIdx < 0) {
                // Also try single-key shorthand (some models omit quotes on keys)
                keyIdx = argsJson.indexOf("content");
                if (keyIdx < 0) return null;
            }

            // Skip past the key and find the colon
            int colonIdx = argsJson.indexOf(':', keyIdx + 7);
            if (colonIdx < 0) return null;

            // Skip whitespace after colon
            int valueStart = colonIdx + 1;
            while (valueStart < argsJson.length()
                    && Character.isWhitespace(argsJson.charAt(valueStart))) {
                valueStart++;
            }

            if (valueStart >= argsJson.length()) return null;

            // The value should start with a quote
            if (argsJson.charAt(valueStart) != '"') return null;
            valueStart++; // skip opening quote

            // Extract the value, handling escape sequences
            StringBuilder value = new StringBuilder();
            for (int i = valueStart; i < argsJson.length(); i++) {
                char c = argsJson.charAt(i);
                if (c == '\\' && i + 1 < argsJson.length()) {
                    char next = argsJson.charAt(i + 1);
                    switch (next) {
                        case '"' -> { value.append('"'); i++; }
                        case '\\' -> { value.append('\\'); i++; }
                        case 'n' -> { value.append('\n'); i++; }
                        case 't' -> { value.append('\t'); i++; }
                        case 'r' -> { value.append('\r'); i++; }
                        case '/' -> { value.append('/'); i++; }
                        default -> value.append(c);
                    }
                } else if (c == '"') {
                    // End of string value
                    break;
                } else {
                    value.append(c);
                }
            }

            return value.toString();
        }

        private static final String SYSTEM_PROMPT =
                "You are a collaborative writing assistant. Whenever the user asks "
                + "you to write, draft, or revise any piece of text, ALWAYS call the "
                + "`write_document` tool with the full content as a single string in "
                + "the `content` argument. Never paste the document into a chat "
                + "message directly — the document belongs in shared state and the "
                + "UI renders it live as you type.";
    }

    /** Tool input schema for write_document. */
    public record WriteDocumentRequest(String content) {}
}
