package com.copilotkit.showcase.springai;

import com.agui.json.ObjectMapperFactory;
import com.fasterxml.jackson.databind.DeserializationFeature;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

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
        };
    }
}
