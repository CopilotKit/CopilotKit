package com.copilotkit.showcase.springai;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

/**
 * Fail-fast validator for the Spring-AI OpenAI API key.
 *
 * <p>Spring's {@code PropertyPlaceholderHelper} (used for {@code ${VAR:default}}
 * expansion in {@code application.properties}) only recognises {@code ':'} as
 * the separator between the placeholder name and its default value. The
 * shell-style {@code ${VAR:?message}} fail-fast syntax is NOT supported — the
 * {@code ?} and everything after it becomes the literal default. That means a
 * previous configuration of
 * {@code spring.ai.openai.api-key=${OPENAI_API_KEY:?OPENAI_API_KEY must be set}}
 * silently produced the API key {@code "?OPENAI_API_KEY must be set"} when the
 * env var was unset — the OPPOSITE of fail-fast, and the resulting 401s from
 * OpenAI happened far downstream of the real misconfiguration.
 *
 * <p>Instead, we let the placeholder default to the empty string and assert
 * non-blank at startup here. Throwing {@link IllegalStateException} from a
 * {@code @PostConstruct} method aborts the Spring context refresh, so the JVM
 * exits non-zero before any HTTP traffic is served.
 */
@Configuration
public class OpenAiApiKeyValidator {

    private static final Logger log = LoggerFactory.getLogger(OpenAiApiKeyValidator.class);

    private final String apiKey;

    public OpenAiApiKeyValidator(@Value("${spring.ai.openai.api-key:}") String apiKey) {
        this.apiKey = apiKey;
    }

    @PostConstruct
    public void validate() {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException(
                    "spring.ai.openai.api-key is not set. Export OPENAI_API_KEY " +
                    "(or set spring.ai.openai.api-key directly) before starting the " +
                    "Spring-AI showcase agent. Refusing to start with an empty key " +
                    "because Spring-AI would produce opaque 401s downstream."
            );
        }
        log.info("[OpenAiApiKeyValidator] OpenAI API key configured (length={})", apiKey.length());
    }
}
