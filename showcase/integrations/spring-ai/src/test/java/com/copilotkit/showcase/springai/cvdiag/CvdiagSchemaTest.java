package com.copilotkit.showcase.springai.cvdiag;

import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagBoundary;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagEnvelope;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagLayer;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.CvdiagOutcome;
import com.copilotkit.showcase.springai.cvdiag.CvdiagSchema.EdgeHeaders;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * L0-E foundation tests for the inlined Java CVDIAG binding + emitter
 * (single-module spring-ai, no Maven reactor — decision D4).
 *
 * <p>These mirror the canonical TS gate tests in
 * {@code showcase/harness/src/cvdiag/schema.test.ts} so the Java binding
 * codegen'd from {@code showcase/harness/src/cvdiag/schema.json} pins the same
 * contract:
 * <ol>
 *   <li>schema round-trip (envelope serializes through Jackson and decodes
 *       back with all closed fields intact),</li>
 *   <li>a DENY-list edge header is rejected even if it collides with an
 *       allow-list key (exact-match deny wins),</li>
 *   <li>an unknown per-boundary metadata key is dropped and the survivor is
 *       stamped {@code _metadata_dropped: true},</li>
 *   <li>the DEBUG tier refuses to start when the resolved environment is
 *       production (fail-closed).</li>
 * </ol>
 */
class CvdiagSchemaTest {

    private final ObjectMapper mapper = new ObjectMapper();

    // (1) schema round-trip — a fully-populated envelope serializes and
    // deserializes losslessly through Jackson, with all 9 edge-header keys
    // present and the closed enums round-tripping by their wire literal.
    @Test
    void envelopeRoundTripsThroughJackson() throws Exception {
        EdgeHeaders edge = new EdgeHeaders(
                "cf-ray-1", null, "HIT", null, "req-9", null, null, "1.1 cloudflare", "railway");
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("delta_ms_from_start", 12);
        metadata.put("text_length", 4);

        CvdiagEnvelope envelope = new CvdiagEnvelope(
                CvdiagSchema.SCHEMA_VERSION,
                "017f22e2-79b0-7cc3-98c4-dc0c0c07398f",
                "017f22e2-79b0-7cc3-98c4-dc0c0c07398f",
                "0123456789abcdef",
                null,
                CvdiagLayer.PROBE,
                CvdiagBoundary.PROBE_DOM_FIRSTTOKEN,
                "langgraph-python",
                "agentic_chat",
                "2026-06-18T00:00:00.000Z",
                1L,
                null,
                CvdiagOutcome.OK,
                edge,
                metadata,
                null,
                null);

        String json = mapper.writeValueAsString(envelope);
        JsonNode node = mapper.readTree(json);

        // Closed enums serialize by their wire literal, not the Java name.
        assertThat(node.path("layer").asText()).isEqualTo("probe");
        assertThat(node.path("boundary").asText()).isEqualTo("probe.dom.firsttoken");
        assertThat(node.path("outcome").asText()).isEqualTo("ok");
        assertThat(node.path("schema_version").asInt()).isEqualTo(1);
        // All 9 edge-header keys are present (absent ones serialize as null).
        JsonNode edgeNode = node.path("edge_headers");
        assertThat(edgeNode.has("cf-ray")).isTrue();
        assertThat(edgeNode.path("cf-ray").asText()).isEqualTo("cf-ray-1");
        assertThat(edgeNode.has("cf-mitigated")).isTrue();
        assertThat(edgeNode.path("cf-mitigated").isNull()).isTrue();
        assertThat(edgeNode.path("via").asText()).isEqualTo("1.1 cloudflare");
        assertThat(edgeNode.path("server").asText()).isEqualTo("railway");
        // Round-trips back into a record with the enums intact.
        CvdiagEnvelope decoded = mapper.readValue(json, CvdiagEnvelope.class);
        assertThat(decoded.layer()).isEqualTo(CvdiagLayer.PROBE);
        assertThat(decoded.boundary()).isEqualTo(CvdiagBoundary.PROBE_DOM_FIRSTTOKEN);
        assertThat(decoded.outcome()).isEqualTo(CvdiagOutcome.OK);
        assertThat(decoded.testId()).isEqualTo("017f22e2-79b0-7cc3-98c4-dc0c0c07398f");
    }

    // The boundary enum mirrors the canonical 33 literals (29 data-plane + 4
    // accounting) from schema.json; a drift here means the codegen is stale.
    @Test
    void boundaryEnumHasThirtyThreeLiterals() {
        assertThat(CvdiagBoundary.values()).hasSize(33);
        assertThat(CvdiagBoundary.fromWire("cvdiag.metadata_dropped"))
                .isEqualTo(CvdiagBoundary.CVDIAG_METADATA_DROPPED);
        assertThat(CvdiagBoundary.fromWire("backend.llm.call.response"))
                .isEqualTo(CvdiagBoundary.BACKEND_LLM_CALL_RESPONSE);
    }

    // (2) forbidden-header rejection — a deny-list header is rejected even when
    // it collides with an allow-list key (exact-match deny wins, §5 PII).
    @Test
    void filterEdgeHeadersRejectsDenyListEvenIfCollidingWithAllowList() {
        Map<String, String> raw = new HashMap<>();
        raw.put("cf-ray", "abc-123");
        raw.put("cf-connecting-ip", "203.0.113.7"); // DENY (PII)
        raw.put("cf-ipcountry", "US"); // DENY (PII)
        raw.put("x-forwarded-for", "203.0.113.7"); // DENY (PII)
        raw.put("Via", "1.1 cloudflare"); // case-insensitive allow-list match

        EdgeHeaders filtered = CvdiagSchema.filterEdgeHeaders(raw);

        assertThat(filtered.cfRay()).isEqualTo("abc-123");
        assertThat(filtered.via()).isEqualTo("1.1 cloudflare");
        // Absent allow-list keys are present-and-null.
        assertThat(filtered.retryAfter()).isNull();
        assertThat(filtered.server()).isNull();
        // No PII value leaks onto any captured field.
        String serialized = filtered.toString();
        assertThat(serialized).doesNotContain("203.0.113.7");
        assertThat(serialized).doesNotContain("US");
    }

    // (3) unknown metadata key dropped + _metadata_dropped stamp.
    @Test
    void validateMetadataDropsUnknownKeyAndStampsDropped() {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("delta_ms_from_start", 10);
        meta.put("text_length", 4);
        meta.put("bogus_field", "drop-me");

        CvdiagSchema.MetadataValidationResult result =
                CvdiagSchema.validateMetadata(
                        CvdiagLayer.PROBE, CvdiagBoundary.PROBE_DOM_FIRSTTOKEN, meta);

        assertThat(result.metadata()).containsEntry("delta_ms_from_start", 10);
        assertThat(result.metadata()).doesNotContainKey("bogus_field");
        assertThat(result.metadataDropped()).isTrue();
        assertThat(result.droppedKeys()).containsExactly("bogus_field");
    }

    // The emit path stamps _metadata_dropped onto the envelope it builds when
    // the metadata validator dropped a key (end-to-end of the closed-world
    // contract, not just the validator in isolation).
    @Test
    void emitterStampsMetadataDroppedOnEnvelope() {
        Map<String, String> env = new HashMap<>();
        env.put("SHOWCASE_ENV", "staging");
        CvdiagEmitter emitter = new CvdiagEmitter(new CvdiagEmitter.Options().env(env));

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("delta_ms_from_start", 10);
        meta.put("text_length", 4);
        meta.put("bogus_field", "drop-me");

        CvdiagEnvelope envelope = emitter.emitEvent(new CvdiagEmitter.EmitArgs()
                .layer(CvdiagLayer.PROBE)
                .boundary(CvdiagBoundary.PROBE_DOM_FIRSTTOKEN)
                .slug("langgraph-python")
                .demo("agentic_chat")
                .outcome(CvdiagOutcome.OK)
                .metadata(meta));

        assertThat(envelope).isNotNull();
        assertThat(envelope.metadataDropped()).isTrue();
        assertThat(envelope.metadata()).doesNotContainKey("bogus_field");
    }

    // (4) production-env DEBUG refusal — the emitter constructor fails closed
    // when the resolved environment label is production.
    @Test
    void debugRefusesWhenEnvironmentIsProduction() {
        Map<String, String> env = new HashMap<>();
        env.put("SHOWCASE_ENV", "production");
        assertThatThrownBy(() ->
                new CvdiagEmitter(new CvdiagEmitter.Options().debug(true).env(env)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("production");
    }

    // Fail-closed: DEBUG also refuses when NO environment label resolves at all
    // (unknown env is treated as production). Mirrors the TS gate test.
    @Test
    void debugRefusesWhenNoEnvironmentResolves() {
        assertThatThrownBy(() ->
                new CvdiagEmitter(new CvdiagEmitter.Options().debug(true).env(new HashMap<>())))
                .isInstanceOf(IllegalStateException.class);
    }

    // DEBUG is permitted on a non-production label with an allow-list present.
    @Test
    void debugAllowedOnNonProductionWithAllowList() {
        Map<String, String> env = new HashMap<>();
        env.put("SHOWCASE_ENV", "staging");
        env.put("CVDIAG_DEBUG_ALLOW_LIST", "langgraph-python");
        CvdiagEmitter emitter = new CvdiagEmitter(
                new CvdiagEmitter.Options().debug(true).env(env));
        assertThat(emitter.tier()).isEqualTo(CvdiagEmitter.Tier.DEBUG);
    }

    // Tier resolution honors the Java-specific env precedence
    // SHOWCASE_ENV -> RAILWAY_ENVIRONMENT_NAME -> SPRING_PROFILES_ACTIVE.
    @Test
    void resolveEnvLabelFollowsSpringPrecedence() {
        Map<String, String> railway = new HashMap<>();
        railway.put("RAILWAY_ENVIRONMENT_NAME", "Staging");
        assertThat(CvdiagEmitter.resolveEnvLabel(railway)).isEqualTo("staging");

        Map<String, String> springProfile = new HashMap<>();
        springProfile.put("SPRING_PROFILES_ACTIVE", "PROD");
        assertThat(CvdiagEmitter.resolveEnvLabel(springProfile)).isEqualTo("prod");

        // SHOWCASE_ENV wins over the others when all are present.
        Map<String, String> all = new HashMap<>();
        all.put("SHOWCASE_ENV", "Dev");
        all.put("RAILWAY_ENVIRONMENT_NAME", "staging");
        all.put("SPRING_PROFILES_ACTIVE", "prod");
        assertThat(CvdiagEmitter.resolveEnvLabel(all)).isEqualTo("dev");

        assertThat(CvdiagEmitter.resolveEnvLabel(new HashMap<>())).isNull();
    }
}
