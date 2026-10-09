package com.copilotkit.showcase.springai.cvdiag;

import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagBoundary;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagEnvelope;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagLayer;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagOutcome;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.EdgeHeaders;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.MetadataValidationResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

/**
 * {@code CvdiagEmitter} — the inlined Java CVDIAG emitter for spring-ai (single
 * module, decision D4). Mirrors the canonical TS {@code CvdiagEmitter} (tier
 * resolution, §6 fail-closed DEBUG guard, per-event byte cap, span/id minting)
 * with the Java-specific environment precedence
 * {@code SHOWCASE_ENV → RAILWAY_ENVIRONMENT_NAME → SPRING_PROFILES_ACTIVE}.
 *
 * <p><b>Pure instrumentation.</b> A CVDIAG failure must NEVER throw into the
 * boundary it observes — {@link #emitEvent} catches everything and degrades to a
 * single warn log. The ONE place permitted to throw is the constructor's
 * fail-closed DEBUG guard ({@link #assertDebugAllowed}), which is a startup
 * assertion.
 *
 * <p>{@link #emitEvent} writes the closed {@link CvdiagEnvelope} as a single
 * line of Jackson JSON to stdout (joinable by {@code test_id}) and fires a
 * background, best-effort PocketBase write through an injectable seam
 * ({@code CompletableFuture.runAsync} fire-and-forget, ≤1s). The PB client is
 * wired by a downstream slot; here it is a {@link Consumer} seam so the emitter
 * compiles and is testable standalone (no PB client implemented in L0-E).
 */
public final class CvdiagEmitter {

    private static final Logger log = LoggerFactory.getLogger(CvdiagEmitter.class);

    /** Resolved verbosity tier (cumulative). */
    public enum Tier {
        DEFAULT,
        VERBOSE,
        DEBUG
    }

    /** Per-event byte caps by tier (spec §7). */
    private static final Map<Tier, Integer> BYTE_CAP_BY_TIER = Map.of(
            Tier.DEFAULT, 2 * 1024,
            Tier.VERBOSE, 4 * 1024,
            Tier.DEBUG, 16 * 1024);

    /** DEBUG hard bounds (spec §6). */
    static final long DEBUG_MAX_WALLCLOCK_MS = 10L * 60L * 1000L;
    static final int DEBUG_MAX_EVENTS = 10_000;

    private static final SecureRandom RANDOM = new SecureRandom();

    private final ObjectMapper mapper;
    private final Tier tier;
    private final Map<String, String> env;
    private final CvdiagLayer defaultLayer;
    private final Consumer<CvdiagEnvelope> pbWriter;

    // DEBUG auto-off bookkeeping (spec §6 hard bounds).
    private final long debugDeadlineMs;
    private int debugEventCount = 0;
    private boolean debugDisarmed = false;

    public CvdiagEmitter(Options options) {
        Options opts = options == null ? new Options() : options;
        this.mapper = opts.mapper != null ? opts.mapper : new ObjectMapper();
        this.env = opts.env != null ? opts.env : System.getenv();
        this.defaultLayer = opts.layer != null ? opts.layer : CvdiagLayer.BACKEND;
        this.pbWriter = opts.pbWriter;

        boolean wantsDebug = opts.debug || "1".equals(this.env.get("CVDIAG_DEBUG"));
        boolean wantsVerbose = opts.verbose || "1".equals(this.env.get("CVDIAG_VERBOSE"));

        if (wantsDebug) {
            assertDebugAllowed();
            this.tier = Tier.DEBUG;
            this.debugDeadlineMs = System.currentTimeMillis() + DEBUG_MAX_WALLCLOCK_MS;
        } else if (wantsVerbose) {
            this.tier = Tier.VERBOSE;
            this.debugDeadlineMs = 0L;
        } else {
            this.tier = Tier.DEFAULT;
            this.debugDeadlineMs = 0L;
        }
    }

    /** The resolved verbosity tier. */
    public Tier tier() {
        return tier;
    }

    /**
     * Resolve the deployment-environment label (spec §6 production detection),
     * Java-specific precedence:
     * {@code SHOWCASE_ENV → RAILWAY_ENVIRONMENT_NAME → SPRING_PROFILES_ACTIVE}.
     * Returns the lowercase label, or {@code null} if none resolves.
     */
    public static String resolveEnvLabel(Map<String, String> env) {
        if (env == null) {
            return null;
        }
        String raw = env.get("SHOWCASE_ENV");
        if (isBlank(raw)) {
            raw = env.get("RAILWAY_ENVIRONMENT_NAME");
        }
        if (isBlank(raw)) {
            raw = env.get("SPRING_PROFILES_ACTIVE");
        }
        if (isBlank(raw)) {
            return null;
        }
        return raw.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * DEBUG startup assertions (spec §6 hard bounds). Throws (fail-closed) when:
     * the resolved env label is {@code production}, OR no env label resolves at
     * all (treat unknown as production), OR no {@code CVDIAG_DEBUG_ALLOW_LIST}
     * slug list is provided. This is the ONE place the emitter is permitted to
     * throw — a startup guard, not a hot-path side effect.
     */
    private void assertDebugAllowed() {
        String label = resolveEnvLabel(this.env);
        if (label == null) {
            throw new IllegalStateException(
                    "CVDIAG_DEBUG refused: deployment environment is unresolved "
                            + "(SHOWCASE_ENV -> RAILWAY_ENVIRONMENT_NAME -> SPRING_PROFILES_ACTIVE all unset); "
                            + "fail-closed treats unknown env as production.");
        }
        if ("production".equals(label)) {
            throw new IllegalStateException(
                    "CVDIAG_DEBUG refused: deployment environment is production.");
        }
        String allowList = this.env.get("CVDIAG_DEBUG_ALLOW_LIST");
        if (allowList == null || allowList.trim().isEmpty()) {
            throw new IllegalStateException(
                    "CVDIAG_DEBUG refused: CVDIAG_DEBUG_ALLOW_LIST is required "
                            + "(comma-separated slug list) before DEBUG may start.");
        }
    }

    /**
     * Emit one event. Pure instrumentation: catches all errors and degrades to a
     * single {@code CVDIAG}-tagged warn, never throwing into the caller. Returns
     * the built envelope (or {@code null} when filtered out / on failure).
     */
    public CvdiagEnvelope emitEvent(EmitArgs args) {
        try {
            if (args == null || args.boundary == null || args.layer == null) {
                return null;
            }
            // DEBUG auto-off: once the wall-clock / event budget is exhausted,
            // the emitter quietly degrades (no further DEBUG accounting).
            if (this.tier == Tier.DEBUG) {
                if (isDebugExpired()) {
                    // Disarmed: keep emitting but stop counting toward the cap.
                    this.debugDisarmed = true;
                } else {
                    this.debugEventCount += 1;
                }
            }

            String testId = args.testId != null ? args.testId : mintTestId();
            boolean isDataPlane = !args.boundary.isAccounting();

            Map<String, Object> metadata;
            Boolean metadataDropped = null;
            if (isDataPlane) {
                MetadataValidationResult v = CvdiagSchema.validateMetadata(
                        args.layer, args.boundary, args.metadata);
                metadata = v.metadata();
                if (v.metadataDropped()) {
                    metadataDropped = Boolean.TRUE;
                }
            } else {
                // Accounting events ride their payload verbatim (trusted
                // internal records, no closed-world entry).
                metadata = args.metadata != null ? args.metadata : new LinkedHashMap<>();
            }

            CvdiagEnvelope envelope = new CvdiagEnvelope(
                    CvdiagSchema.SCHEMA_VERSION,
                    testId,
                    testId,
                    mintSpanId(),
                    args.parentSpanId,
                    args.layer,
                    args.boundary,
                    args.slug,
                    args.demo,
                    Instant.now().truncatedTo(ChronoUnit.MILLIS).toString(),
                    monoNs(),
                    args.durationMs,
                    args.outcome != null ? args.outcome : CvdiagOutcome.INFO,
                    args.edgeHeaders != null ? args.edgeHeaders : EdgeHeaders.empty(),
                    metadata,
                    metadataDropped,
                    null);

            String json = mapper.writeValueAsString(envelope);

            // Per-event byte cap (spec §7): on overflow, stamp _truncated and
            // re-serialize the metadata-trimmed envelope.
            int cap = BYTE_CAP_BY_TIER.get(this.tier);
            if (json.getBytes(StandardCharsets.UTF_8).length > cap) {
                envelope = applyByteCap(envelope);
                json = mapper.writeValueAsString(envelope);
            }

            // Single greppable JSON line to stdout, joinable by test_id.
            log.info("CVDIAG_EVENT {}", json);

            // Background, best-effort PB write (fire-and-forget, ≤1s window).
            // A failure here must never surface into the observed boundary.
            if (this.pbWriter != null) {
                final CvdiagEnvelope toWrite = envelope;
                CompletableFuture.runAsync(() -> {
                    try {
                        pbWriter.accept(toWrite);
                    } catch (RuntimeException ex) {
                        log.warn("CVDIAG pb write failed boundary={} error={}",
                                toWrite.boundary().wire(), ex.toString());
                    }
                });
            }

            return envelope;
        } catch (RuntimeException | com.fasterxml.jackson.core.JsonProcessingException err) {
            log.warn("CVDIAG emit failed boundary={} error={}",
                    args != null && args.boundary != null ? args.boundary.wire() : "?",
                    err.toString());
            return null;
        }
    }

    /** Whether DEBUG has exceeded its 10min / 10k-event bounds. */
    private boolean isDebugExpired() {
        if (this.debugDisarmed) {
            return true;
        }
        return System.currentTimeMillis() >= this.debugDeadlineMs
                || this.debugEventCount >= DEBUG_MAX_EVENTS;
    }

    /**
     * Trim over-budget metadata string values and stamp {@code _truncated}
     * (spec §7). The {@code metadata} bag holds the only unbounded-shape values,
     * so it is trimmed first; the rest of the envelope is fixed-shape.
     */
    private CvdiagEnvelope applyByteCap(CvdiagEnvelope envelope) {
        int cap = BYTE_CAP_BY_TIER.get(this.tier);
        Map<String, Object> trimmed = new LinkedHashMap<>(envelope.metadata());
        CvdiagEnvelope candidate = withMetadataAndTruncated(envelope, trimmed, Boolean.TRUE);
        for (String key : trimmed.keySet()) {
            if (serializedSize(candidate) <= cap) {
                break;
            }
            Object value = trimmed.get(key);
            if (value instanceof String s && s.length() > 64) {
                trimmed.put(key, s.substring(0, 61) + "...");
            } else if (value != null && !(value instanceof Number) && !(value instanceof Boolean)) {
                trimmed.put(key, "[truncated]");
            }
            candidate = withMetadataAndTruncated(envelope, trimmed, Boolean.TRUE);
        }
        return candidate;
    }

    private CvdiagEnvelope withMetadataAndTruncated(
            CvdiagEnvelope e, Map<String, Object> metadata, Boolean truncated) {
        return new CvdiagEnvelope(
                e.schemaVersion(), e.testId(), e.traceId(), e.spanId(), e.parentSpanId(),
                e.layer(), e.boundary(), e.slug(), e.demo(), e.ts(), e.monoNs(),
                e.durationMs(), e.outcome(), e.edgeHeaders(), metadata,
                e.metadataDropped(), truncated);
    }

    private int serializedSize(CvdiagEnvelope envelope) {
        try {
            return mapper.writeValueAsString(envelope).getBytes(StandardCharsets.UTF_8).length;
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            return Integer.MAX_VALUE;
        }
    }

    /** Emitter-local monotonic ns within this process (spec §5 {@code mono_ns}). */
    private long monoNs() {
        return System.nanoTime();
    }

    /**
     * Mint a UUIDv7 (time-ordered, lowercase hyphenated) per RFC 9562: 48-bit
     * Unix-ms timestamp, version nibble 7, variant bits 10.
     */
    public static String mintTestId() {
        return mintTestId(System.currentTimeMillis());
    }

    static String mintTestId(long nowMs) {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        bytes[0] = (byte) ((nowMs >>> 40) & 0xff);
        bytes[1] = (byte) ((nowMs >>> 32) & 0xff);
        bytes[2] = (byte) ((nowMs >>> 24) & 0xff);
        bytes[3] = (byte) ((nowMs >>> 16) & 0xff);
        bytes[4] = (byte) ((nowMs >>> 8) & 0xff);
        bytes[5] = (byte) (nowMs & 0xff);
        // Version 7 in the high nibble of byte 6.
        bytes[6] = (byte) ((bytes[6] & 0x0f) | 0x70);
        // Variant 10 in the high bits of byte 8.
        bytes[8] = (byte) ((bytes[8] & 0x3f) | 0x80);
        String hex = toHex(bytes);
        return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-"
                + hex.substring(12, 16) + "-" + hex.substring(16, 20) + "-"
                + hex.substring(20, 32);
    }

    /** Mint a 16-hex span id (8 random bytes). */
    public static String mintSpanId() {
        byte[] bytes = new byte[8];
        RANDOM.nextBytes(bytes);
        return toHex(bytes);
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(Character.forDigit((b >> 4) & 0xf, 16));
            sb.append(Character.forDigit(b & 0xf, 16));
        }
        return sb.toString();
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    // ── Builders ────────────────────────────────────────────────────────────

    /** Construction options for {@link CvdiagEmitter}. */
    public static final class Options {
        private boolean debug = false;
        private boolean verbose = false;
        private Map<String, String> env;
        private ObjectMapper mapper;
        private CvdiagLayer layer;
        private Consumer<CvdiagEnvelope> pbWriter;

        public Options debug(boolean value) {
            this.debug = value;
            return this;
        }

        public Options verbose(boolean value) {
            this.verbose = value;
            return this;
        }

        public Options env(Map<String, String> value) {
            this.env = value;
            return this;
        }

        public Options mapper(ObjectMapper value) {
            this.mapper = value;
            return this;
        }

        public Options layer(CvdiagLayer value) {
            this.layer = value;
            return this;
        }

        public Options pbWriter(Consumer<CvdiagEnvelope> value) {
            this.pbWriter = value;
            return this;
        }
    }

    /** Arguments for a single {@link #emitEvent} call. */
    public static final class EmitArgs {
        private CvdiagLayer layer;
        private CvdiagBoundary boundary;
        private String slug;
        private String demo;
        private CvdiagOutcome outcome;
        private EdgeHeaders edgeHeaders;
        private Map<String, Object> metadata;
        private Long durationMs;
        private String parentSpanId;
        private String testId;

        public EmitArgs layer(CvdiagLayer value) {
            this.layer = value;
            return this;
        }

        public EmitArgs boundary(CvdiagBoundary value) {
            this.boundary = value;
            return this;
        }

        public EmitArgs slug(String value) {
            this.slug = value;
            return this;
        }

        public EmitArgs demo(String value) {
            this.demo = value;
            return this;
        }

        public EmitArgs outcome(CvdiagOutcome value) {
            this.outcome = value;
            return this;
        }

        public EmitArgs edgeHeaders(EdgeHeaders value) {
            this.edgeHeaders = value;
            return this;
        }

        public EmitArgs metadata(Map<String, Object> value) {
            this.metadata = value;
            return this;
        }

        public EmitArgs durationMs(Long value) {
            this.durationMs = value;
            return this;
        }

        public EmitArgs parentSpanId(String value) {
            this.parentSpanId = value;
            return this;
        }

        public EmitArgs testId(String value) {
            this.testId = value;
            return this;
        }
    }
}
