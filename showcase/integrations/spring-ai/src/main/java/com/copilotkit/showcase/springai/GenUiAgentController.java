package com.copilotkit.showcase.springai;

import com.agui.core.agent.AgentSubscriber;
import com.agui.core.agent.AgentSubscriberParams;
import com.agui.core.agent.RunAgentInput;
import com.agui.core.event.BaseEvent;
import com.agui.core.event.StateSnapshotEvent;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.observation.ObservationRegistry;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.model.tool.ToolCallingManager;
import java.util.function.Consumer;
import com.agui.core.exception.AGUIException;
import com.agui.core.function.FunctionCall;
import com.agui.core.message.AssistantMessage;
import com.agui.core.message.Role;
import com.agui.core.state.State;
import com.agui.core.tool.ToolCall;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

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
 * Agentic Generative UI demo — dedicated controller at
 * {@code /gen-ui-agent/run}.
 *
 * Mirrors the LangGraph reference
 * (showcase/integrations/langgraph-python/src/agents/gen_ui_agent.py) using
 * the same primitives Spring-AI already exercises for shared-state demos
 * ({@link SharedStateReadWriteController}) and tool-composition
 * ({@link SubagentsController}).
 *
 * <p>The agent plans a task as exactly three steps and walks each
 * {@code pending -> in_progress -> completed}, calling {@code set_steps}
 * after every transition. {@code set_steps} replaces the {@code steps} slot
 * of shared state and a {@code STATE_SNAPSHOT} event is emitted after the
 * tool's per-call envelope, so the frontend's
 * {@code useAgent({ updates: [OnStateChanged] })} subscription re-renders
 * the {@code [data-testid="agent-state-card"]} + per-step
 * {@code [data-testid="agent-step"]} cells live.
 *
 * <p>This is the canonical {@code state-editing-tool} pattern: a single
 * tool (here {@code set_steps}) is the sole authorized writer of the
 * structured state slot the UI subscribes to. Same shape used by Sub-Agents
 * (delegations log) and Shared-State Read+Write (notes panel) — the only
 * thing that changes per-demo is the slot name and tool schema.
 */
@RestController
public class GenUiAgentController {

    private static final Logger log =
            LoggerFactory.getLogger(GenUiAgentController.class);

    private static final String AGENT_ID = "gen-ui-agent";
    private static final int TOOL_ROUND_LIMIT = 8;

    private static final String SYSTEM_PROMPT = """
            You are an agentic planner. For each user request, follow this exact
            sequence:
            1. Plan exactly 3 concrete steps and call `set_steps` ONCE with all
               three steps at status="pending".
            2. Step 1: call `set_steps` with step 1 at status="in_progress",
               then call `set_steps` again with step 1 at status="completed".
            3. Step 2: call `set_steps` with step 2 at status="in_progress",
               then call `set_steps` again with step 2 at status="completed".
            4. Step 3: call `set_steps` with step 3 at status="in_progress",
               then call `set_steps` again with step 3 at status="completed".
            5. Send ONE final conversational assistant message summarizing the
               plan, then stop. Do not call any more tools after step 3 is
               completed.

            Rules: never call set_steps in parallel — always wait for one call
            to return before the next. Each step object has fields
            {id: string, title: string, status: "pending"|"in_progress"|"completed"}.
            Always pass the FULL list of steps on every call (existing + updated).
            After all three steps are completed you MUST send a final assistant
            message and terminate.
            """;

    private final AgUiService agUiService;
    private final ChatModel chatModel;
    private final ObjectMapper objectMapper;
    private final ObservationRegistry observationRegistry;

    @Autowired
    public GenUiAgentController(AgUiService agUiService, ChatModel chatModel,
            ObjectMapper objectMapper, ObjectProvider<ObservationRegistry> observationRegistries) {
        this.agUiService = agUiService;
        this.chatModel = chatModel;
        this.objectMapper = objectMapper;
        this.observationRegistry = observationRegistries.getIfUnique(() -> ObservationRegistry.NOOP);
    }

    @PostMapping("/gen-ui-agent/run")
    public ResponseEntity<SseEmitter> run(@RequestBody AgUiParameters params) throws Exception {
        MessageListFilter.filterNulls(params);
        GenUiAgent agent = new GenUiAgent(plannerModel(), objectMapper);
        SseEmitter emitter = agUiService.runAgent(agent, params);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }

    private ChatModel plannerModel() {
        if (!(chatModel instanceof OpenAiChatModel openAiModel)) {
            throw new IllegalStateException("The planner requires an OpenAiChatModel");
        }
        // A fresh manager per run permits seven transitions and a final model
        // summary, while retaining an inclusive eight-tool-round safety bound.
        // Never wrap the shared five-round manager or mutate singleton options.
        ToolCallingManager delegate = ToolCallingManager.builder()
                .observationRegistry(observationRegistry)
                .build();
        return openAiModel.mutate().toolCallingManager(
                new BoundedToolCallingManagerConfig.BoundedToolCallingManager(delegate, TOOL_ROUND_LIMIT)).build();
    }

    static boolean isToolLimitResponse(ChatResponse response) {
        // Spring AI builds assistant-shaped tool results when returnDirect
        // stops its loop. These generations are not model narration.
        return response != null && response.getResults().stream().anyMatch(
                generation -> "returnDirect".equals(generation.getMetadata().getFinishReason()));
    }

    /**
     * Per-request agent. Runs one ChatClient call with the {@code set_steps}
     * tool that mutates {@code state.steps} and emits a
     * {@code STATE_SNAPSHOT} after every invocation. Spring AI's internal
     * tool execution loop drives the multi-call sequence (pending -&gt;
     * in_progress -&gt; completed) inside a single {@code .call()}.
     */
    static class GenUiAgent extends PropagatingLocalAgent {

        private final ChatClient chatClient;
        private final ObjectMapper objectMapper;

        GenUiAgent(ChatModel chatModel, ObjectMapper objectMapper) throws AGUIException {
            super(AGENT_ID, new State(), new ArrayList<>());
            this.chatClient = ChatClient.builder(chatModel).build();
            this.objectMapper = objectMapper;
        }

        @Override
        protected void run(RunAgentInput input, AgentSubscriber subscriber) {
            this.combineMessages(input);

            String messageId = UUID.randomUUID().toString();
            String threadId = input.threadId();
            String runId = input.runId();

            // Per-turn working state: seed from input, mutate via set_steps.
            State runState = input.state() != null ? input.state() : new State();
            this.state = runState;

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
                userContent = this.getLatestUserMessage(messages).getContent();
            } catch (AGUIException e) {
                log.error("Failed to read latest user message", e);
                this.emitEvent(runErrorEvent(String.format(
                        "agent run failed: %s (see server logs)",
                        e.getClass().getSimpleName())), subscriber);
                this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
                subscriber.onRunFinalized(
                        new AgentSubscriberParams(input.messages(), runState, this, input));
                return;
            }
            if (!StringUtils.hasText(userContent)) {
                log.warn("Latest user message has null/blank content");
                this.emitEvent(runErrorEvent(
                        "agent run failed: user message was empty"), subscriber);
                this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
                subscriber.onRunFinalized(
                        new AgentSubscriberParams(input.messages(), runState, this, input));
                return;
            }

            // set_steps tool — Spring AI auto-invokes the handler inside
            // .call(), so hasToolCalls() is typically false on return. The
            // handler immediately emits its own per-tool AG-UI envelope events
            // (start/args/end/result) followed by a STATE_SNAPSHOT after
            // each call so the frontend sees every pending -> in_progress
            // -> completed transition. Envelope events go BEFORE the
            // snapshot per AG-UI ordering convention.
            List<ToolCall> handlerToolCalls = new ArrayList<>();
            SetStepsHandler setStepsHandler = new SetStepsHandler(
                    runState, event -> this.emitEvent(event, subscriber), handlerToolCalls, messageId, objectMapper);
            ToolCallback setStepsCallback = FunctionToolCallback
                    .builder("set_steps", setStepsHandler)
                    .description(
                        "Publish the current plan + step statuses. Call every time a step "
                        + "transitions (including the first enumeration of steps). Always "
                        + "pass the FULL list of steps; each step has {id, title, "
                        + "status} where status is one of pending|in_progress|completed.")
                    .inputType(SetStepsRequest.class)
                    .build();

            AssistantMessage assistantMessage = new AssistantMessage();
            assistantMessage.setId(messageId);
            assistantMessage.setName(this.agentId);
            assistantMessage.setContent("");

            this.emitEvent(textMessageStartEvent(messageId, "assistant"), subscriber);

            try {
                ChatResponse response = chatClient.prompt(
                            Prompt.builder().content(userContent).build())
                        .system(SYSTEM_PROMPT)
                        .toolCallbacks(setStepsCallback)
                        .call()
                        .chatResponse();

                // Surface any tool calls the handler captured during auto-
                // invocation onto the assistant message + subscriber. The
                // handler invocation list preserves call order, which is
                // critical here: the UI must see pending -> in_progress ->
                // completed transitions in sequence.
                for (ToolCall call : handlerToolCalls) {
                    if (assistantMessage.getToolCalls() == null) {
                        assistantMessage.setToolCalls(new ArrayList<>());
                    }
                    assistantMessage.getToolCalls().add(call);
                    subscriber.onNewToolCall(call);
                }

                if (isToolLimitResponse(response)) {
                    log.warn("Planner reached its {}-round tool-call limit without a final summary", TOOL_ROUND_LIMIT);
                    this.emitEvent(textMessageEndEvent(messageId), subscriber);
                    this.emitEvent(runErrorEvent(
                            "Planner stopped after reaching its " + TOOL_ROUND_LIMIT
                                    + "-round tool-call limit; no final summary was produced."), subscriber);
                    subscriber.onRunFinalized(
                            new AgentSubscriberParams(input.messages(), runState, this, input));
                    return;
                }

                // Unexecuted tool calls cannot be represented as successful
                // results. Already executed callbacks have emitted their envelopes.
                if (response != null && response.hasToolCalls()) {
                    throw new IllegalStateException("Planner returned unexecuted tool calls");
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
                // textMessageStart was already emitted — close the message
                // before RUN_ERROR so subscribers tear down cleanly, then
                // finalize so the SSE stream completes (no double textMessageEnd:
                // this path returns before the happy-path textMessageEnd below).
                this.emitEvent(textMessageEndEvent(messageId), subscriber);
                this.emitEvent(runErrorEvent(String.format(
                        "agent run failed: %s (see server logs)",
                        e.getClass().getSimpleName())), subscriber);
                this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
                subscriber.onRunFinalized(
                        new AgentSubscriberParams(input.messages(), runState, this, input));
                return;
            }

            this.emitEvent(textMessageEndEvent(messageId), subscriber);
            subscriber.onNewMessage(assistantMessage);
            this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
            subscriber.onRunFinalized(
                    new AgentSubscriberParams(input.messages(), runState, this, input));
        }
    }

    /**
     * Tool handler for {@code set_steps} — replaces the {@code steps} slot of
     * shared state with the supplied list and immediately emits the per-tool AG-UI
     * envelope events (start/args/end/result) FOLLOWED by a
     * {@code STATE_SNAPSHOT} (AG-UI ordering convention: snapshot follows the
     * tool-call result).
     *
     * <p>Spring AI auto-invokes this handler inside {@code ChatClient.call()},
     * so the controller cannot rely on {@code ChatResponse#hasToolCalls()}
     * to surface envelope events. The handler emits them itself and
     * synthesizes a tool-call id shared across the four envelope events for
     * self-consistent frontend correlation.
     *
     * <p>Each step is normalized to a {@code LinkedHashMap} (preserves field
     * order in the JSON snapshot) with keys {@code id}, {@code title},
     * {@code status}; missing ids are filled with a stable UUID so the
     * frontend can use them as React keys.
     */
    public static class SetStepsHandler
            implements java.util.function.Function<SetStepsRequest, String> {
        private final State state;
        private final Consumer<BaseEvent> eventSink;
        private final ObjectMapper objectMapper;
        private final List<ToolCall> capturedToolCalls;
        private final String parentMessageId;

        public SetStepsHandler(
                State state,
                Consumer<BaseEvent> eventSink,
                List<ToolCall> capturedToolCalls,
                String parentMessageId, ObjectMapper objectMapper) {
            this.state = state;
            this.eventSink = eventSink;
            this.objectMapper = objectMapper;
            this.capturedToolCalls = capturedToolCalls;
            this.parentMessageId = parentMessageId;
        }

        @Override
        public synchronized String apply(SetStepsRequest request) {
            List<Step> incoming = request.steps() == null ? List.of() : request.steps();
            // Normalize: drop nulls, fill missing ids, coerce status to one of
            // the allowed values. Defensive because the LLM may omit fields
            // or use slight variants (e.g. "in-progress").
            List<Map<String, Object>> normalized = new ArrayList<>(incoming.size());
            for (Step s : incoming) {
                if (s == null) continue;
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("id",
                        s.id() != null && !s.id().isBlank() ? s.id()
                                : UUID.randomUUID().toString());
                entry.put("title", s.title() != null ? s.title() : "");
                entry.put("status", normalizeStatus(s.status()));
                normalized.add(entry);
            }
            state.set("steps", normalized);

            String toolCallId = UUID.randomUUID().toString();
            String argsJson;
            State snapshot;
            try {
                argsJson = objectMapper.writeValueAsString(Map.of("steps", normalized));
                // Round-trip the complete state to detach nested mutable values.
                snapshot = new State(objectMapper.readValue(
                        objectMapper.writeValueAsBytes(state.getState()),
                        new TypeReference<Map<String, Object>>() {}));
            } catch (Exception e) {
                throw new IllegalStateException("Unable to serialize planner state", e);
            }

            // Capture the tool call so the controller can attach it to the
            // assistant message + notify the subscriber.
            FunctionCall fc = fnCall("set_steps", argsJson);
            capturedToolCalls.add(new ToolCall(toolCallId, "function", fc));

            String result = String.format("Published %d step(s).", normalized.size());

            // Envelope events first, then the state snapshot — AG-UI order.
            eventSink.accept(toolCallStartEvent(parentMessageId, "set_steps", toolCallId));
            eventSink.accept(toolCallArgsEvent(argsJson, toolCallId));
            eventSink.accept(toolCallEndEvent(toolCallId));
            // Tool result message must have its own unique messageId — reusing
            // parentMessageId causes React deduplicateMessages() to overwrite
            // the assistant message with the tool message in the Map.
            eventSink.accept(toolCallResultEvent(
                    toolCallId, result, UUID.randomUUID().toString(), Role.tool));
            eventSink.accept(new PlannerStateSnapshotEvent(snapshot));

            return result;
        }

        private static String normalizeStatus(String raw) {
            if (raw == null) return "pending";
            String s = raw.trim().toLowerCase().replace('-', '_');
            return switch (s) {
                case "in_progress", "completed", "pending" -> s;
                default -> "pending";
            };
        }
    }

    /** Local wire adapter; the SDK otherwise serializes the payload as "state". */
    static final class PlannerStateSnapshotEvent extends StateSnapshotEvent {
        PlannerStateSnapshotEvent(State snapshot) {
            setState(snapshot);
        }

        @Override
        @JsonProperty("snapshot")
        public State getState() {
            return super.getState();
        }

        @Override
        @JsonProperty("snapshot")
        public void setState(State state) {
            super.setState(state);
        }
    }

    /** Tool input schema for set_steps. */
    public record SetStepsRequest(List<Step> steps) {}

    /**
     * A single step in the gen-ui-agent plan. {@code status} is one of
     * {@code pending}, {@code in_progress}, {@code completed}; values outside
     * that set are coerced to {@code pending} during normalization.
     */
    public record Step(String id, String title, String status) {}

    private static FunctionCall fnCall(String name, String arguments) {
        return new FunctionCall(name, arguments);
    }
}
