package com.copilotkit.showcase.springai;

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
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.function.FunctionToolCallback;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

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
 * Shared State (Read + Write) demo — dedicated controller at
 * {@code /shared-state-read-write/run}.
 *
 * Demonstrates the canonical bidirectional shared-state pattern between UI
 * and agent, mirroring the LangGraph reference
 * (showcase/integrations/langgraph-python/src/agents/shared_state_read_write.py)
 * using Spring AI primitives.
 *
 * <ul>
 *   <li><b>UI -&gt; agent (write)</b>: the UI owns a {@code preferences} object
 *       written into agent state via {@code agent.setState({preferences})}.
 *       Every turn we read those preferences off the AG-UI envelope and inject
 *       them into the system prompt so the LLM adapts.</li>
 *   <li><b>agent -&gt; UI (read)</b>: the agent calls {@code set_notes(notes)}
 *       to mutate the {@code notes} slot of shared state. After the tool runs
 *       we emit a {@code STATE_SNAPSHOT} event so the frontend's
 *       {@code useAgent({ updates: [OnStateChanged] })} subscription
 *       re-renders.</li>
 * </ul>
 *
 * The agent is a custom {@link LocalAgent} subclass that wraps a Spring AI
 * {@link ChatClient}. This is an Advisor-style pattern adapted to the
 * AG-UI Java integration: rather than implementing
 * {@code org.springframework.ai.chat.client.advisor.api.Advisor} (which
 * intercepts the ChatClient call but cannot read the AG-UI {@link State}
 * envelope), we override {@link LocalAgent#run} so the per-turn system prompt
 * is composed from the AG-UI state and the {@code set_notes} tool can mutate
 * that same state and emit a {@code STATE_SNAPSHOT} back to the UI.
 *
 * Closes over the live {@link State} instance for the in-flight run so the
 * tool callback can mutate it; not Bean-scoped because state is per-request.
 */
@RestController
public class SharedStateReadWriteController {

    private static final Logger log =
            LoggerFactory.getLogger(SharedStateReadWriteController.class);

    private static final String AGENT_ID = "shared-state-read-write";

    private final AgUiService agUiService;
    private final ChatModel chatModel;

    @Autowired
    public SharedStateReadWriteController(AgUiService agUiService, ChatModel chatModel) {
        this.agUiService = agUiService;
        this.chatModel = chatModel;
    }

    @PostMapping("/shared-state-read-write/run")
    public ResponseEntity<SseEmitter> run(@RequestBody AgUiParameters params) throws Exception {
        MessageListFilter.filterNulls(params);
        SharedStateAgent agent = new SharedStateAgent(chatModel);
        SseEmitter emitter = agUiService.runAgent(agent, params);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }

    /**
     * Per-request agent. Runs one ChatClient call, injects {@code preferences}
     * into the system prompt, and exposes a {@code set_notes} tool that
     * mutates {@code state.notes} and emits a {@code STATE_SNAPSHOT}.
     */
    static class SharedStateAgent extends LocalAgent {

        private final ChatClient chatClient;

        SharedStateAgent(ChatModel chatModel) throws AGUIException {
            super(AGENT_ID, new State(), new ArrayList<>());
            this.chatClient = ChatClient.builder(chatModel).build();
        }

        @Override
        protected void run(RunAgentInput input, AgentSubscriber subscriber) {
            this.combineMessages(input);

            String messageId = UUID.randomUUID().toString();
            String threadId = input.threadId();
            String runId = input.runId();

            // Per-turn working state: seed from input, mutate via set_notes.
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

            // System prompt: base + injected preferences read from state.
            String systemPrompt = buildSystemPrompt(runState);

            // set_notes tool — Spring AI auto-invokes the handler inside
            // .call(), so by the time chatResponse() returns hasToolCalls()
            // is typically false. The handler itself queues the per-tool
            // AG-UI envelope events (start/args/end/result) and the trailing
            // STATE_SNAPSHOT, so the frontend sees the tool call even on
            // auto-invocation. Envelope events go BEFORE the snapshot per
            // AG-UI ordering convention.
            List<BaseEvent> deferredEvents = new ArrayList<>();
            List<ToolCall> handlerToolCalls = new ArrayList<>();
            SetNotesHandler setNotesHandler = new SetNotesHandler(
                    runState, deferredEvents, handlerToolCalls, messageId);
            ToolCallback setNotesCallback = FunctionToolCallback
                    .builder("set_notes", setNotesHandler)
                    .description(
                        "Replace the notes array in shared state with the full updated list. "
                        + "Use whenever the user asks you to remember something or you observe "
                        + "something worth surfacing in the UI's notes panel. Always pass the "
                        + "FULL list (existing + new). Keep each note short (< 120 chars).")
                    .inputType(SetNotesRequest.class)
                    .build();

            AssistantMessage assistantMessage = new AssistantMessage();
            assistantMessage.setId(messageId);
            assistantMessage.setName(this.agentId);
            assistantMessage.setContent("");

            this.emitEvent(textMessageStartEvent(messageId, "assistant"), subscriber);

            try {
                ChatResponse response = chatClient.prompt(
                            Prompt.builder().content(userContent).build())
                        .system(systemPrompt)
                        .toolCallbacks(setNotesCallback)
                        .call()
                        .chatResponse();

                // Surface any tool calls the handler captured during auto-
                // invocation onto the assistant message + subscriber.
                for (ToolCall call : handlerToolCalls) {
                    if (assistantMessage.getToolCalls() == null) {
                        assistantMessage.setToolCalls(new ArrayList<>());
                    }
                    assistantMessage.getToolCalls().add(call);
                    subscriber.onNewToolCall(call);
                }

                // Fallback: in the rare case Spring AI returns tool calls
                // without auto-invoking (e.g. configuration override), still
                // surface them via the same envelope.
                if (response != null && response.hasToolCalls()) {
                    response.getResult().getOutput().getToolCalls().forEach(tc -> {
                        String toolCallId = tc.id();
                        ToolCall call = new ToolCall(toolCallId, "function",
                                fnCall(tc.name(), tc.arguments()));
                        if (assistantMessage.getToolCalls() == null) {
                            assistantMessage.setToolCalls(new ArrayList<>());
                        }
                        assistantMessage.getToolCalls().add(call);
                        deferredEvents.add(toolCallStartEvent(messageId, tc.name(), toolCallId));
                        deferredEvents.add(toolCallArgsEvent(tc.arguments(), toolCallId));
                        deferredEvents.add(toolCallEndEvent(toolCallId));
                        deferredEvents.add(toolCallResultEvent(
                                toolCallId,
                                setNotesHandler.lastResult(),
                                UUID.randomUUID().toString(),
                                Role.tool));
                        subscriber.onNewToolCall(call);
                    });
                }

                String text = response != null
                        ? response.getResult().getOutput().getText()
                        : null;
                if (StringUtils.hasText(text)) {
                    this.emitEvent(textMessageContentEvent(messageId, text), subscriber);
                    assistantMessage.setContent(text);
                }
            } catch (Exception e) {
                log.error("ChatClient call failed", e);
                this.emitEvent(runErrorEvent(String.format(
                        "agent run failed: %s (see server logs)",
                        e.getClass().getSimpleName())), subscriber);
                return;
            }

            // Emit tool call events BEFORE textMessageEnd so the frontend's
            // useRenderTool sees them while the message is still "open".
            for (BaseEvent ev : deferredEvents) {
                this.emitEvent(ev, subscriber);
            }
            this.emitEvent(textMessageEndEvent(messageId), subscriber);
            subscriber.onNewMessage(assistantMessage);
            this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
            subscriber.onRunFinalized(
                    new AgentSubscriberParams(input.messages(), runState, this, input));
        }

        private static String buildSystemPrompt(State state) {
            StringBuilder sb = new StringBuilder();
            sb.append("You are a helpful, concise assistant. ");
            sb.append("When the user asks you to remember something, or when you observe ");
            sb.append("something worth surfacing in the UI, call set_notes with the FULL ");
            sb.append("updated list of short note strings (existing notes + new).\n");

            Object prefsObj = state.get("preferences");
            if (prefsObj instanceof Map<?, ?> prefs && !prefs.isEmpty()) {
                StringBuilder prefsLines = new StringBuilder();
                Object name = prefs.get("name");
                Object tone = prefs.get("tone");
                Object language = prefs.get("language");
                Object interests = prefs.get("interests");
                int linesAdded = 0;
                if (name instanceof String s && !s.isBlank()) {
                    prefsLines.append("- Name: ").append(s).append('\n');
                    linesAdded++;
                }
                if (tone instanceof String s && !s.isBlank()) {
                    prefsLines.append("- Preferred tone: ").append(s).append('\n');
                    linesAdded++;
                }
                if (language instanceof String s && !s.isBlank()) {
                    prefsLines.append("- Preferred language: ").append(s).append('\n');
                    linesAdded++;
                }
                if (interests instanceof List<?> list && !list.isEmpty()) {
                    prefsLines.append("- Interests: ");
                    prefsLines.append(String.join(", ",
                            list.stream().map(String::valueOf).toList()));
                    prefsLines.append('\n');
                    linesAdded++;
                }
                // Only append the preferences block + trailer if at least one
                // recognized preference key produced a non-empty line.
                if (linesAdded > 0) {
                    sb.append("\nThe user has shared these preferences with you:\n");
                    sb.append(prefsLines);
                    sb.append("Tailor every response to these preferences. Address the user ");
                    sb.append("by name when appropriate.\n");
                }
            }
            return sb.toString();
        }
    }

    /**
     * Tool handler for set_notes — replaces the {@code notes} slot of shared
     * state with the supplied list and queues the per-tool AG-UI envelope
     * events (start/args/end/result) FOLLOWED by a {@code STATE_SNAPSHOT}
     * (AG-UI ordering convention: snapshot follows the tool-call result).
     *
     * Spring AI auto-invokes this handler inside {@code ChatClient.call()},
     * so the controller cannot rely on {@code ChatResponse#hasToolCalls()}
     * to surface envelope events. The handler emits them itself and
     * synthesizes a tool-call id shared across all four envelope events for
     * self-consistent frontend correlation.
     */
    public static class SetNotesHandler
            implements java.util.function.Function<SetNotesRequest, String> {
        private final State state;
        private final List<BaseEvent> deferredEvents;
        private final List<ToolCall> capturedToolCalls;
        private final String parentMessageId;
        private volatile String lastResult = "Notes updated.";

        public SetNotesHandler(
                State state,
                List<BaseEvent> deferredEvents,
                List<ToolCall> capturedToolCalls,
                String parentMessageId) {
            this.state = state;
            this.deferredEvents = deferredEvents;
            this.capturedToolCalls = capturedToolCalls;
            this.parentMessageId = parentMessageId;
        }

        public String lastResult() {
            return lastResult;
        }

        @Override
        public synchronized String apply(SetNotesRequest request) {
            List<String> next = request.notes() == null ? List.of() : request.notes();
            state.set("notes", next);

            String toolCallId = UUID.randomUUID().toString();
            String argsJson;
            try {
                argsJson = new com.fasterxml.jackson.databind.ObjectMapper()
                        .writeValueAsString(Map.of("notes", next));
            } catch (Exception e) {
                argsJson = "{}";
            }

            // Capture the tool call so the controller can attach it to the
            // assistant message + notify the subscriber.
            FunctionCall fc = fnCall("set_notes", argsJson);
            capturedToolCalls.add(new ToolCall(toolCallId, "function", fc));

            String result = "Notes updated.";
            this.lastResult = result;

            // Envelope events first, then the state snapshot — AG-UI order.
            deferredEvents.add(toolCallStartEvent(parentMessageId, "set_notes", toolCallId));
            deferredEvents.add(toolCallArgsEvent(argsJson, toolCallId));
            deferredEvents.add(toolCallEndEvent(toolCallId));
            // Tool result message must have its own unique messageId — reusing
            // parentMessageId causes React deduplicateMessages() to overwrite
            // the assistant message with the tool message in the Map.
            deferredEvents.add(toolCallResultEvent(
                    toolCallId, result, UUID.randomUUID().toString(), Role.tool));
            deferredEvents.add(stateSnapshotEvent(state));

            return result;
        }
    }

    /** Tool input schema for set_notes. */
    public record SetNotesRequest(List<String> notes) {}

    private static FunctionCall fnCall(String name, String arguments) {
        return new FunctionCall(name, arguments);
    }
}
