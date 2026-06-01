package com.copilotkit.showcase.springai;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Context-wiring tests for {@link OpenAiApiKeyValidator}.
 *
 * <p>Uses {@link ApplicationContextRunner} rather than a full {@code @SpringBootTest}
 * so we can flip the {@code spring.ai.openai.api-key} property per-test without
 * paying full auto-configuration cost. We only register the validator itself —
 * the invariant under test is "validator refuses to load when the key is blank".
 */
class OpenAiApiKeyValidatorTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(OpenAiApiKeyValidator.class);

    @Test
    void contextFailsToStartWhenApiKeyMissing() {
        contextRunner
                .withPropertyValues("spring.ai.openai.api-key=")
                .run(context -> {
                    assertThat(context).hasFailed();
                    Throwable failure = context.getStartupFailure();
                    assertThat(failure).isNotNull();
                    // Walk the cause chain — Spring wraps @PostConstruct failures.
                    Throwable cursor = failure;
                    boolean foundIllegalState = false;
                    while (cursor != null) {
                        if (cursor instanceof IllegalStateException
                                && cursor.getMessage() != null
                                && cursor.getMessage().contains("spring.ai.openai.api-key is not set")) {
                            foundIllegalState = true;
                            break;
                        }
                        cursor = cursor.getCause();
                    }
                    assertThat(foundIllegalState)
                            .as("context should fail with IllegalStateException about missing api-key; got: %s", failure)
                            .isTrue();
                });
    }

    @Test
    void contextFailsToStartWhenApiKeyBlank() {
        contextRunner
                .withPropertyValues("spring.ai.openai.api-key=   ")
                .run(context -> {
                    assertThat(context).hasFailed();
                });
    }

    @Test
    void contextStartsWhenApiKeyProvided() {
        contextRunner
                .withPropertyValues("spring.ai.openai.api-key=sk-test-not-a-real-key")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(OpenAiApiKeyValidator.class);
                });
    }
}
