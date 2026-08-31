package com.copilotkit.showcase.springai;

import com.agui.core.event.RunErrorEvent;
import com.agui.json.ObjectMapperFactory;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

/**
 * Jackson configuration for tolerant deserialization of AG-UI messages.
 *
 * <p>The CopilotKit runtime forwards the full conversation history to the
 * agent, including messages with roles that the AG-UI Java SDK does not
 * recognise (e.g. "activity", "reasoning"). The AG-UI {@code MessageMixin}
 * uses {@code @JsonTypeInfo(property = "role")} with a closed set of
 * {@code @JsonSubTypes}; an unrecognised role causes
 * {@code InvalidTypeIdException} during deserialization, crashing the
 * request before the agent code even runs.
 *
 * <p>We disable two features:
 * <ul>
 *   <li>{@code FAIL_ON_UNKNOWN_PROPERTIES} — tolerates extra JSON fields
 *       that don't map to a Java field.</li>
 *   <li>{@code FAIL_ON_INVALID_SUBTYPE} — when the {@code role} type-id
 *       doesn't match any registered {@code @JsonSubTypes} name, Jackson
 *       returns {@code null} for that list element instead of throwing.
 *       Downstream code must null-check message lists (see
 *       {@link MessageListFilter}).</li>
 * </ul>
 *
 * <p>We also explicitly register the AG-UI mixins on Spring's global
 * ObjectMapper via a {@code postConfigurer} callback. The AG-UI
 * {@code AgUiAutoConfiguration} registers them during bean wiring of
 * {@code AgUiService}, but that can race with
 * {@code MappingJackson2HttpMessageConverter} capturing the ObjectMapper
 * reference. By registering inside the builder customizer's
 * {@code postConfigurer}, the mixins are applied during ObjectMapper
 * construction — before any other bean sees it.
 *
 * <p>Array-format content normalization (for CopilotKit re-invocation
 * payloads) is handled separately by {@link ContentNormalizingModule},
 * a {@code @ControllerAdvice} that pre-processes the raw JSON body
 * before Jackson deserialization.
 */
@Configuration
public class JacksonConfig {

    /**
     * Explicit primary {@link ObjectMapper} bean built from Spring Boot's
     * {@link Jackson2ObjectMapperBuilder}, so our
     * {@link Jackson2ObjectMapperBuilderCustomizer} below is guaranteed to
     * apply.
     *
     * <p><b>Why this is required.</b> AG-UI's {@code AgUiAutoConfiguration}
     * registers a bare {@code new ObjectMapper()} bean that wins the
     * {@code @ConditionalOnMissingBean} race against Spring Boot's
     * auto-configured builder-built mapper (alphabetically; observed on
     * Spring Boot 3.5.4 / 3.5.8). When that happens, Boot's mapper backs
     * off — and the entire {@code tolerantObjectMapperCustomizer} below is
     * silently inert: the AG-UI mixins aren't applied, the
     * {@code RunErrorEvent} wire-shape rename never takes effect, and
     * {@code FAIL_ON_UNKNOWN_PROPERTIES} stays enabled. Production wire
     * traces still show {@code {"error":"…"}} instead of the protocol-
     * required {@code {"message":"…"}}.
     *
     * <p>Declaring this bean as {@code @Primary} forces our builder-built
     * mapper to be the one injected everywhere — both into Spring's
     * {@code MappingJackson2HttpMessageConverter} and into
     * {@code AgUiService}'s constructor (which then re-applies its mixins
     * on the same instance, composing correctly with our customizer).
     */
    @Bean
    @Primary
    public ObjectMapper objectMapper(Jackson2ObjectMapperBuilder builder) {
        return builder.build();
    }

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer tolerantObjectMapperCustomizer() {
        return builder -> {
            builder.featuresToDisable(
                    DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
                    DeserializationFeature.FAIL_ON_INVALID_SUBTYPE);

            // Register AG-UI mixins (MessageMixin, EventMixin, StateMixin)
            // during ObjectMapper construction so they are present before
            // any @RequestBody deserialization.
            builder.postConfigurer(ObjectMapperFactory::addMixins);

            // Protocol-correct RUN_ERROR wire shape. The AG-UI protocol's
            // RunErrorEventSchema (@ag-ui/core) requires the human-readable
            // text in a `message` field, but the AG-UI Java SDK's
            // RunErrorEvent stores it in a field named `error` — serialized
            // as {"type":"RUN_ERROR","error":...}, the frontend's zod decode
            // fails with invalid_type at path ["message"] and the chat
            // surfaces a raw ZodError instead of the run-error banner.
            // Rename the property on the wire until the SDK is fixed
            // upstream. Registered on the event subclass, so it composes
            // with (does not clobber) the BaseEvent-targeted EventMixin
            // added above and re-added by AgUiService's constructor.
            builder.mixIn(RunErrorEvent.class, RunErrorEventWireMixin.class);
        };
    }

    /**
     * Renames the SDK-internal {@code error} property to the
     * protocol-required {@code message} on both serialization and
     * deserialization (see the wire-shape note in
     * {@link #tolerantObjectMapperCustomizer()}).
     */
    private interface RunErrorEventWireMixin {
        @JsonProperty("message")
        String getError();

        @JsonProperty("message")
        void setError(String error);
    }
}
