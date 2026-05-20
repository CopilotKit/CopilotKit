package com.copilotkit.showcase.springai;

import com.agui.core.agent.AgentSubscriber;
import com.agui.core.agent.AgentSubscriberParams;
import com.agui.core.agent.RunAgentInput;
import com.agui.core.exception.AGUIException;
import com.agui.core.message.AssistantMessage;
import com.agui.core.state.State;
import com.agui.server.LocalAgent;
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
 * BYOC json-render demo controller.
 *
 * <p>Runs a zero-tool agent whose system prompt instructs the LLM to emit a
 * single JSON object matching the {@code @json-render/react} flat-spec format:
 * {@code { root, elements }}. The frontend parses the JSON and renders it
 * through a Zod-validated catalog of three components (MetricCard, BarChart,
 * PieChart).
 *
 * <p>The system prompt is explicit about JSON-only output; the frontend's
 * parser tolerates code fences and prose preamble defensively.
 */
@RestController
public class ByocJsonRenderController {

    private static final Logger log =
            LoggerFactory.getLogger(ByocJsonRenderController.class);

    private static final String AGENT_ID = "byoc_json_render";

    private final AgUiService agUiService;
    private final ChatModel chatModel;

    @Autowired
    public ByocJsonRenderController(AgUiService agUiService, ChatModel chatModel) {
        this.agUiService = agUiService;
        this.chatModel = chatModel;
    }

    @PostMapping("/byoc-json-render/run")
    public ResponseEntity<SseEmitter> run(@RequestBody AgUiParameters params) {
        MessageListFilter.filterNulls(params);
        ByocJsonRenderAgent agent = new ByocJsonRenderAgent(chatModel);
        SseEmitter emitter = agUiService.runAgent(agent, params);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }

    /**
     * Per-request agent. Zero tools, JSON-object response format, sales-dashboard
     * system prompt. The model emits a single JSON object that the frontend's
     * {@code JsonRenderAssistantMessage} parses and renders via
     * {@code @json-render/react}.
     */
    static class ByocJsonRenderAgent extends LocalAgent {

        private final ChatClient chatClient;

        ByocJsonRenderAgent(ChatModel chatModel) {
            super(AGENT_ID, new State(), new ArrayList<>());
            this.chatClient = ChatClient.builder(chatModel).build();
        }

        @Override
        protected void run(RunAgentInput input, AgentSubscriber subscriber) {
            this.combineMessages(input);

            String messageId = UUID.randomUUID().toString();
            String threadId = input.threadId();
            String runId = input.runId();

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

            this.emitEvent(textMessageEndEvent(messageId), subscriber);
            subscriber.onNewMessage(assistantMessage);
            this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
            subscriber.onRunFinalized(
                    new AgentSubscriberParams(input.messages(), state, this, input));
        }
    }

    /**
     * System prompt instructing the LLM to emit a flat-spec JSON object for
     * {@code @json-render/react}. Matches the Python reference agent's prompt.
     */
    static final String SYSTEM_PROMPT = """
        You are a sales-dashboard UI generator for a BYOC json-render demo.

        When the user asks for a UI, respond with **exactly one JSON object** and
        nothing else — no prose, no markdown fences, no leading explanation. The
        object must match this schema (the "flat element map" format consumed by
        `@json-render/react`):

        {
          "root": "<id of the root element>",
          "elements": {
            "<id>": {
              "type": "<component name>",
              "props": { ... component-specific props ... },
              "children": [ "<id>", ... ]
            },
            ...
          }
        }

        Available components (use each name verbatim as "type"):

        - MetricCard
          props: { "label": string, "value": string, "trend": string | null }
          Example trend strings: "+12% vs last quarter", "-3% vs last month", null.

        - BarChart
          props: {
            "title": string,
            "description": string | null,
            "data": [ { "label": string, "value": number }, ... ]
          }

        - PieChart
          props: {
            "title": string,
            "description": string | null,
            "data": [ { "label": string, "value": number }, ... ]
          }

        Rules:

        1. Output **only** valid JSON. No markdown code fences. No text outside
           the object.
        2. Every id referenced in `root` or any `children` array must be a key
           in `elements`.
        3. For a multi-component dashboard, use a root MetricCard and list the
           charts in its `children` array, OR pick any element as root and list
           the others as its children. Do not emit orphan elements.
        4. Use realistic sales-domain values (revenue, pipeline, conversion,
           categories, months) — the demo is a sales dashboard.
        5. `children` is optional but when present must be an array of strings.
        6. Never invent component types outside the three listed above.

        ### Worked example — "Show me the sales dashboard with metrics and a revenue chart"

        {
          "root": "revenue-metric",
          "elements": {
            "revenue-metric": {
              "type": "MetricCard",
              "props": {
                "label": "Revenue (Q3)",
                "value": "$1.24M",
                "trend": "+18% vs Q2"
              },
              "children": ["revenue-bar"]
            },
            "revenue-bar": {
              "type": "BarChart",
              "props": {
                "title": "Monthly revenue",
                "description": "Revenue by month across Q3",
                "data": [
                  { "label": "Jul", "value": 380000 },
                  { "label": "Aug", "value": 410000 },
                  { "label": "Sep", "value": 450000 }
                ]
              }
            }
          }
        }

        ### Worked example — "Break down revenue by category as a pie chart"

        {
          "root": "category-pie",
          "elements": {
            "category-pie": {
              "type": "PieChart",
              "props": {
                "title": "Revenue by category",
                "description": "Share of total revenue by product category",
                "data": [
                  { "label": "Enterprise", "value": 540000 },
                  { "label": "SMB", "value": 310000 },
                  { "label": "Self-serve", "value": 220000 },
                  { "label": "Partner", "value": 170000 }
                ]
              }
            }
          }
        }

        ### Worked example — "Show me monthly expenses as a bar chart"

        {
          "root": "expense-bar",
          "elements": {
            "expense-bar": {
              "type": "BarChart",
              "props": {
                "title": "Monthly expenses",
                "description": "Operating expenses by month",
                "data": [
                  { "label": "Jul", "value": 210000 },
                  { "label": "Aug", "value": 225000 },
                  { "label": "Sep", "value": 240000 }
                ]
              }
            }
          }
        }

        Respond with the JSON object only.
        """.strip();
}
