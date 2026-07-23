package com.copilotkit.showcase.springai;

import com.copilotkit.showcase.springai.BoundedToolCallingManagerConfig.BoundedToolCallingManager;
import org.junit.jupiter.api.Test;
import org.springframework.ai.model.tool.ToolCallingManager;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.lang.reflect.Field;
import java.util.Collections;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Spring context wiring tests for {@link BoundedToolCallingManagerConfig}.
 *
 * <p>Verifies that the {@code @Bean} method produces a
 * {@link BoundedToolCallingManager} with the right cap:
 * <ul>
 *   <li>default ({@value BoundedToolCallingManagerConfig#DEFAULT_TOOL_ITERATION_CAP_INCLUSIVE})
 *       when no property is set;</li>
 *   <li>operator override when {@code copilotkit.tool.max-iterations} is
 *       provided.</li>
 * </ul>
 *
 * <p>Uses {@link ApplicationContextRunner} to avoid booting the full app; we
 * only need the bean-wiring pathway, not the HTTP server or Spring-AI
 * autoconfig. We also supply an empty {@code List<ToolCallback>} parent-bean
 * (since production autowiring collects callbacks from the main config), and
 * don't set {@code spring.ai.openai.api-key} because {@link OpenAiApiKeyValidator}
 * isn't part of this context runner.
 */
class BoundedToolCallingManagerWiringTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(BoundedToolCallingManagerConfig.class)
            // Supply an empty tool-callback list so the @Bean method's List<ToolCallback>
            // dependency can resolve.
            .withBean("toolCallbacks", java.util.List.class, Collections::emptyList);

    @Test
    void defaultCapIsFiveWhenPropertyUnset() throws Exception {
        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            ToolCallingManager bean = context.getBean(ToolCallingManager.class);
            assertThat(bean).isInstanceOf(BoundedToolCallingManager.class);
            int cap = readCap((BoundedToolCallingManager) bean);
            assertThat(cap).isEqualTo(BoundedToolCallingManagerConfig.DEFAULT_TOOL_ITERATION_CAP_INCLUSIVE);
            assertThat(cap).isEqualTo(5);
        });
    }

    @Test
    void capHonoursOperatorOverride() throws Exception {
        contextRunner
                .withPropertyValues("copilotkit.tool.max-iterations=3")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    ToolCallingManager bean = context.getBean(ToolCallingManager.class);
                    assertThat(bean).isInstanceOf(BoundedToolCallingManager.class);
                    int cap = readCap((BoundedToolCallingManager) bean);
                    assertThat(cap).isEqualTo(3);
                });
    }

    @Test
    void invalidCapFailsContextStartup() {
        contextRunner
                .withPropertyValues("copilotkit.tool.max-iterations=0")
                .run(context -> {
                    assertThat(context).hasFailed();
                    Throwable cursor = context.getStartupFailure();
                    boolean foundIllegalArg = false;
                    while (cursor != null) {
                        if (cursor instanceof IllegalArgumentException
                                && cursor.getMessage() != null
                                && cursor.getMessage().contains("max-iterations must be >= 1")) {
                            foundIllegalArg = true;
                            break;
                        }
                        cursor = cursor.getCause();
                    }
                    assertThat(foundIllegalArg)
                            .as("context should fail with IllegalArgumentException about max-iterations")
                            .isTrue();
                });
    }

    /** Reflectively read the private cap to avoid widening test surface. */
    private static int readCap(BoundedToolCallingManager mgr) throws Exception {
        Field f = BoundedToolCallingManager.class.getDeclaredField("maxIterationsBeforeReturnDirect");
        f.setAccessible(true);
        return (int) f.get(mgr);
    }
}
