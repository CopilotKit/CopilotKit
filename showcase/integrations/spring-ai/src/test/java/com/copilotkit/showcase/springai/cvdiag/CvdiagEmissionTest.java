package com.copilotkit.showcase.springai.cvdiag;

import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagBoundary;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagEnvelope;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagLayer;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagOutcome;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * L1-G instrumentation tests for the spring-ai backend CVDIAG wiring
 * ({@link CvdiagBackend} / {@link CvdiagBackend.CvdiagRun}).
 *
 * <p>These assert that a single synthetic chat run drives all <b>11 backend
 * boundaries</b> through the inlined {@link CvdiagEmitter} (decision D4), in the
 * canonical order, with the per-boundary metadata the spec §5 table declares,
 * and that PII in {@code backend.error.caught} is scrubbed via
 * {@link MessageScrubber} before it leaves the process.
 *
 * <p>The boundaries are exercised against {@link CvdiagBackend.CvdiagRun} (the
 * per-request emit façade the real handler sites call —
 * {@code AimockHeaderInterceptor.preHandle} for ingress,
 * {@code StreamingToolAgent.run} for agent/LLM/SSE, and the
 * {@code @RestControllerAdvice} for error.caught) so the contract is pinned
 * without a live LLM or a real Tomcat stream, which CI cannot provide.
 */
class CvdiagEmissionTest {

    private final ObjectMapper mapper = new ObjectMapper();

    /** The 11 backend boundaries, in canonical (handler-site) emit order. */
    private static final List<CvdiagBoundary> EXPECTED_BACKEND_BOUNDARIES = List.of(
            CvdiagBoundary.BACKEND_REQUEST_INGRESS,
            CvdiagBoundary.BACKEND_AGENT_ENTER,
            CvdiagBoundary.BACKEND_LLM_CALL_START,
            CvdiagBoundary.BACKEND_LLM_CALL_HEARTBEAT,
            CvdiagBoundary.BACKEND_LLM_CALL_RESPONSE,
            CvdiagBoundary.BACKEND_SSE_FIRST_BYTE,
            CvdiagBoundary.BACKEND_SSE_EVENT,
            CvdiagBoundary.BACKEND_SSE_ABORTED,
            CvdiagBoundary.BACKEND_ERROR_CAUGHT,
            CvdiagBoundary.BACKEND_AGENT_EXIT,
            CvdiagBoundary.BACKEND_RESPONSE_COMPLETE);

    /**
     * Build a DEBUG-tier backend emitter (so {@code backend.sse.event} — a
     * DEBUG-only boundary per §6 — is retained) that records every emitted
     * envelope into {@code sink} instead of (only) logging.
     */
    private CvdiagBackend debugBackendInto(List<CvdiagEnvelope> sink) {
        Map<String, String> env = new HashMap<>();
        env.put("SHOWCASE_ENV", "test");
        env.put("CVDIAG_DEBUG", "1");
        env.put("CVDIAG_DEBUG_ALLOW_LIST", "agentic_chat");
        CvdiagEmitter emitter = new CvdiagEmitter(new CvdiagEmitter.Options()
                .env(env)
                .layer(CvdiagLayer.BACKEND));
        // Synchronous observer (not the emitter's async PB writer) so emitted
        // envelopes are deterministically present when the test asserts.
        return new CvdiagBackend(emitter, true, sink::add);
    }

    // (1) All 11 backend boundaries emit for one synthetic chat run, in the
    // canonical handler-site order.
    @Test
    void allElevenBackendBoundariesEmitForOneRun() {
        List<CvdiagEnvelope> emitted = new ArrayList<>();
        CvdiagBackend backend = debugBackendInto(emitted);

        Map<String, String> headers = new HashMap<>();
        headers.put("x-test-id", "017f22e2-79b0-7cc3-98c4-dc0c0c07398f");
        headers.put("x-aimock-context", "agentic_chat");

        // ingress (interceptor site)
        CvdiagBackend.CvdiagRun run = backend.beginRun(headers, "POST", "/", 42L);
        // agent enter (StreamingToolAgent.run start)
        run.agentEnter("agentic_chat", "gpt-4.1");
        // LLM call start + heartbeat + response (streamFirstTurn site)
        run.llmCallStart("openai", "gpt-4.1", 8);
        run.llmHeartbeat();
        run.llmCallResponse("openai", "gpt-4.1", 12L, 30L, null);
        // SSE first byte + event (emitEvent sites)
        run.sseFirstByte();
        run.sseEvent("TEXT_MESSAGE_CONTENT", 24);
        // abnormal termination + error
        run.sseAborted("upstream_reset", 24L);
        run.errorCaught(new RuntimeException("boom"));
        // agent exit + response complete (terminal finalize)
        run.agentExit(CvdiagOutcome.ERR);
        run.responseComplete(500, 0L);

        List<CvdiagBoundary> seen = emitted.stream()
                .map(CvdiagEnvelope::boundary)
                .collect(Collectors.toList());

        assertThat(seen).containsExactlyElementsOf(EXPECTED_BACKEND_BOUNDARIES);
        // Every boundary carries the run's test_id (joinable).
        assertThat(emitted).allSatisfy(e ->
                assertThat(e.testId()).isEqualTo("017f22e2-79b0-7cc3-98c4-dc0c0c07398f"));
        // Every boundary is layer=backend.
        assertThat(emitted).allSatisfy(e ->
                assertThat(e.layer()).isEqualTo(CvdiagLayer.BACKEND));
        // slug propagates from x-aimock-context.
        assertThat(emitted).allSatisfy(e ->
                assertThat(e.slug()).isEqualTo("agentic_chat"));
    }

    // (2) Per-boundary metadata matches the spec §5 closed-world key sets
    // (the emitter drops anything else — assert nothing was dropped, i.e. the
    // wiring uses ONLY declared keys).
    @Test
    void boundaryMetadataMatchesDeclaredKeys() {
        List<CvdiagEnvelope> emitted = new ArrayList<>();
        CvdiagBackend backend = debugBackendInto(emitted);

        CvdiagBackend.CvdiagRun run = backend.beginRun(
                Map.of("x-aimock-context", "agentic_chat"), "POST", "/api/copilotkit", 17L);
        run.agentEnter("agentic_chat", "gpt-4.1");
        run.llmCallStart("openai", "gpt-4.1", 8);
        run.llmHeartbeat();
        run.llmCallResponse("openai", "gpt-4.1", 12L, 30L, null);
        run.sseFirstByte();
        run.sseEvent("TEXT_MESSAGE_CONTENT", 24);
        run.agentExit(CvdiagOutcome.OK);
        run.responseComplete(200, 256L);

        // No data-plane boundary may have dropped a metadata key — every key we
        // wired is in the declared closed-world set.
        assertThat(emitted).allSatisfy(e ->
                assertThat(e.metadataDropped())
                        .as("boundary %s dropped a metadata key", e.boundary().wire())
                        .isNull());

        Map<CvdiagBoundary, Map<String, Object>> byBoundary = emitted.stream()
                .collect(Collectors.toMap(CvdiagEnvelope::boundary, CvdiagEnvelope::metadata, (a, b) -> a));

        assertThat(byBoundary.get(CvdiagBoundary.BACKEND_REQUEST_INGRESS))
                .containsKeys("method", "path", "content_length");
        assertThat(byBoundary.get(CvdiagBoundary.BACKEND_AGENT_ENTER))
                .containsEntry("agent_name", "agentic_chat")
                .containsEntry("model_id", "gpt-4.1");
        assertThat(byBoundary.get(CvdiagBoundary.BACKEND_LLM_CALL_START))
                .containsKeys("provider", "model", "prompt_token_count_estimate");
        assertThat(byBoundary.get(CvdiagBoundary.BACKEND_LLM_CALL_HEARTBEAT))
                .containsKey("elapsed_ms_since_start");
        assertThat(byBoundary.get(CvdiagBoundary.BACKEND_LLM_CALL_RESPONSE))
                .containsKeys("provider", "model", "response_token_count", "latency_ms");
        assertThat(byBoundary.get(CvdiagBoundary.BACKEND_SSE_FIRST_BYTE))
                .containsKey("delta_ms_from_ingress");
        assertThat(byBoundary.get(CvdiagBoundary.BACKEND_SSE_EVENT))
                .containsKeys("event_type", "payload_size_bytes", "sequence_num");
        assertThat(byBoundary.get(CvdiagBoundary.BACKEND_AGENT_EXIT))
                .containsKeys("terminal_outcome", "total_duration_ms");
        assertThat(byBoundary.get(CvdiagBoundary.BACKEND_RESPONSE_COMPLETE))
                .containsKeys("http_status", "content_length", "total_duration_ms", "sse_event_count");
    }

    // (3) backend.error.caught scrubs PII (Bearer / sk- secret) from the
    // captured exception message (spec §6 / R6-F3).
    @Test
    void errorCaughtScrubsSecretsFromMessage() {
        List<CvdiagEnvelope> emitted = new ArrayList<>();
        CvdiagBackend backend = debugBackendInto(emitted);

        CvdiagBackend.CvdiagRun run = backend.beginRun(Map.of(), "POST", "/", 0L);
        run.errorCaught(new IllegalStateException(
                "upstream rejected Authorization: Bearer sk-test-1234567890ABCDEF for tenant"));

        CvdiagEnvelope err = emitted.stream()
                .filter(e -> e.boundary() == CvdiagBoundary.BACKEND_ERROR_CAUGHT)
                .findFirst()
                .orElseThrow();
        String scrubbed = String.valueOf(err.metadata().get("message_scrubbed"));
        assertThat(scrubbed).doesNotContain("sk-test-1234567890ABCDEF");
        assertThat(scrubbed).doesNotContain("Bearer sk-");
        assertThat(scrubbed).contains("[REDACTED]");
        assertThat(err.metadata()).containsKey("exception_type");
        assertThat(err.outcome()).isEqualTo(CvdiagOutcome.ERR);
    }

    // (4) Default-OFF guard: a disabled backend emits nothing (the
    // @ConditionalOnProperty default; here exercised via the enabled flag).
    @Test
    void disabledBackendEmitsNothing() {
        List<CvdiagEnvelope> emitted = new ArrayList<>();
        CvdiagEmitter emitter = new CvdiagEmitter(new CvdiagEmitter.Options()
                .env(Map.of("SHOWCASE_ENV", "test"))
                .layer(CvdiagLayer.BACKEND)
                .pbWriter(emitted::add));
        CvdiagBackend backend = new CvdiagBackend(emitter, false);

        CvdiagBackend.CvdiagRun run = backend.beginRun(Map.of(), "POST", "/", 0L);
        run.agentEnter("agentic_chat", "gpt-4.1");
        run.llmCallStart("openai", "gpt-4.1", 8);
        run.responseComplete(200, 0L);

        assertThat(emitted).isEmpty();
        assertThat(backend.enabled()).isFalse();
    }

    // (5) MessageScrubber unit coverage mirrors the canonical TS scrubSecrets
    // (Bearer / sk- / URL userinfo).
    @Test
    void messageScrubberRedactsKnownSecretShapes() {
        assertThat(MessageScrubber.scrub("Authorization: Bearer abc.def.ghi token"))
                .doesNotContain("abc.def.ghi")
                .contains("[REDACTED]");
        assertThat(MessageScrubber.scrub("key=sk-ABCDEFGHIJKLMNOPQRSTUV end"))
                .doesNotContain("sk-ABCDEFGHIJKLMNOPQRSTUV")
                .contains("[REDACTED]");
        assertThat(MessageScrubber.scrub("postgres://user:hunter2@db:5432/x"))
                .doesNotContain("hunter2")
                .contains("[REDACTED]");
        assertThat(MessageScrubber.scrub(null)).isNull();
    }
}
