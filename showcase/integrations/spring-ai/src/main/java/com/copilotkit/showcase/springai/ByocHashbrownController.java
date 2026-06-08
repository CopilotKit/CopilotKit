package com.copilotkit.showcase.springai;

import com.agui.core.agent.AgentSubscriber;
import com.agui.core.agent.AgentSubscriberParams;
import com.agui.core.agent.RunAgentInput;
import com.agui.core.exception.AGUIException;
import com.agui.core.message.AssistantMessage;
import com.agui.core.state.State;
import com.agui.server.spring.AgUiParameters;
import com.agui.server.spring.AgUiService;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.Prompt;
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
import java.util.UUID;

import static com.agui.server.EventFactory.runErrorEvent;
import static com.agui.server.EventFactory.runFinishedEvent;
import static com.agui.server.EventFactory.runStartedEvent;
import static com.agui.server.EventFactory.textMessageContentEvent;
import static com.agui.server.EventFactory.textMessageEndEvent;
import static com.agui.server.EventFactory.textMessageStartEvent;

/**
 * BYOC hashbrown demo controller.
 *
 * <p>Runs a zero-tool agent whose system prompt instructs the LLM to emit a
 * single JSON object matching the {@code @hashbrownai/react} UI kit envelope:
 * {@code { "ui": [ { "<component>": { "props": { ... } } }, ... ] }}. The
 * frontend renderer ({@code declarative-hashbrown/hashbrown-renderer.tsx})
 * parses the streaming content via {@code useJsonParser} + {@code useUiKit}
 * and renders MetricCard / PieChart / BarChart / DealCard / Markdown.
 *
 * <p>The shared {@code /} agent cannot emit this envelope, so this dedicated
 * controller specializes the prompt — mirrors {@link ByocJsonRenderController}
 * and the Python reference agents (strands {@code byoc_hashbrown.py}, agno
 * {@code byoc_hashbrown_agent.py}).
 */
@RestController
public class ByocHashbrownController {

    private static final Logger log =
            LoggerFactory.getLogger(ByocHashbrownController.class);

    private static final String AGENT_ID = "byoc_hashbrown";

    private final AgUiService agUiService;
    private final ChatModel chatModel;

    @Autowired
    public ByocHashbrownController(AgUiService agUiService, ChatModel chatModel) {
        this.agUiService = agUiService;
        this.chatModel = chatModel;
    }

    @PostMapping("/byoc-hashbrown/run")
    public ResponseEntity<SseEmitter> run(@RequestBody AgUiParameters params) {
        MessageListFilter.filterNulls(params);
        ByocHashbrownAgent agent = new ByocHashbrownAgent(chatModel);
        SseEmitter emitter = agUiService.runAgent(agent, params);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }

    /**
     * Per-request agent. Zero tools, JSON-object response, hashbrown UI-kit
     * system prompt. The model emits a single JSON object that the frontend's
     * hashbrown renderer parses and renders via {@code @hashbrownai/react}.
     */
    static class ByocHashbrownAgent extends PropagatingLocalAgent {

        private final ChatClient chatClient;

        ByocHashbrownAgent(ChatModel chatModel) {
            super(AGENT_ID, new State(), new ArrayList<>());
            this.chatClient = ChatClient.builder(chatModel).build();
        }

        @Override
        protected void run(RunAgentInput input, AgentSubscriber subscriber) {
            this.combineMessages(input);

            String messageId = UUID.randomUUID().toString();
            String threadId = input.threadId();
            String runId = input.runId();

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

            AssistantMessage assistantMessage = new AssistantMessage();
            assistantMessage.setId(messageId);
            assistantMessage.setName(this.agentId);
            assistantMessage.setContent("");

            try {
                ChatResponse response = chatClient.prompt(
                            Prompt.builder().content(userContent).build())
                        .system(SYSTEM_PROMPT)
                        .call()
                        .chatResponse();

                if (response == null
                        || response.getResult() == null
                        || response.getResult().getOutput() == null) {
                    log.warn("ChatClient returned an empty result (no output)");
                    this.emitEvent(textMessageEndEvent(messageId), subscriber);
                    this.emitEvent(runErrorEvent(
                            "agent run failed: model returned an empty result"), subscriber);
                    this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
                    subscriber.onRunFinalized(
                            new AgentSubscriberParams(input.messages(), state, this, input));
                    return;
                }

                String text = response.getResult().getOutput().getText();
                if (!StringUtils.hasText(text)) {
                    log.warn("ChatClient returned a null/blank text response");
                    this.emitEvent(textMessageEndEvent(messageId), subscriber);
                    this.emitEvent(runErrorEvent(
                            "agent run failed: model returned an empty response"), subscriber);
                    this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
                    subscriber.onRunFinalized(
                            new AgentSubscriberParams(input.messages(), state, this, input));
                    return;
                }

                this.emitEvent(textMessageContentEvent(messageId, text), subscriber);
                assistantMessage.setContent(text);
            } catch (Exception e) {
                log.error("ChatClient call failed", e);
                this.emitEvent(textMessageEndEvent(messageId), subscriber);
                this.emitEvent(runErrorEvent(String.format(
                        "agent run failed: %s (see server logs)",
                        e.getClass().getSimpleName())), subscriber);
                this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
                subscriber.onRunFinalized(
                        new AgentSubscriberParams(input.messages(), state, this, input));
                return;
            }

            this.emitEvent(textMessageEndEvent(messageId), subscriber);
            subscriber.onNewMessage(assistantMessage);
            this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
            subscriber.onRunFinalized(
                    new AgentSubscriberParams(input.messages(), state, this, input));
        }
    }

    /**
     * System prompt instructing the LLM to emit a hashbrown UI-kit envelope.
     * Matches the Python reference agents' prompt (strands
     * {@code byoc_hashbrown.py}, agno {@code byoc_hashbrown_agent.py}) and the
     * component schema declared in {@code hashbrown-renderer.tsx}.
     */
    static final String SYSTEM_PROMPT = """
        You are a sales-dashboard composer. Your output MUST be a SINGLE valid
        JSON object — no markdown fences, no commentary, no leading explanation
        — shaped exactly like the hashbrown UI kit envelope:

        {
          "ui": [
            { "metric":   { "props": { "label": "<string>", "value": "<string>" } } },
            { "pieChart": { "props": { "title": "<string>", "data": "<JSON-string of [{label,value}, ...]>" } } },
            { "barChart": { "props": { "title": "<string>", "data": "<JSON-string of [{label,value}, ...]>" } } },
            { "dealCard": { "props": { "title": "<string>", "stage": "<one of: prospect|qualified|proposal|negotiation|closed-won|closed-lost>", "value": <number> } } },
            { "Markdown": { "props": { "children": "<string>" } } }
          ]
        }

        Available components and their prop schemas:

        - "metric": { "props": { "label": string, "value": string } }
            A KPI card. `value` is a pre-formatted string like "$1.2M" or "248".

        - "pieChart": { "props": { "title": string, "data": string } }
            A donut chart. `data` is a JSON-encoded STRING (embedded JSON) of an
            array of {label, value} objects with at least 3 segments.

        - "barChart": { "props": { "title": string, "data": string } }
            A vertical bar chart. `data` is a JSON-encoded STRING of an array of
            {label, value} objects with at least 3 bars, typically time-ordered.

        - "dealCard": { "props": { "title": string, "stage": string, "value": number } }
            A single sales deal. `stage` MUST be one of: "prospect", "qualified",
            "proposal", "negotiation", "closed-won", "closed-lost". `value` is a
            raw number (no currency symbol or comma).

        - "Markdown": { "props": { "children": string } }
            Short explanatory text. Use for section headings and brief summaries.

        Rules:
        - Output ONE top-level object with a "ui" array of component invocations.
        - Each entry in the "ui" array has exactly one key — the component name —
          whose value is `{ "props": { ... } }`.
        - For pieChart and barChart, the `data` prop is a JSON-encoded *string*,
          not a real array. Escape inner quotes, e.g.:
          "data": "[{\\"label\\":\\"Enterprise\\",\\"value\\":600000}]"
        - Always produce plausible sample data when asked for a dashboard or
          chart — do not refuse for lack of data.
        - Prefer 3-6 rows of data in charts; keep labels short.
        - Do not emit components that are not listed above.

        ### Worked example — "Show me a Q4 sales dashboard with a revenue metric, a pie chart by segment, and a bar chart of monthly revenue"

        {
          "ui": [
            { "metric": { "props": { "label": "Total Revenue (Q4)", "value": "$1.24M" } } },
            { "pieChart": { "props": { "title": "Revenue by Segment", "data": "[{\\"label\\":\\"Enterprise\\",\\"value\\":600000},{\\"label\\":\\"SMB\\",\\"value\\":400000},{\\"label\\":\\"Startup\\",\\"value\\":240000}]" } } },
            { "barChart": { "props": { "title": "Monthly Revenue", "data": "[{\\"label\\":\\"Oct\\",\\"value\\":380000},{\\"label\\":\\"Nov\\",\\"value\\":410000},{\\"label\\":\\"Dec\\",\\"value\\":450000}]" } } }
          ]
        }

        Respond with the JSON object only.
        """.strip();
}
