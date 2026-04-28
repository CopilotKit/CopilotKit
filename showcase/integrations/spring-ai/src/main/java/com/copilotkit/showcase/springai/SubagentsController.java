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
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
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
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

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
 * Sub-Agents demo — dedicated controller at {@code /subagents/run}.
 *
 * Mirrors the LangGraph reference
 * (showcase/integrations/langgraph-python/src/agents/subagents.py) and the
 * Google ADK reference
 * (showcase/integrations/google-adk/src/agents/subagents_agent.py).
 *
 * A supervisor LLM coordinates three sub-agents exposed as tools. Each
 * sub-agent is a separate {@link ChatClient} call with its own system
 * prompt — equivalent to LangGraph's "sub-agents-as-tools" pattern. Every
 * delegation appends an entry to the {@code delegations} slot of shared
 * state, and a {@code STATE_SNAPSHOT} event is emitted after each tool
 * call so the UI's live "delegation log" updates in real time.
 *
 * <p>Sub-agents available to the supervisor:</p>
 * <ul>
 *   <li>{@code research_agent} — gathers facts</li>
 *   <li>{@code writing_agent} — drafts prose</li>
 *   <li>{@code critique_agent} — reviews drafts</li>
 * </ul>
 *
 * Each entry in {@code delegations} has the shape
 * {@code {id, sub_agent, task, status, result}}; the UI renders these as a
 * timeline of supervisor activity.
 */
@RestController
public class SubagentsController {

    private static final Logger log =
            LoggerFactory.getLogger(SubagentsController.class);

    private static final String AGENT_ID = "subagents";

    private static final String SUPERVISOR_PROMPT = """
            You are a supervisor agent that coordinates three specialized
            sub-agents to produce high-quality deliverables.

            Available sub-agents (call them as tools):
              - research_agent: gathers facts on a topic.
              - writing_agent: turns facts + a brief into a polished draft.
              - critique_agent: reviews a draft and suggests improvements.

            For most non-trivial user requests, delegate in sequence:
            research -> write -> critique. Pass the relevant facts/draft
            through the `task` argument of each tool. Keep your own
            messages short — explain the plan once, delegate, then return
            a concise summary once done. The UI shows the user a live log
            of every sub-agent delegation.
            """;

    // @region[subagent-setup]
    // Each sub-agent is its own Spring AI ChatClient call (built per-request
    // in SubAgentHandler.apply), with its own system prompt. They don't
    // share memory or tools with the supervisor — the supervisor only sees
    // their return value as a tool result.
    private static final String RESEARCH_PROMPT =
            "You are a research sub-agent. Given a topic, produce a concise "
            + "bulleted list of 3-5 key facts. No preamble, no closing.";
    private static final String WRITING_PROMPT =
            "You are a writing sub-agent. Given a brief and optional source "
            + "facts, produce a polished 1-paragraph draft. Be clear and "
            + "concrete. No preamble.";
    private static final String CRITIQUE_PROMPT =
            "You are an editorial critique sub-agent. Given a draft, give "
            + "2-3 crisp, actionable critiques. No preamble.";
    // @endregion[subagent-setup]

    private final AgUiService agUiService;
    private final ChatModel chatModel;

    @Autowired
    public SubagentsController(AgUiService agUiService, ChatModel chatModel) {
        this.agUiService = agUiService;
        this.chatModel = chatModel;
    }

    @PostMapping("/subagents/run")
    public ResponseEntity<SseEmitter> run(@RequestBody AgUiParameters params) throws Exception {
        SubagentsAgent agent = new SubagentsAgent(chatModel);
        SseEmitter emitter = agUiService.runAgent(agent, params);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }

    /**
     * Per-request supervisor agent. Wraps a Spring AI {@link ChatClient} for
     * the supervisor and one ChatClient per sub-agent (same model, distinct
     * system prompts). Every tool call records a {@code Delegation} entry
     * into the {@code delegations} slot of shared state and emits a
     * {@code STATE_SNAPSHOT} so the live frontend log updates incrementally.
     */
    static class SubagentsAgent extends LocalAgent {

        private final ChatClient supervisorClient;
        private final ChatModel chatModel;

        SubagentsAgent(ChatModel chatModel) throws AGUIException {
            super(AGENT_ID, new State(), new ArrayList<>());
            this.chatModel = chatModel;
            this.supervisorClient = ChatClient.builder(chatModel).build();
        }

        @Override
        protected void run(RunAgentInput input, AgentSubscriber subscriber) {
            this.combineMessages(input);

            String messageId = UUID.randomUUID().toString();
            String threadId = input.threadId();
            String runId = input.runId();

            State runState = input.state() != null ? input.state() : new State();
            this.state = runState;
            // Ensure delegations slot exists so partial writes are visible
            // immediately on first snapshot. Use CopyOnWriteArrayList because
            // Spring AI may execute parallel tool calls under some configs.
            if (!(runState.get("delegations") instanceof List<?>)) {
                runState.set("delegations",
                        new CopyOnWriteArrayList<Map<String, Object>>());
            }

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

            // CopyOnWriteArrayList: the handler may be invoked concurrently
            // from Spring AI's tool execution path. Concurrent appends to a
            // plain ArrayList here would risk lost / corrupt entries.
            List<BaseEvent> deferredEvents = new CopyOnWriteArrayList<>();
            // In-order capture of every sub-agent invocation so the
            // controller can post-process them with the supervisor's real
            // tool-call ids returned by ChatResponse.
            List<HandlerInvocation> handlerInvocations = new CopyOnWriteArrayList<>();

            // @region[supervisor-delegation-tools]
            // Each sub-agent is exposed to the supervisor LLM as a Spring AI
            // ToolCallback. When the supervisor invokes one, the matching
            // SubAgentHandler runs a fresh ChatClient call with that
            // sub-agent's system prompt, appends a Delegation entry to
            // shared state, and returns the sub-agent's output to the
            // supervisor as a tool result.
            ToolCallback researchTool = subAgentTool(
                    "research_agent", RESEARCH_PROMPT, runState, deferredEvents,
                    handlerInvocations, messageId,
                    "Delegate a research task to the research sub-agent. "
                    + "Use for: gathering facts, background, definitions, statistics. "
                    + "Returns a bulleted list of key facts.");
            ToolCallback writingTool = subAgentTool(
                    "writing_agent", WRITING_PROMPT, runState, deferredEvents,
                    handlerInvocations, messageId,
                    "Delegate a drafting task to the writing sub-agent. "
                    + "Use for: producing a polished paragraph, draft, or summary. "
                    + "Pass relevant facts from prior research inside `task`.");
            ToolCallback critiqueTool = subAgentTool(
                    "critique_agent", CRITIQUE_PROMPT, runState, deferredEvents,
                    handlerInvocations, messageId,
                    "Delegate a critique task to the critique sub-agent. "
                    + "Use for: reviewing a draft and suggesting concrete improvements.");
            // @endregion[supervisor-delegation-tools]

            AssistantMessage assistantMessage = new AssistantMessage();
            assistantMessage.setId(messageId);
            assistantMessage.setName(this.agentId);
            assistantMessage.setContent("");

            this.emitEvent(textMessageStartEvent(messageId, "assistant"), subscriber);

            try {
                ChatResponse response = supervisorClient.prompt(
                            Prompt.builder().content(userContent).build())
                        .system(SUPERVISOR_PROMPT)
                        .toolCallbacks(researchTool, writingTool, critiqueTool)
                        .call()
                        .chatResponse();

                String text = response != null
                        ? response.getResult().getOutput().getText()
                        : null;
                if (StringUtils.hasText(text)) {
                    this.emitEvent(textMessageContentEvent(messageId, text), subscriber);
                    assistantMessage.setContent(text);
                }

                // Compute the tool-call ids the supervisor actually used so
                // envelope events correlate with the supervisor's tool-call.
                // Spring AI auto-invokes tools inside .call(), so
                // hasToolCalls() may be false on return; in that case fall
                // back to synthesized ids that are at least self-consistent
                // across the four envelope events for each invocation.
                List<String> supervisorToolCallIds = new ArrayList<>();
                List<org.springframework.ai.chat.messages.AssistantMessage.ToolCall>
                        supervisorToolCalls = (response != null
                                && response.hasToolCalls())
                                ? response.getResult().getOutput().getToolCalls()
                                : List.of();
                for (var tc : supervisorToolCalls) {
                    supervisorToolCallIds.add(tc.id());
                    ToolCall call = new ToolCall(tc.id(), "function",
                            fnCall(tc.name(), tc.arguments()));
                    if (assistantMessage.getToolCalls() == null) {
                        assistantMessage.setToolCalls(new ArrayList<>());
                    }
                    assistantMessage.getToolCalls().add(call);
                    subscriber.onNewToolCall(call);
                }

                // Emit envelope events + state snapshot for every captured
                // handler invocation, in order. Envelope events go BEFORE
                // the state snapshot per AG-UI ordering convention.
                for (int i = 0; i < handlerInvocations.size(); i++) {
                    HandlerInvocation inv = handlerInvocations.get(i);
                    String toolCallId = i < supervisorToolCallIds.size()
                            ? supervisorToolCallIds.get(i)
                            : UUID.randomUUID().toString();
                    deferredEvents.add(toolCallStartEvent(
                            messageId, inv.subAgentName(), toolCallId));
                    deferredEvents.add(toolCallArgsEvent(inv.argsJson(), toolCallId));
                    deferredEvents.add(toolCallEndEvent(toolCallId));
                    deferredEvents.add(toolCallResultEvent(
                            toolCallId, inv.result(), messageId, Role.tool));
                    deferredEvents.add(stateSnapshotEvent(inv.snapshot()));
                }
            } catch (Exception e) {
                log.error("Supervisor ChatClient call failed", e);
                this.emitEvent(runErrorEvent(String.format(
                        "agent run failed: %s (see server logs)",
                        e.getClass().getSimpleName())), subscriber);
                return;
            }

            this.emitEvent(textMessageEndEvent(messageId), subscriber);
            for (BaseEvent ev : deferredEvents) {
                this.emitEvent(ev, subscriber);
            }
            subscriber.onNewMessage(assistantMessage);
            this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
            subscriber.onRunFinalized(
                    new AgentSubscriberParams(input.messages(), runState, this, input));
        }

        /**
         * Build a ToolCallback that, when invoked by the supervisor, runs a
         * sub-agent (a fresh ChatClient call with its own system prompt) and
         * appends a {@code Delegation} entry to {@code state.delegations}.
         * The handler captures each invocation into {@code handlerInvocations}
         * so the controller can later emit envelope events using the
         * supervisor's real tool-call ids.
         */
        private ToolCallback subAgentTool(
                String name,
                String systemPrompt,
                State state,
                List<BaseEvent> deferredEvents,
                List<HandlerInvocation> handlerInvocations,
                String parentMessageId,
                String description) {
            SubAgentHandler handler = new SubAgentHandler(
                    chatModel, name, systemPrompt, state, deferredEvents,
                    handlerInvocations, parentMessageId);
            return FunctionToolCallback
                    .builder(name, handler)
                    .description(description)
                    .inputType(SubAgentRequest.class)
                    .build();
        }
    }

    /**
     * Captured record of a single sub-agent handler invocation. Keeps the
     * data the controller needs to emit envelope events + a state snapshot
     * AFTER {@code ChatClient.call()} returns, when the supervisor's real
     * tool-call ids are available.
     */
    record HandlerInvocation(
            String subAgentName,
            String argsJson,
            String result,
            State snapshot) {}

    /**
     * Tool handler that delegates to a sub-agent ChatClient call and records
     * a Delegation entry into shared state. Envelope events and the trailing
     * STATE_SNAPSHOT are NOT queued here; the controller queues them after
     * {@code ChatClient.call()} returns so it can use the supervisor's real
     * tool-call ids (Finding A) and so envelope events strictly precede the
     * state snapshot per AG-UI ordering convention (Finding B).
     */
    public static class SubAgentHandler
            implements java.util.function.Function<SubAgentRequest, String> {

        private final ChatModel chatModel;
        private final String subAgentName;
        private final String systemPrompt;
        private final State state;
        @SuppressWarnings("unused") // retained for future per-handler events
        private final List<BaseEvent> deferredEvents;
        private final List<HandlerInvocation> handlerInvocations;
        @SuppressWarnings("unused") // retained for symmetry / future use
        private final String parentMessageId;

        public SubAgentHandler(
                ChatModel chatModel,
                String subAgentName,
                String systemPrompt,
                State state,
                List<BaseEvent> deferredEvents,
                List<HandlerInvocation> handlerInvocations,
                String parentMessageId) {
            this.chatModel = chatModel;
            this.subAgentName = subAgentName;
            this.systemPrompt = systemPrompt;
            this.state = state;
            this.deferredEvents = deferredEvents;
            this.handlerInvocations = handlerInvocations;
            this.parentMessageId = parentMessageId;
        }

        @Override
        public String apply(SubAgentRequest request) {
            String task = request.task() == null ? "" : request.task();
            String result;
            String status;
            try {
                ChatResponse response = chatModel.call(new Prompt(List.of(
                        new SystemMessage(systemPrompt),
                        new UserMessage(task))));
                result = response.getResult().getOutput().getText();
                if (result == null) {
                    result = "";
                }
                status = "completed";
            } catch (Exception e) {
                log.error("Sub-agent {} failed", subAgentName, e);
                // Don't propagate provider URLs / credentials into the
                // SSE stream; keep the message generic.
                result = String.format(
                        "sub-agent call failed: %s (see server logs)",
                        e.getClass().getSimpleName());
                status = "failed";
            }

            // Append a Delegation entry to shared state. Synchronize on the
            // delegations list so concurrent sub-agent invocations don't
            // race when initializing or appending.
            List<Map<String, Object>> delegations;
            synchronized (state) {
                Object existing = state.get("delegations");
                if (existing instanceof List<?> list) {
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> typed = (List<Map<String, Object>>) list;
                    delegations = typed;
                } else {
                    delegations = new CopyOnWriteArrayList<>();
                    state.set("delegations", delegations);
                }
            }
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", UUID.randomUUID().toString());
            entry.put("sub_agent", subAgentName);
            entry.put("task", task);
            entry.put("status", status);
            entry.put("result", result);
            delegations.add(entry);

            String argsJson;
            try {
                argsJson = new com.fasterxml.jackson.databind.ObjectMapper()
                        .writeValueAsString(Map.of("task", task));
            } catch (Exception e) {
                argsJson = "{}";
            }

            // Snapshot state so the UI's delegation log reflects state AT
            // THIS POINT (subsequent sub-agent calls produce their own).
            // Deep-copy under a synchronized block since the delegations
            // list and state map can both be mutated concurrently.
            State snapshot;
            synchronized (state) {
                snapshot = new State(new HashMap<>(state.getState()));
                snapshot.set("delegations", new ArrayList<>(delegations));
            }

            // Hand the captured invocation back to the controller so it can
            // emit envelope events using the supervisor's real tool-call id.
            handlerInvocations.add(new HandlerInvocation(
                    subAgentName, argsJson, result, snapshot));

            return result;
        }
    }

    /** Tool input schema for sub-agent delegation. */
    public record SubAgentRequest(String task) {}

    private static FunctionCall fnCall(String name, String arguments) {
        return new FunctionCall(name, arguments);
    }
}
