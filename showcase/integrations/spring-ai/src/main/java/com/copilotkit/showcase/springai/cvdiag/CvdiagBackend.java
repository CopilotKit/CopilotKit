package com.copilotkit.showcase.springai.cvdiag;

import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagBoundary;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagLayer;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagOutcome;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.EdgeHeaders;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/**
 * Backend CVDIAG instrumentation façade for spring-ai (plan unit L1-G) — wires
 * the <b>11 backend boundaries</b> (spec §3 Layer 2) onto the inlined
 * {@link CvdiagEmitter} (decision D4). One {@link CvdiagRun} is minted per HTTP
 * request at the ingress interceptor and threaded through the agent body, so
 * every boundary for a run shares a single {@code test_id} (joinable).
 *
 * <p><b>Default OFF.</b> The bean is registered only when
 * {@code cvdiag.backend.emitter=on} (env {@code CVDIAG_BACKEND_EMITTER=on} via
 * Spring relaxed binding) — see {@link ConditionalOnProperty}. When absent, all
 * instrumentation call sites inject {@code null} (Spring
 * {@code @Autowired(required=false)}) and emit nothing. The {@link #enabled()}
 * flag is a second, in-bean guard used by tests to exercise the OFF path
 * without toggling the property.
 *
 * <p><b>Pure instrumentation.</b> Every method swallows its own failures
 * through {@link CvdiagEmitter#emitEvent} (which never throws into the observed
 * boundary). A CVDIAG failure must never alter request behavior.
 */
@Component
@ConditionalOnProperty(name = "cvdiag.backend.emitter", havingValue = "on")
public final class CvdiagBackend {

    /** Correlation header carrying the test id (UUIDv7 when present). */
    static final String HEADER_TEST_ID = "x-test-id";
    /** Correlation header carrying the aimock fixture slug. */
    static final String HEADER_AIMOCK_CONTEXT = "x-aimock-context";

    /** Max captured stack frames (spec §5 {@code stack_brief} ≤8 frames). */
    static final int STACK_BRIEF_MAX_FRAMES = 8;

    private final CvdiagEmitter emitter;
    private final boolean enabled;
    /**
     * Optional synchronous observer of every emitted envelope, invoked inline in
     * {@link #emit} (unlike the emitter's async PB writer). Test seam only; the
     * Spring constructor leaves it {@code null}.
     */
    private final Consumer<CvdiagSchema.CvdiagEnvelope> observer;

    /**
     * Spring constructor. The bean exists only under
     * {@code cvdiag.backend.emitter=on}; the emitter's verbosity tier is read
     * from the {@code CVDIAG_VERBOSE}/{@code CVDIAG_DEBUG} env (see
     * {@link CvdiagEmitter}). The pluggable {@code emitter} keeps this testable.
     */
    @Autowired
    public CvdiagBackend(@Value("${cvdiag.backend.emitter:off}") String mode) {
        this(new CvdiagEmitter(new CvdiagEmitter.Options().layer(CvdiagLayer.BACKEND)),
                "on".equalsIgnoreCase(mode));
    }

    /** Test/seam constructor: inject a pre-built emitter and the enabled flag. */
    public CvdiagBackend(CvdiagEmitter emitter, boolean enabled) {
        this(emitter, enabled, null);
    }

    /**
     * Test/seam constructor with a synchronous per-emit {@code observer} (invoked
     * inline, deterministically, before {@link #emit} returns — unlike the
     * emitter's async PB writer).
     */
    public CvdiagBackend(CvdiagEmitter emitter, boolean enabled,
                         Consumer<CvdiagSchema.CvdiagEnvelope> observer) {
        this.emitter = emitter;
        this.enabled = enabled;
        this.observer = observer;
    }

    /** Whether emission is enabled (the in-bean OFF guard). */
    public boolean enabled() {
        return enabled;
    }

    /**
     * Begin a run at the request-ingress boundary
     * ({@code backend.request.ingress}). Reads {@code test_id}/{@code slug} from
     * the captured {@code x-*} headers, captures the ingress edge headers, and
     * returns the per-run emit façade. {@code contentLength} is the request body
     * length ({@code null}/negative when unknown).
     */
    public CvdiagRun beginRun(Map<String, String> headers, String method, String path, Long contentLength) {
        Map<String, String> h = headers != null ? headers : Map.of();
        String testId = lower(h, HEADER_TEST_ID);
        if (!CvdiagSchema.isValidTestId(testId)) {
            testId = CvdiagEmitter.mintTestId();
        }
        String slug = lower(h, HEADER_AIMOCK_CONTEXT);
        EdgeHeaders edge = CvdiagSchema.filterEdgeHeaders(h);
        CvdiagRun run = new CvdiagRun(testId, slug, edge);
        run.requestIngress(method, path, contentLength);
        return run;
    }

    private static String lower(Map<String, String> headers, String key) {
        for (Map.Entry<String, String> e : headers.entrySet()) {
            if (e.getKey() != null && e.getKey().equalsIgnoreCase(key)) {
                return e.getValue();
            }
        }
        return null;
    }

    private Map<String, Object> meta(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            // Drop null values so closed-world validation keeps optional fields
            // absent rather than carrying an explicit null.
            if (kv[i + 1] != null) {
                m.put(String.valueOf(kv[i]), kv[i + 1]);
            }
        }
        return m;
    }

    private void emit(CvdiagRun run, CvdiagBoundary boundary, CvdiagOutcome outcome,
                      Long durationMs, Map<String, Object> metadata) {
        if (!enabled) {
            return;
        }
        CvdiagSchema.CvdiagEnvelope envelope = emitter.emitEvent(new CvdiagEmitter.EmitArgs()
                .layer(CvdiagLayer.BACKEND)
                .boundary(boundary)
                .testId(run.testId)
                .slug(run.slug)
                .parentSpanId(run.agentSpanId)
                .edgeHeaders(run.edge)
                .outcome(outcome)
                .durationMs(durationMs)
                .metadata(metadata));
        if (observer != null && envelope != null) {
            observer.accept(envelope);
        }
    }

    /**
     * Per-request emit façade. Holds the run's identity ({@code test_id},
     * {@code slug}, ingress edge headers), the ingress wall-clock baseline for
     * delta computations, the LLM-call baseline for heartbeat elapsed, and the
     * per-{@code (test_id, sse)} sequence counter (spec §5 {@code sequence_num}
     * resets to 0 per family).
     */
    public final class CvdiagRun {
        private final String testId;
        private final String slug;
        private final EdgeHeaders edge;
        private final long ingressMonoMs = System.currentTimeMillis();
        private final AtomicInteger sseSeq = new AtomicInteger(0);
        private final AtomicInteger sseEventCount = new AtomicInteger(0);
        private final AtomicLong llmStartMs = new AtomicLong(0L);
        // parent span for nested LLM/response boundaries (spec §3 OTel section).
        private volatile String agentSpanId;

        private CvdiagRun(String testId, String slug, EdgeHeaders edge) {
            this.testId = testId;
            this.slug = slug;
            this.edge = edge;
        }

        /** The run's joinable test id (also valid as a parent for callers). */
        public String testId() {
            return testId;
        }

        /** {@code backend.request.ingress} — HTTP request received. */
        void requestIngress(String method, String path, Long contentLength) {
            emit(this, CvdiagBoundary.BACKEND_REQUEST_INGRESS, CvdiagOutcome.INFO, null,
                    meta("method", method, "path", path,
                            "content_length", normalizeLength(contentLength)));
        }

        /** {@code backend.agent.enter} — agent loop entered. */
        public void agentEnter(String agentName, String modelId) {
            this.agentSpanId = CvdiagEmitter.mintSpanId();
            emit(this, CvdiagBoundary.BACKEND_AGENT_ENTER, CvdiagOutcome.INFO, null,
                    meta("agent_name", agentName, "model_id", modelId));
        }

        /** {@code backend.llm.call.start} — outbound LLM call dispatched. */
        public void llmCallStart(String provider, String model, int promptTokenEstimate) {
            llmStartMs.set(System.currentTimeMillis());
            emit(this, CvdiagBoundary.BACKEND_LLM_CALL_START, CvdiagOutcome.INFO, null,
                    meta("provider", provider, "model", model,
                            "prompt_token_count_estimate", promptTokenEstimate));
        }

        /**
         * {@code backend.llm.call.heartbeat} — fires while an LLM call is
         * outstanding (verbose+). {@code elapsed_ms_since_start} is measured
         * from the last {@link #llmCallStart}.
         */
        public void llmHeartbeat() {
            long start = llmStartMs.get();
            long elapsed = start > 0 ? System.currentTimeMillis() - start : 0L;
            emit(this, CvdiagBoundary.BACKEND_LLM_CALL_HEARTBEAT, CvdiagOutcome.INFO, null,
                    meta("elapsed_ms_since_start", elapsed));
        }

        /**
         * {@code backend.llm.call.response} — LLM response received.
         * {@code errorClass} is {@code null} on success.
         */
        public void llmCallResponse(String provider, String model,
                                    Long responseTokenCount, long latencyMs, String errorClass) {
            CvdiagOutcome outcome = errorClass == null ? CvdiagOutcome.OK : CvdiagOutcome.ERR;
            emit(this, CvdiagBoundary.BACKEND_LLM_CALL_RESPONSE, outcome, latencyMs,
                    meta("provider", provider, "model", model,
                            "response_token_count", responseTokenCount,
                            "latency_ms", latencyMs, "error_class", errorClass));
        }

        /** {@code backend.sse.first_byte} — first SSE byte written to the stream. */
        public void sseFirstByte() {
            emit(this, CvdiagBoundary.BACKEND_SSE_FIRST_BYTE, CvdiagOutcome.INFO, null,
                    meta("delta_ms_from_ingress", System.currentTimeMillis() - ingressMonoMs));
        }

        /**
         * {@code backend.sse.event} — every SSE event written (type + size, NOT
         * content; DEBUG tier only). {@code sequence_num} increments per run.
         */
        public void sseEvent(String eventType, int payloadSizeBytes) {
            sseEventCount.incrementAndGet();
            emit(this, CvdiagBoundary.BACKEND_SSE_EVENT, CvdiagOutcome.INFO, null,
                    meta("event_type", eventType,
                            "payload_size_bytes", payloadSizeBytes,
                            "sequence_num", sseSeq.getAndIncrement()));
        }

        /** {@code backend.sse.aborted} — stream terminated abnormally. */
        public void sseAborted(String terminationKind, long bytesBeforeAbort) {
            emit(this, CvdiagBoundary.BACKEND_SSE_ABORTED, CvdiagOutcome.ERR, null,
                    meta("termination_kind", terminationKind,
                            "bytes_before_abort", bytesBeforeAbort));
        }

        /** {@code backend.agent.exit} — agent loop exited with terminal status. */
        public void agentExit(CvdiagOutcome terminalOutcome) {
            emit(this, CvdiagBoundary.BACKEND_AGENT_EXIT, terminalOutcome,
                    System.currentTimeMillis() - ingressMonoMs,
                    meta("terminal_outcome", terminalOutcome.wire(),
                            "total_duration_ms", System.currentTimeMillis() - ingressMonoMs));
        }

        /** {@code backend.response.complete} — HTTP response stream closed. */
        public void responseComplete(int httpStatus, Long contentLength) {
            CvdiagOutcome outcome = httpStatus < 400 ? CvdiagOutcome.OK : CvdiagOutcome.ERR;
            emit(this, CvdiagBoundary.BACKEND_RESPONSE_COMPLETE, outcome,
                    System.currentTimeMillis() - ingressMonoMs,
                    meta("http_status", httpStatus,
                            "content_length", normalizeLength(contentLength),
                            "total_duration_ms", System.currentTimeMillis() - ingressMonoMs,
                            "sse_event_count", sseEventCount.get()));
        }

        /**
         * {@code backend.error.caught} — an exception caught inside the agent
         * loop. The message is PII-scrubbed via {@link MessageScrubber} and
         * capped at 512B; a brief stack ({@code ≤8} frames) is captured.
         */
        public void errorCaught(Throwable error) {
            if (error == null) {
                return;
            }
            String scrubbed = capAt(MessageScrubber.scrub(String.valueOf(error.getMessage())), 512);
            java.util.List<Map<String, Object>> stackBrief = new java.util.ArrayList<>();
            StackTraceElement[] frames = error.getStackTrace();
            boolean truncated = frames.length > STACK_BRIEF_MAX_FRAMES;
            int limit = Math.min(frames.length, STACK_BRIEF_MAX_FRAMES);
            for (int i = 0; i < limit; i++) {
                Map<String, Object> frame = new LinkedHashMap<>();
                frame.put("file", frames[i].getClassName());
                frame.put("line", frames[i].getLineNumber());
                stackBrief.add(frame);
            }
            emit(this, CvdiagBoundary.BACKEND_ERROR_CAUGHT, CvdiagOutcome.ERR, null,
                    meta("exception_type", error.getClass().getName(),
                            "message_scrubbed", scrubbed,
                            "stack_brief", stackBrief,
                            "truncated", truncated));
        }

        private Long normalizeLength(Long len) {
            return (len == null || len < 0) ? null : len;
        }

        private String capAt(String value, int max) {
            if (value == null) {
                return null;
            }
            return value.length() <= max ? value : value.substring(0, max);
        }
    }
}
