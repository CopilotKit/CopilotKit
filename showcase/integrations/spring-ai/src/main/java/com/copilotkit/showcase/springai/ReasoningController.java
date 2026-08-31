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

import jakarta.annotation.PreDestroy;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;
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
 * {@code REASONING_MESSAGE_CONTENT} → {@code REASONING_MESSAGE_END}
 * → {@code TEXT_MESSAGE_START/CONTENT/END} → {@code RUN_FINISHED}. The full
 * stream is buffered and the reasoning text is emitted as a single
 * {@code REASONING_MESSAGE_CONTENT} delta (not chunk-by-chunk). The frontend
 * (CopilotKit reasoning slot) then mounts {@code [data-testid="reasoning-block"]}
 * for the {@code reasoning-custom} cell and the "Thinking…/Thought for …" card
 * for {@code reasoning-default}. Like the AG2 reference (and the agno
 * reference both descend from), the full multi-turn conversation history is
 * threaded into the chat-completions request so follow-up questions keep
 * their context — see {@link #buildRequestBody(List)}.
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
 *       delta} / {@code role:"reasoning"}).</li>
 * </ol>
 *
 * <p><b>Wire-contract source of truth.</b> Every raw-JSON frame this controller
 * emits (RUN_*, REASONING_MESSAGE_*, TEXT_MESSAGE_*) was verified against the
 * {@code @ag-ui/core} zod schemas at version 0.0.56 (the installed version) —
 * field names, required fields, and the {@code role:"reasoning"} literal all
 * follow those schemas. Other comments in this file refer back to this note.
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

    // Intentional divergence from the Python ports' `gpt-4o-mini`: model is not
    // part of the aimock fixture match keys, and the spring-ai fixture was
    // recorded with this model. Behavior parity is unaffected.
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

    // Dedicated bounded executor for reasoning runs. Each run BLOCKS its worker
    // thread for the full streaming chat-completions call (stream.toIterable()),
    // so running on ForkJoinPool.commonPool() would let concurrent reasoning
    // requests exhaust the CPU-count-sized common pool and starve unrelated
    // parallel work in the JVM. A small fixed pool of daemon threads isolates
    // that blocking work and never blocks JVM shutdown.
    private final ExecutorService reasoningExecutor =
            Executors.newFixedThreadPool(4, new ThreadFactory() {
                private final AtomicInteger counter = new AtomicInteger(1);

                @Override
                public Thread newThread(Runnable r) {
                    Thread t = new Thread(r, "reasoning-" + counter.getAndIncrement());
                    t.setDaemon(true);
                    return t;
                }
            });

    @PreDestroy
    void shutdownReasoningExecutor() {
        reasoningExecutor.shutdown();
    }

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
        // @ag-ui/core's RUN_STARTED/RUN_FINISHED zod schemas (see the
        // wire-contract note in the class Javadoc) require BOTH threadId and
        // runId, so give threadId the same UUID fallback as runId rather than
        // risk emitting a frame with a missing field.
        String threadId = params.getThreadId() != null
                ? params.getThreadId() : UUID.randomUUID().toString();
        String runId = params.getRunId() != null
                ? params.getRunId() : UUID.randomUUID().toString();
        String requestBody = buildRequestBody(params.getMessages());

        // Capture the x-* header context (incl. x-aimock-context) on the
        // request thread, where AimockHeaderInterceptor has populated it. This
        // MUST happen before the runAsync hop — the controller returns the
        // emitter and afterCompletion() clears the request-thread binding.
        Map<String, String> aimockHeaders = AimockHeaderContext.capture();

        // Run the LLM call + emission off the request thread so the controller
        // returns the emitter immediately (matching AgUiService semantics). Two
        // requirements at this hop:
        //  1. The captured headers are re-established on the worker thread via
        //     runWith — InheritableThreadLocal does NOT propagate to a
        //     pre-existing pooled worker, so without this the outbound
        //     chat-completions call loses x-aimock-context (aimock strict 503).
        //     Mirrors PropagatingLocalAgent's capture/runWith idiom.
        //  2. Use the dedicated bounded reasoningExecutor — NOT the ForkJoinPool
        //     common pool — because runReasoning() blocks its worker thread for
        //     the entire streaming call (stream.toIterable()).
        CompletableFuture.runAsync(() ->
                AimockHeaderContext.runWith(aimockHeaders, () ->
                        runReasoning(emitter, threadId, runId, requestBody)),
                reasoningExecutor);

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }

    /**
     * Builds the chat-completions request body, threading the full
     * conversation history: system prompt first, then every prior
     * user/assistant turn (in order) with its text content. tool/system
     * messages from the input are skipped — only the conversation turns are
     * threaded so follow-up questions keep their context (parity with the
     * agno reference, which threads full history through Agno's Agent).
     *
     * <p>For a single user-message input this produces exactly
     * {@code [{system}, {user: <text>}]} — byte-equal to the previous
     * single-turn behaviour, which the aimock fixtures replay. When the input
     * has no user/assistant turns the result is {@code [{system}, {user: ""}]}
     * (an empty user turn), preserving the prior empty-input behaviour.
     */
    private String buildRequestBody(List<BaseMessage> messages) {
        ObjectNode body = objectMapper.createObjectNode();
        body.put("model", MODEL);
        body.put("stream", true);
        ArrayNode chat = body.putArray("messages");
        ObjectNode system = chat.addObject();
        system.put("role", "system");
        system.put("content", SYSTEM_PROMPT);

        boolean appendedTurn = false;
        if (messages != null) {
            for (BaseMessage msg : messages) {
                if (msg == null) {
                    continue;
                }
                Role role = msg.getRole();
                if (role != Role.user && role != Role.assistant) {
                    continue;
                }
                String content = msg.getContent();
                ObjectNode turn = chat.addObject();
                turn.put("role", role == Role.user ? "user" : "assistant");
                turn.put("content", content != null ? content : "");
                appendedTurn = true;
            }
        }
        // No conversation turns — preserve the prior empty-input behaviour
        // (an empty user turn) so the request shape stays well-formed.
        if (!appendedTurn) {
            ObjectNode user = chat.addObject();
            user.put("role", "user");
            user.put("content", "");
        }

        try {
            return objectMapper.writeValueAsString(body);
        } catch (Exception e) {
            // Should never happen for a hand-built ObjectNode.
            throw new IllegalStateException("Failed to serialize request body", e);
        }
    }

    /**
     * Streams one reasoning run, synthesizing REASONING_MESSAGE_* events.
     * Mirrors AG2's {@code _run_reasoning_agent}: buffer both channels of the
     * single streaming chat-completions call, split reasoning from answer, then
     * emit REASONING_MESSAGE_* (if any) followed by TEXT_MESSAGE_*.
     */
    private void runReasoning(SseEmitter emitter, String threadId, String runId,
                              String requestBody) {
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

            // Track per-chunk parse failures so a systematic format change
            // (every chunk unparseable → empty output) surfaces as one warn
            // instead of vanishing into off-by-default debug logging.
            int parseFailures = 0;
            Exception lastParseErr = null;

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
                    .bodyValue(requestBody)
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
                        parseFailures++;
                        lastParseErr = parseErr;
                        log.debug("Skipping unparseable chat-completion chunk", parseErr);
                    }
                }
            }

            // Any parse failure is worth one warn: a partially-corrupt stream
            // (some chunks parsed, some dropped) would otherwise truncate the
            // turn silently. Report the count, the last error, and whether any
            // content survived so both the total-empty and partial cases show up.
            if (parseFailures > 0) {
                boolean producedContent =
                        fullText.length() > 0 || nativeReasoning.length() > 0;
                log.warn("reasoning stream: {} chunk(s) failed to parse"
                        + " (content produced: {}) — last error:",
                        parseFailures, producedContent, lastParseErr);
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

            // The stream completed successfully but yielded neither reasoning
            // nor answer text — the run would otherwise emit RUN_STARTED →
            // RUN_FINISHED with zero message frames and no diagnostics. Warn
            // once so a silent-empty run is visible (no synthetic frames). Skip
            // when parseFailures > 0 already warned above, to avoid a double
            // warn for the same empty turn.
            if (reasoningText.isEmpty() && answerText.isEmpty()
                    && parseFailures == 0) {
                log.warn("reasoning stream completed but produced no reasoning"
                        + " or answer text");
            }

            // Emit reasoning message if we captured reasoning content.
            if (!reasoningText.isEmpty()) {
                reasoningMsgId = UUID.randomUUID().toString();
                send(emitter, reasoningStart(reasoningMsgId));
                send(emitter, reasoningContent(reasoningMsgId, reasoningText));
                send(emitter, reasoningEnd(reasoningMsgId));
                reasoningMsgId = null;
            }

            // Emit a text message only when there's a non-empty answer, so
            // CopilotKit renders the answer bubble (matches the Python siblings).
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

    // threadId and runId are both guaranteed non-null by run() (UUID fallback),
    // and @ag-ui/core's zod schemas require BOTH on RUN_STARTED/RUN_FINISHED
    // (see the wire-contract note in the class Javadoc), so write them
    // unconditionally.
    private ObjectNode runStarted(String threadId, String runId) {
        ObjectNode n = event("RUN_STARTED");
        n.put("threadId", threadId);
        n.put("runId", runId);
        return n;
    }

    private ObjectNode runFinished(String threadId, String runId) {
        ObjectNode n = event("RUN_FINISHED");
        n.put("threadId", threadId);
        n.put("runId", runId);
        return n;
    }

    private ObjectNode runError(String message) {
        ObjectNode n = event("RUN_ERROR");
        n.put("message", message);
        return n;
    }

    // REASONING_MESSAGE_* frames — wire shape per the @ag-ui/core zod schemas
    // (see the wire-contract note in the class Javadoc): camelCase messageId,
    // role literal "reasoning". The Java SDK has no event class for these, so
    // we build the JSON by hand.
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
