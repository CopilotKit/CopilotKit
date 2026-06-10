package com.copilotkit.showcase.springai;

import com.agui.core.message.BaseMessage;
import com.agui.core.message.Role;
import com.agui.server.spring.AgUiParameters;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reasoning demo — dedicated controller at {@code /reasoning/}.
 *
 * <p>Backs two showcase cells (both share this one backend):
 * <ul>
 *   <li>{@code reasoning-custom} — custom amber {@code ReasoningBlock} slot</li>
 *   <li>{@code reasoning-default} — CopilotKit's built-in reasoning card</li>
 * </ul>
 *
 * <p>This is the Spring/Java reimplementation of the AG2 Python reference
 * (showcase/integrations/ag2/src/agents/reasoning_agent.py). It replicates the
 * AG2 BEHAVIOR — it is NOT a verbatim port. The emitted wire sequence is:
 * {@code RUN_STARTED} → {@code REASONING_MESSAGE_START} →
 * {@code REASONING_MESSAGE_CONTENT}(streamed) → {@code REASONING_MESSAGE_END}
 * → {@code TEXT_MESSAGE_START/CONTENT/END} → {@code RUN_FINISHED}. The frontend
 * (CopilotKit reasoning slot) then mounts {@code [data-testid="reasoning-block"]}
 * for the {@code reasoning-custom} cell and the "Thinking…/Thought for …" card
 * for {@code reasoning-default}.
 *
 * <h2>Why a custom controller (not StreamingToolAgent + AgUiService)</h2>
 * <p>Two independent gaps force a bespoke SSE path:</p>
 * <ol>
 *   <li><b>Spring AI drops the reasoning channel.</b> Spring AI 1.0.1's OpenAI
 *       {@code ChatClient} only surfaces {@code delta.content} / tool calls; it
 *       discards the {@code delta.reasoning_content} side-channel that aimock
 *       fixtures (the {@code reasoning} field) and reasoning models emit. So we
 *       call the OpenAI-compatible chat-completions endpoint directly
 *       (streaming) and read BOTH channels ourselves — exactly what AG2's
 *       reference does after rejecting autogen's stock {@code AGUIStream}.</li>
 *   <li><b>The AG-UI Java SDK has no REASONING_MESSAGE_* event types.</b> The
 *       SDK's {@code EventType} enum + Jackson {@code EventMixin} only know
 *       THINKING_* (which {@code @ag-ui/client} silently drops) — there is no
 *       {@code REASONING_MESSAGE_*} subtype, so {@code AgUiService}'s
 *       mixin-based serializer cannot emit them. We therefore manage our own
 *       {@link SseEmitter} and write the reasoning frames as raw JSON whose
 *       {@code type} is the literal {@code REASONING_MESSAGE_*} string the
 *       frontend's zod decoder expects (camelCase {@code messageId} / {@code
 *       delta} / {@code role:"reasoning"} per @ag-ui/client 0.0.55).</li>
 * </ol>
 *
 * <p>The shape (RestController, {@code MessageListFilter.filterNulls},
 * {@code AgUiParameters} body, {@code CacheControl.noCache()}) mirrors the other
 * spring-ai controllers ({@link SubagentsController}, {@link AgentController}).
 * Header forwarding ({@code x-aimock-context}) rides the
 * {@link WebClientConfig#http11WebClientCustomizer()} exchange filter, which is
 * applied to the auto-configured {@link WebClient.Builder} this controller
 * injects, so the outbound chat-completions call matches the spring-ai-scoped
 * aimock fixture.
 */
@RestController
public class ReasoningController {

    private static final Logger log = LoggerFactory.getLogger(ReasoningController.class);

    private static final String SYSTEM_PROMPT =
            "You are a helpful assistant. For each user question, first think "
            + "step-by-step about the approach, then give a concise answer.";

    private static final String MODEL = "gpt-4.1";

    // Mirrors AG2's _REASONING_PATTERN (DOTALL | IGNORECASE) — the defensive
    // fallback for models / fixtures that inline <reasoning>…</reasoning> in
    // the text channel instead of using the native reasoning_content channel.
    private static final Pattern REASONING_PATTERN = Pattern.compile(
            "<reasoning>(.*?)</reasoning>",
            Pattern.DOTALL | Pattern.CASE_INSENSITIVE);

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final String baseUrl;
    private final String apiKey;

    @Autowired
    public ReasoningController(
            WebClient.Builder webClientBuilder,
            ObjectMapper objectMapper,
            @Value("${spring.ai.openai.base-url:https://api.openai.com}") String baseUrl,
            @Value("${spring.ai.openai.api-key:}") String apiKey) {
        // Built from the auto-configured builder so the WebClientConfig
        // customizer (JDK HTTP/1.1 connector + x-* header-forwarding filter)
        // applies — this is how x-aimock-context reaches aimock.
        this.webClient = webClientBuilder.build();
        this.objectMapper = objectMapper;
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }

    @PostMapping(value = {"/reasoning/", "/reasoning"})
    public ResponseEntity<SseEmitter> run(@RequestBody AgUiParameters params) {
        MessageListFilter.filterNulls(params);

        SseEmitter emitter = new SseEmitter(Long.MAX_VALUE);
        String threadId = params.getThreadId();
        String runId = params.getRunId() != null
                ? params.getRunId() : UUID.randomUUID().toString();
        String userInput = extractUserInput(params.getMessages());

        // Run the LLM call + emission off the request thread so the controller
        // returns the emitter immediately (matching AgUiService semantics).
        CompletableFuture.runAsync(() ->
                runReasoning(emitter, threadId, runId, userInput));

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }

    /** Returns the last user message's text content (stock AG-UI behaviour). */
    private String extractUserInput(List<BaseMessage> messages) {
        if (messages == null) {
            return "";
        }
        for (int i = messages.size() - 1; i >= 0; i--) {
            BaseMessage msg = messages.get(i);
            if (msg != null && msg.getRole() == Role.user) {
                String content = msg.getContent();
                return content != null ? content : "";
            }
        }
        return "";
    }

    /**
     * Streams one reasoning run, synthesizing REASONING_MESSAGE_* events.
     * Mirrors AG2's {@code _run_reasoning_agent}: buffer both channels of the
     * single streaming chat-completions call, split reasoning from answer, then
     * emit REASONING_MESSAGE_* (if any) followed by TEXT_MESSAGE_*.
     */
    private void runReasoning(SseEmitter emitter, String threadId, String runId,
                              String userInput) {
        // Track the in-flight message frame so a mid-stream failure can close it
        // with the matching *_END before RUN_ERROR. @ag-ui/client's verifyEvents
        // otherwise leaves a half-built message in client state, and RUN_ERROR is
        // a terminal event (see the catch block).
        String reasoningMsgId = null;
        String textMsgId = null;
        try {
            send(emitter, runStarted(threadId, runId));

            StringBuilder fullText = new StringBuilder();
            StringBuilder nativeReasoning = new StringBuilder();

            // Single streaming chat-completions call. The header-forwarding
            // exchange filter (WebClientConfig) carries x-aimock-context so
            // aimock matches the spring-ai-scoped fixture. base-url points at
            // aimock in local/D6 runs and at the real API in production.
            Flux<String> stream = webClient.post()
                    .uri(baseUrl + "/v1/chat/completions")
                    .contentType(MediaType.APPLICATION_JSON)
                    .headers(h -> {
                        if (apiKey != null && !apiKey.isBlank()) {
                            h.setBearerAuth(apiKey);
                        }
                        h.set("Accept", MediaType.TEXT_EVENT_STREAM_VALUE);
                    })
                    .bodyValue(buildRequestBody(userInput))
                    .retrieve()
                    .bodyToFlux(String.class);

            // When the response is text/event-stream, bodyToFlux(String) yields
            // each SSE event's data payload (prefix already stripped). But to
            // stay robust if the connector hands back raw SSE text (or several
            // frames batched into one String), we defensively re-split on lines
            // and strip any residual "data:" prefix before JSON-parsing each
            // chat-completion chunk. The literal "[DONE]" sentinel is skipped.
            for (String chunk : stream.toIterable()) {
                if (chunk == null) {
                    continue;
                }
                for (String line : chunk.split("\\r?\\n")) {
                    String payload = line.strip();
                    if (payload.startsWith("data:")) {
                        payload = payload.substring("data:".length()).strip();
                    }
                    if (payload.isEmpty() || "[DONE]".equals(payload)
                            || !payload.startsWith("{")) {
                        continue;
                    }
                    try {
                        JsonNode node = objectMapper.readTree(payload);
                        JsonNode choices = node.path("choices");
                        if (!choices.isArray() || choices.isEmpty()) {
                            continue;
                        }
                        JsonNode delta = choices.get(0).path("delta");
                        // Native reasoning channel — aimock `reasoning` field /
                        // reasoning models surface this as delta.reasoning_content.
                        JsonNode reasoningPiece = delta.path("reasoning_content");
                        if (reasoningPiece.isTextual()) {
                            nativeReasoning.append(reasoningPiece.asText());
                        }
                        JsonNode contentPiece = delta.path("content");
                        if (contentPiece.isTextual()) {
                            fullText.append(contentPiece.asText());
                        }
                    } catch (Exception parseErr) {
                        log.debug("Skipping unparseable chat-completion chunk", parseErr);
                    }
                }
            }

            String reasoningText;
            String answerText;
            String nativeReasoningStr = nativeReasoning.toString().strip();
            String fullTextStr = fullText.toString();

            if (!nativeReasoningStr.isEmpty()) {
                // Native channel present — gold-standard parity path. The
                // answer is the streamed text minus any stray <reasoning> tags.
                reasoningText = nativeReasoningStr;
                answerText = REASONING_PATTERN.matcher(fullTextStr)
                        .replaceAll("").strip();
            } else {
                // Fallback: parse <reasoning>…</reasoning> tags out of the text
                // (non-reasoning models / no-native-reasoning fixtures).
                Matcher match = REASONING_PATTERN.matcher(fullTextStr);
                if (match.find()) {
                    reasoningText = match.group(1).strip();
                    answerText = (fullTextStr.substring(0, match.start())
                            + fullTextStr.substring(match.end())).strip();
                } else {
                    reasoningText = "";
                    answerText = fullTextStr.strip();
                }
            }

            // Emit reasoning message if we captured reasoning content.
            if (!reasoningText.isEmpty()) {
                reasoningMsgId = UUID.randomUUID().toString();
                send(emitter, reasoningStart(reasoningMsgId));
                send(emitter, reasoningContent(reasoningMsgId, reasoningText));
                send(emitter, reasoningEnd(reasoningMsgId));
                reasoningMsgId = null;
            }

            // Always emit a text message so CopilotKit renders the answer bubble.
            if (!answerText.isEmpty()) {
                textMsgId = UUID.randomUUID().toString();
                send(emitter, textMessageStart(textMsgId));
                send(emitter, textMessageContent(textMsgId, answerText));
                send(emitter, textMessageEnd(textMsgId));
                textMsgId = null;
            }

            send(emitter, runFinished(threadId, runId));
            emitter.complete();
        } catch (Exception e) {
            log.error("Reasoning run failed", e);
            try {
                // Close any message frame opened before the failure so the
                // terminal RUN_ERROR is protocol-clean (no dangling *_START in
                // client state).
                if (textMsgId != null) {
                    send(emitter, textMessageEnd(textMsgId));
                }
                if (reasoningMsgId != null) {
                    send(emitter, reasoningEnd(reasoningMsgId));
                }
                // RUN_ERROR must follow a started run; keep the message generic
                // (no provider URLs / credentials in the SSE stream). RUN_ERROR
                // is terminal: @ag-ui/client's verifyEvents rejects ANY event
                // after it (it sets the errored flag and throws on the next
                // event), so we do NOT emit RUN_FINISHED here — the Python
                // siblings emit only RUN_ERROR for the same reason.
                send(emitter, runError(String.format(
                        "agent run failed: %s (see server logs)",
                        e.getClass().getSimpleName())));
                emitter.complete();
            } catch (Exception sendErr) {
                emitter.completeWithError(sendErr);
            }
        }
    }

    /** Chat-completions request body: system prompt + user turn, streaming. */
    private String buildRequestBody(String userInput) {
        ObjectNode body = objectMapper.createObjectNode();
        body.put("model", MODEL);
        body.put("stream", true);
        ArrayNode messages = body.putArray("messages");
        ObjectNode system = messages.addObject();
        system.put("role", "system");
        system.put("content", SYSTEM_PROMPT);
        ObjectNode user = messages.addObject();
        user.put("role", "user");
        user.put("content", userInput);
        try {
            return objectMapper.writeValueAsString(body);
        } catch (Exception e) {
            // Should never happen for a hand-built ObjectNode.
            throw new IllegalStateException("Failed to serialize request body", e);
        }
    }

    // -- SSE write + raw-JSON event builders ------------------------------

    /**
     * Writes one event as an SSE {@code data:} frame. Mirrors
     * {@code AgUiService}'s " " + json prefix so client SSE parsers that choke
     * on certain JSON leading bytes stay happy.
     */
    private void send(SseEmitter emitter, ObjectNode event) throws Exception {
        emitter.send(SseEmitter.event()
                .data(" " + objectMapper.writeValueAsString(event)).build());
    }

    private ObjectNode event(String type) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("type", type);
        return node;
    }

    private ObjectNode runStarted(String threadId, String runId) {
        ObjectNode n = event("RUN_STARTED");
        if (threadId != null) n.put("threadId", threadId);
        if (runId != null) n.put("runId", runId);
        return n;
    }

    private ObjectNode runFinished(String threadId, String runId) {
        ObjectNode n = event("RUN_FINISHED");
        if (threadId != null) n.put("threadId", threadId);
        if (runId != null) n.put("runId", runId);
        return n;
    }

    private ObjectNode runError(String message) {
        ObjectNode n = event("RUN_ERROR");
        n.put("message", message);
        return n;
    }

    // REASONING_MESSAGE_* frames — wire shape per @ag-ui/client 0.0.55 zod
    // schema (camelCase messageId, role literal "reasoning"). The Java SDK has
    // no event class for these, so we build the JSON by hand.
    private ObjectNode reasoningStart(String messageId) {
        ObjectNode n = event("REASONING_MESSAGE_START");
        n.put("messageId", messageId);
        n.put("role", "reasoning");
        return n;
    }

    private ObjectNode reasoningContent(String messageId, String delta) {
        ObjectNode n = event("REASONING_MESSAGE_CONTENT");
        n.put("messageId", messageId);
        n.put("delta", delta);
        return n;
    }

    private ObjectNode reasoningEnd(String messageId) {
        ObjectNode n = event("REASONING_MESSAGE_END");
        n.put("messageId", messageId);
        return n;
    }

    private ObjectNode textMessageStart(String messageId) {
        ObjectNode n = event("TEXT_MESSAGE_START");
        n.put("messageId", messageId);
        n.put("role", "assistant");
        return n;
    }

    private ObjectNode textMessageContent(String messageId, String delta) {
        ObjectNode n = event("TEXT_MESSAGE_CONTENT");
        n.put("messageId", messageId);
        n.put("delta", delta);
        return n;
    }

    private ObjectNode textMessageEnd(String messageId) {
        ObjectNode n = event("TEXT_MESSAGE_END");
        n.put("messageId", messageId);
        return n;
    }
}
