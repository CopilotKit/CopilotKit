package com.copilotkit.showcase.springai.cvdiag;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * CVDIAG flap-observability schema binding — Java 17 records CODEGEN'd from
 * the canonical {@code showcase/harness/src/cvdiag/schema.json} IR (which is
 * itself derived from {@code schema.ts}, the single source of truth across all
 * language emitters). Plan unit: L0-E (decision D4 — INLINED into spring-ai's
 * single-module Maven build, NOT a separate reactor artifact).
 *
 * <p><b>Codegen provenance.</b> Every literal here is mechanically transcribed
 * from {@code schema.json}: the 3 {@link CvdiagLayer} values from
 * {@code $defs.layers}, the 4 {@link CvdiagOutcome} values from
 * {@code $defs.outcomes}, the 33 {@link CvdiagBoundary} literals from
 * {@code properties.boundary.enum} (29 data-plane + 4 {@code cvdiag.*}
 * accounting), the 9 {@link EdgeHeaders} keys from {@code $defs.edge_header_keys},
 * and the per-boundary metadata key sets from {@code $defs.boundary_metadata_keys}.
 * If {@code schema.json} changes, this file MUST be regenerated or CI lint fails
 * on drift.
 *
 * <p>Wire shape is identical to the TS/Pydantic/.NET emitters: enums serialize
 * by their lowercase dotted wire literal (via {@link JsonValue}); the envelope
 * uses {@code snake_case} JSON field names; the closed {@link EdgeHeaders}
 * record always carries all 9 keys (absent → {@code null}).
 */
public final class CvdiagSchema {

    /** Current schema version (const 1 in v1). Mirrors {@code SCHEMA_VERSION}. */
    public static final int SCHEMA_VERSION = 1;

    private CvdiagSchema() {
        // schema holder — records + statics only
    }

    // ── Closed enums (codegen'd from schema.json $defs) ─────────────────────

    /** Layer that emitted the event ({@code $defs.layers}). */
    public enum CvdiagLayer {
        PROBE("probe"),
        BACKEND("backend"),
        AIMOCK("aimock");

        private final String wire;

        CvdiagLayer(String wire) {
            this.wire = wire;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        @JsonCreator
        public static CvdiagLayer fromWire(String value) {
            for (CvdiagLayer v : values()) {
                if (v.wire.equals(value)) {
                    return v;
                }
            }
            throw new IllegalArgumentException("Unknown CVDIAG layer: " + value);
        }
    }

    /** Terminal outcome of a boundary ({@code $defs.outcomes}). */
    public enum CvdiagOutcome {
        OK("ok"),
        ERR("err"),
        TIMEOUT("timeout"),
        INFO("info");

        private final String wire;

        CvdiagOutcome(String wire) {
            this.wire = wire;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        @JsonCreator
        public static CvdiagOutcome fromWire(String value) {
            for (CvdiagOutcome v : values()) {
                if (v.wire.equals(value)) {
                    return v;
                }
            }
            throw new IllegalArgumentException("Unknown CVDIAG outcome: " + value);
        }
    }

    /**
     * The closed {@code boundary} enum: 33 literals (29 data-plane + 4
     * {@code cvdiag.*} accounting), codegen'd from
     * {@code properties.boundary.enum}. Accounting boundaries (prefix
     * {@code cvdiag.}) carry no typed metadata and are always emitted.
     */
    public enum CvdiagBoundary {
        // 12 probe-layer data-plane boundaries
        PROBE_START("probe.start"),
        PROBE_NAVIGATE_COMPLETE("probe.navigate.complete"),
        PROBE_MESSAGE_SEND("probe.message.send"),
        PROBE_DOM_CONTAINER_MOUNT("probe.dom.container.mount"),
        PROBE_DOM_FIRSTTOKEN("probe.dom.firsttoken"),
        PROBE_DOM_ALTERNATE_CONTENT("probe.dom.alternate_content"),
        PROBE_SSE_EVENT("probe.sse.event"),
        PROBE_SSE_ABORTED("probe.sse.aborted"),
        PROBE_NETWORK_ERROR("probe.network.error"),
        PROBE_NETWORK_RESPONSE("probe.network.response"),
        PROBE_CONSOLE_ERROR("probe.console.error"),
        PROBE_EXIT("probe.exit"),
        // 11 backend-layer data-plane boundaries
        BACKEND_REQUEST_INGRESS("backend.request.ingress"),
        BACKEND_AGENT_ENTER("backend.agent.enter"),
        BACKEND_LLM_CALL_START("backend.llm.call.start"),
        BACKEND_LLM_CALL_HEARTBEAT("backend.llm.call.heartbeat"),
        BACKEND_LLM_CALL_RESPONSE("backend.llm.call.response"),
        BACKEND_SSE_FIRST_BYTE("backend.sse.first_byte"),
        BACKEND_SSE_EVENT("backend.sse.event"),
        BACKEND_SSE_ABORTED("backend.sse.aborted"),
        BACKEND_AGENT_EXIT("backend.agent.exit"),
        BACKEND_RESPONSE_COMPLETE("backend.response.complete"),
        BACKEND_ERROR_CAUGHT("backend.error.caught"),
        // 6 aimock-layer data-plane boundaries (closed-enum for the
        // fast-follow; no in-repo emitter writes layer=aimock yet)
        AIMOCK_REQUEST_INGRESS("aimock.request.ingress"),
        AIMOCK_MATCH_DECISION("aimock.match.decision"),
        AIMOCK_RESPONSE_START("aimock.response.start"),
        AIMOCK_SSE_CHUNK("aimock.sse.chunk"),
        AIMOCK_RESPONSE_ABORTED("aimock.response.aborted"),
        AIMOCK_RESPONSE_COMPLETE("aimock.response.complete"),
        // 4 cvdiag.* accounting boundaries (always emitted; no typed metadata)
        CVDIAG_PURGE_AUDIT("cvdiag.purge_audit"),
        CVDIAG_COLLISION_DETECTED("cvdiag.collision_detected"),
        CVDIAG_QUEUE_DROPPED("cvdiag.queue_dropped"),
        CVDIAG_METADATA_DROPPED("cvdiag.metadata_dropped");

        /** The {@code cvdiag.} accounting-namespace prefix. */
        public static final String ACCOUNTING_PREFIX = "cvdiag.";

        private final String wire;

        CvdiagBoundary(String wire) {
            this.wire = wire;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        /** True iff this is a {@code cvdiag.*} accounting boundary. */
        public boolean isAccounting() {
            return wire.startsWith(ACCOUNTING_PREFIX);
        }

        @JsonCreator
        public static CvdiagBoundary fromWire(String value) {
            for (CvdiagBoundary v : values()) {
                if (v.wire.equals(value)) {
                    return v;
                }
            }
            throw new IllegalArgumentException("Unknown CVDIAG boundary: " + value);
        }
    }

    // ── Edge headers (closed 9-key record, codegen'd from $defs) ────────────

    /** The 9 allow-listed edge-header keys, in canonical envelope order. */
    public static final List<String> EDGE_HEADER_KEYS = List.of(
            "cf-ray",
            "cf-mitigated",
            "cf-cache-status",
            "x-railway-edge",
            "x-railway-request-id",
            "x-hikari-trace",
            "retry-after",
            "via",
            "server");

    /**
     * The 12 forbidden edge-header names (spec §5 DENY list). Exact-match, NOT
     * a {@code cf-ip*} prefix wildcard — the {@code cf-ip*} family is blocked by
     * these explicit entries only. Stored lowercase; comparison is
     * case-insensitive. A deny-list key is rejected even if it appears in the
     * allow-list (deny wins).
     */
    public static final List<String> EDGE_HEADER_DENYLIST = List.of(
            "cf-ipcountry",
            "cf-connecting-ip",
            "cf-ipcity",
            "cf-iplatitude",
            "cf-iplongitude",
            "cf-iptimezone",
            "cf-visitor",
            "cf-worker",
            "true-client-ip",
            "x-forwarded-for",
            "x-real-ip",
            "forwarded");

    private static final Set<String> ALLOWLIST_SET = Set.copyOf(EDGE_HEADER_KEYS);
    private static final Set<String> DENYLIST_SET = Set.copyOf(EDGE_HEADER_DENYLIST);

    /**
     * Closed edge-header record (spec §5). All 9 keys are ALWAYS present on a
     * written row; an absent header is {@code null}. Serializes with the exact
     * dotted/hyphenated wire keys from {@code $defs.edge_header_keys}.
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record EdgeHeaders(
            @JsonProperty("cf-ray") String cfRay,
            @JsonProperty("cf-mitigated") String cfMitigated,
            @JsonProperty("cf-cache-status") String cfCacheStatus,
            @JsonProperty("x-railway-edge") String xRailwayEdge,
            @JsonProperty("x-railway-request-id") String xRailwayRequestId,
            @JsonProperty("x-hikari-trace") String xHikariTrace,
            @JsonProperty("retry-after") String retryAfter,
            @JsonProperty("via") String via,
            @JsonProperty("server") String server) {

        /** All-null edge headers (the default when none are captured). */
        public static EdgeHeaders empty() {
            return new EdgeHeaders(null, null, null, null, null, null, null, null, null);
        }
    }

    /**
     * Filter a raw header bag down to the closed {@link EdgeHeaders} shape.
     *
     * <ol>
     *   <li>Every one of the 9 allow-listed keys is present on the result; an
     *       absent header becomes {@code null}.</li>
     *   <li>A deny-list key is REJECTED even if it appears in the allow-list —
     *       the deny check runs first and wins (defense in depth).</li>
     *   <li>Any key not on the allow-list is silently dropped (closed-world).</li>
     * </ol>
     *
     * <p>Header-name lookup is case-insensitive (HTTP header names are
     * case-insensitive; both lists are lowercase).
     */
    public static EdgeHeaders filterEdgeHeaders(Map<String, String> raw) {
        Map<String, String> normalized = new LinkedHashMap<>();
        if (raw != null) {
            for (Map.Entry<String, String> entry : raw.entrySet()) {
                if (entry.getKey() == null) {
                    continue;
                }
                String key = entry.getKey().toLowerCase(Locale.ROOT);
                // Deny wins over allow: never capture a deny-list header.
                if (DENYLIST_SET.contains(key)) {
                    continue;
                }
                if (!ALLOWLIST_SET.contains(key)) {
                    continue;
                }
                normalized.put(key, entry.getValue());
            }
        }
        return new EdgeHeaders(
                normalized.get("cf-ray"),
                normalized.get("cf-mitigated"),
                normalized.get("cf-cache-status"),
                normalized.get("x-railway-edge"),
                normalized.get("x-railway-request-id"),
                normalized.get("x-hikari-trace"),
                normalized.get("retry-after"),
                normalized.get("via"),
                normalized.get("server"));
    }

    // ── Per-boundary metadata closed-world validation ───────────────────────

    /**
     * Declared metadata key sets per data-plane boundary (closed-world coverage,
     * spec §6), codegen'd from {@code $defs.boundary_metadata_keys}. The
     * emit-time validator drops any metadata key not in the declared set for the
     * boundary and stamps {@code _metadata_dropped}. Accounting
     * ({@code cvdiag.*}) boundaries have NO entry here.
     */
    public static final Map<CvdiagBoundary, List<String>> BOUNDARY_METADATA_KEYS;

    static {
        Map<CvdiagBoundary, List<String>> m = new LinkedHashMap<>();
        // probe
        m.put(CvdiagBoundary.PROBE_START, List.of("url", "viewport"));
        m.put(CvdiagBoundary.PROBE_NAVIGATE_COMPLETE, List.of("url", "nav_ms", "http_status"));
        m.put(CvdiagBoundary.PROBE_MESSAGE_SEND, List.of("message_index", "char_count", "demo"));
        m.put(CvdiagBoundary.PROBE_DOM_CONTAINER_MOUNT, List.of("delta_ms_from_start"));
        m.put(CvdiagBoundary.PROBE_DOM_FIRSTTOKEN, List.of("delta_ms_from_start", "text_length"));
        m.put(CvdiagBoundary.PROBE_DOM_ALTERNATE_CONTENT, List.of("child_type_histogram"));
        m.put(CvdiagBoundary.PROBE_SSE_EVENT, List.of("event_type", "payload_size_bytes", "sequence_num"));
        m.put(CvdiagBoundary.PROBE_SSE_ABORTED, List.of("termination_kind", "bytes_before_abort"));
        m.put(CvdiagBoundary.PROBE_NETWORK_ERROR, List.of("url", "error_class", "response_status"));
        m.put(CvdiagBoundary.PROBE_NETWORK_RESPONSE, List.of("url", "status", "content_length", "duration_ms"));
        m.put(CvdiagBoundary.PROBE_CONSOLE_ERROR, List.of("level", "message_scrubbed", "source_file", "line_col"));
        m.put(CvdiagBoundary.PROBE_EXIT,
                List.of("terminal_outcome", "total_duration_ms", "sse_event_count", "first_token_delta_ms"));
        // backend
        m.put(CvdiagBoundary.BACKEND_REQUEST_INGRESS, List.of("method", "path", "content_length"));
        m.put(CvdiagBoundary.BACKEND_AGENT_ENTER, List.of("agent_name", "model_id"));
        m.put(CvdiagBoundary.BACKEND_LLM_CALL_START, List.of("provider", "model", "prompt_token_count_estimate"));
        m.put(CvdiagBoundary.BACKEND_LLM_CALL_HEARTBEAT, List.of("elapsed_ms_since_start"));
        m.put(CvdiagBoundary.BACKEND_LLM_CALL_RESPONSE,
                List.of("provider", "model", "response_token_count", "latency_ms", "error_class"));
        m.put(CvdiagBoundary.BACKEND_SSE_FIRST_BYTE, List.of("delta_ms_from_ingress"));
        m.put(CvdiagBoundary.BACKEND_SSE_EVENT, List.of("event_type", "payload_size_bytes", "sequence_num"));
        m.put(CvdiagBoundary.BACKEND_SSE_ABORTED, List.of("termination_kind", "bytes_before_abort"));
        m.put(CvdiagBoundary.BACKEND_AGENT_EXIT, List.of("terminal_outcome", "total_duration_ms"));
        m.put(CvdiagBoundary.BACKEND_RESPONSE_COMPLETE,
                List.of("http_status", "content_length", "total_duration_ms", "sse_event_count"));
        m.put(CvdiagBoundary.BACKEND_ERROR_CAUGHT,
                List.of("exception_type", "message_scrubbed", "stack_brief", "truncated"));
        // aimock
        m.put(CvdiagBoundary.AIMOCK_REQUEST_INGRESS, List.of("path", "content_length", "match_keys"));
        m.put(CvdiagBoundary.AIMOCK_MATCH_DECISION, List.of("fixture_id", "match_score", "reject_reasons"));
        m.put(CvdiagBoundary.AIMOCK_RESPONSE_START, List.of("delta_ms_from_ingress"));
        m.put(CvdiagBoundary.AIMOCK_SSE_CHUNK, List.of("chunk_size_bytes", "sequence_num"));
        m.put(CvdiagBoundary.AIMOCK_RESPONSE_ABORTED, List.of("termination_kind", "bytes_before_abort"));
        m.put(CvdiagBoundary.AIMOCK_RESPONSE_COMPLETE,
                List.of("http_status", "total_bytes", "total_duration_ms", "chunk_count"));
        BOUNDARY_METADATA_KEYS = Map.copyOf(m);
    }

    /** Result of closed-world per-boundary metadata validation. */
    public record MetadataValidationResult(
            Map<String, Object> metadata,
            boolean metadataDropped,
            List<String> droppedKeys) {
    }

    /**
     * Closed-world per-boundary metadata validation (spec §6). Drops any
     * metadata key not declared for the boundary, returns the surviving
     * metadata, and reports whether any key was dropped. For an accounting
     * (non-data-plane) boundary or an unknown boundary, all metadata is dropped
     * (fail-closed) — accounting events ride their payload verbatim through the
     * emitter, not this validator.
     */
    public static MetadataValidationResult validateMetadata(
            CvdiagLayer layer, CvdiagBoundary boundary, Map<String, Object> metadata) {
        Map<String, Object> input = metadata == null ? Map.of() : metadata;
        List<String> allowed = BOUNDARY_METADATA_KEYS.get(boundary);
        if (allowed == null) {
            // Accounting or unknown boundary: drop everything, fail-closed.
            List<String> dropped = List.copyOf(input.keySet());
            return new MetadataValidationResult(new LinkedHashMap<>(), !dropped.isEmpty(), dropped);
        }
        Set<String> allowedSet = Set.copyOf(allowed);
        Map<String, Object> survivor = new LinkedHashMap<>();
        java.util.List<String> droppedKeys = new java.util.ArrayList<>();
        for (Map.Entry<String, Object> entry : input.entrySet()) {
            if (allowedSet.contains(entry.getKey())) {
                survivor.put(entry.getKey(), entry.getValue());
            } else {
                droppedKeys.add(entry.getKey());
            }
        }
        return new MetadataValidationResult(survivor, !droppedKeys.isEmpty(), List.copyOf(droppedKeys));
    }

    // ── Closed envelope (codegen'd from properties; snake_case wire) ────────

    /**
     * The closed CVDIAG envelope (spec §5). Field order and JSON names mirror
     * the canonical schema; {@code _metadata_dropped} / {@code _truncated} are
     * emitter-stamped flags, omitted from the wire when null.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CvdiagEnvelope(
            @JsonProperty("schema_version") int schemaVersion,
            @JsonProperty("test_id") String testId,
            @JsonProperty("trace_id") String traceId,
            @JsonProperty("span_id") String spanId,
            @JsonProperty("parent_span_id") String parentSpanId,
            @JsonProperty("layer") CvdiagLayer layer,
            @JsonProperty("boundary") CvdiagBoundary boundary,
            @JsonProperty("slug") String slug,
            @JsonProperty("demo") String demo,
            @JsonProperty("ts") String ts,
            @JsonProperty("mono_ns") long monoNs,
            @JsonProperty("duration_ms") Long durationMs,
            @JsonProperty("outcome") CvdiagOutcome outcome,
            @JsonProperty("edge_headers") EdgeHeaders edgeHeaders,
            @JsonProperty("metadata") Map<String, Object> metadata,
            @JsonProperty("_metadata_dropped") Boolean metadataDropped,
            @JsonProperty("_truncated") Boolean truncated) {
    }

    /** UUIDv7 (lowercase, hyphenated) validation regex (spec §5 {@code test_id}). */
    public static final java.util.regex.Pattern TEST_ID_PATTERN = java.util.regex.Pattern.compile(
            "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");

    /** True iff {@code value} is a well-formed lowercase UUIDv7. */
    public static boolean isValidTestId(String value) {
        return value != null && TEST_ID_PATTERN.matcher(value).matches();
    }

    /** The full closed boundary literal set, in canonical order. */
    public static List<String> boundaryWireLiterals() {
        return Arrays.stream(CvdiagBoundary.values()).map(CvdiagBoundary::wire).toList();
    }
}
