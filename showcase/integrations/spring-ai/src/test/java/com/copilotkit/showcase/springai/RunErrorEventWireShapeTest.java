package com.copilotkit.showcase.springai;

import com.agui.core.event.RunErrorEvent;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import static com.agui.server.EventFactory.runErrorEvent;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Wire-shape contract for the terminal {@code RUN_ERROR} event.
 *
 * <p>The AG-UI protocol's {@code RunErrorEventSchema} (see {@code @ag-ui/core})
 * requires the human-readable text in a <b>required {@code message} field</b>.
 * The AG-UI Java SDK's {@link com.agui.core.event.RunErrorEvent} stores it in
 * a field named {@code error}, which serializes as
 * {@code {"type":"RUN_ERROR","error":...}} — the CopilotKit frontend's zod
 * decode then fails with {@code invalid_type} at path {@code ["message"]} and
 * the chat surfaces a raw ZodError instead of the run-error banner (observed
 * on the mcp-apps and tool-rendering-custom-catchall demos whenever any agent
 * run errors).
 *
 * <p>{@link JacksonConfig} works around the SDK gap with a mixin registered
 * via a {@code Jackson2ObjectMapperBuilderCustomizer}. <b>That customizer is
 * only effective if Boot's builder-built {@link ObjectMapper} actually wins
 * bean resolution.</b> AG-UI's {@code AgUiAutoConfiguration} registers a bare
 * {@code new ObjectMapper()} bean that alphabetically wins the
 * {@code @ConditionalOnMissingBean} race against Boot's mapper (observed on
 * Boot 3.5.4 / 3.5.8); when that happens the customizer is silently inert and
 * the bug ships to production despite the mixin being present in source.
 *
 * <p>This is therefore a {@link SpringBootTest} that resolves the
 * {@link ObjectMapper} via {@code @Autowired} — exactly the way the SSE
 * controllers and {@code MappingJackson2HttpMessageConverter} get it at
 * runtime. A test that builds its own {@code Jackson2ObjectMapperBuilder}
 * cannot catch the bean-race regression — it always sees the customizer
 * apply because no competing bean is in scope.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.NONE,
        // Satisfy OpenAiApiKeyValidator's @PostConstruct check; no network is
        // performed (no web server, no chat calls).
        properties = "spring.ai.openai.api-key=test-key-not-used")
@TestPropertySource(properties = "OPENAI_API_KEY=test-key-not-used")
class RunErrorEventWireShapeTest {

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void runErrorEventSerializesProtocolRequiredMessageField() throws Exception {
        String json = objectMapper.writeValueAsString(
                runErrorEvent("agent run failed: boom (see server logs)"));
        JsonNode node = objectMapper.readTree(json);

        assertThat(node.path("type").asText())
                .as("type discriminator")
                .isEqualTo("RUN_ERROR");
        assertThat(node.hasNonNull("message"))
                .as("protocol-required `message` field present (RunErrorEventSchema)")
                .isTrue();
        assertThat(node.path("message").asText())
                .isEqualTo("agent run failed: boom (see server logs)");
        // Renamed, not duplicated — zod strips unknown keys, but a stray
        // `error` key invites future readers to depend on the wrong field.
        assertThat(node.has("error"))
                .as("SDK-internal `error` field must not leak onto the wire")
                .isFalse();
    }

    @Test
    void runErrorEventDeserializesProtocolMessageFieldBackToError() throws Exception {
        // JacksonConfig's mixin renames the field on BOTH the getter and the
        // setter (@JsonProperty("message") on both halves). A regression that
        // drops the setter half would leave serialization green but break
        // round-trip deserialization (e.g. anything that consumes a peer
        // backend's RUN_ERROR event off the wire). Guard that explicitly.
        String wire = "{\"type\":\"RUN_ERROR\",\"message\":\"agent run failed: boom\"}";
        RunErrorEvent decoded = objectMapper.readValue(wire, RunErrorEvent.class);
        assertThat(decoded.getError())
                .as("protocol `message` field deserialized into SDK `error` getter (mixin setter half)")
                .isEqualTo("agent run failed: boom");
    }

    @Test
    void tolerantDeserializationIsApplied() {
        // The companion contract of JacksonConfig — tolerant deserialization
        // must be in effect on the application's ObjectMapper, not just on a
        // local mapper a test builds. Catches the same bean-race regression
        // from the deserialization side.
        assertThat(objectMapper.isEnabled(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES))
                .as("FAIL_ON_UNKNOWN_PROPERTIES must be disabled on the application ObjectMapper "
                        + "(JacksonConfig customizer effective)")
                .isFalse();
        assertThat(objectMapper.isEnabled(DeserializationFeature.FAIL_ON_INVALID_SUBTYPE))
                .as("FAIL_ON_INVALID_SUBTYPE must be disabled on the application ObjectMapper "
                        + "(JacksonConfig customizer effective)")
                .isFalse();
    }
}
