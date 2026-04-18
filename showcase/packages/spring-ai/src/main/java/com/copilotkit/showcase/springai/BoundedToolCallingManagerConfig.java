package com.copilotkit.showcase.springai;

import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.DefaultToolExecutionResult;
import org.springframework.ai.model.tool.ToolCallingChatOptions;
import org.springframework.ai.model.tool.ToolCallingManager;
import org.springframework.ai.model.tool.ToolExecutionResult;
import org.springframework.ai.tool.definition.ToolDefinition;
import org.springframework.ai.tool.execution.DefaultToolExecutionExceptionProcessor;
import org.springframework.ai.tool.resolution.StaticToolCallbackResolver;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.micrometer.observation.ObservationRegistry;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.WeakHashMap;

/**
 * Caps Spring-AI's internal tool-execution loop by wrapping the default
 * {@link ToolCallingManager} and flipping {@code returnDirect=true} on the
 * result once {@link #MAX_TOOL_ITERATIONS} iterations have executed on the
 * current conversation turn.
 *
 * <p>Spring-AI's default loop re-invokes the model whenever a response carries
 * {@code finish_reason=tool_calls}, with no iteration limit. Under
 * deterministic fixtures (aimock/Prism) — and under some real prompts where
 * the model fixates on a tool — this produces an unbounded loop that burns
 * tokens and hangs the UI "thinking" indicator forever.
 *
 * <p>Capping via the {@code ToolExecutionEligibilityPredicate} hook
 * (considered first) doesn't work cleanly: when the predicate returns
 * {@code false}, Spring-AI emits the *current* ChatResponse to the stream
 * as-is — and that response still carries the (unexecuted) tool_calls. ag-ui
 * then forwards orphan {@code TOOL_CALL_*} events to the frontend with no
 * matching {@code TOOL_CALL_RESULT}, leaving {@code useRenderTool} stuck in
 * the "loading" status and the assistant message never completing.
 *
 * <p>The {@code returnDirect} approach is cleaner: we still execute the tool
 * call on the capped iteration (so the frontend receives a complete
 * call→result pair and {@code useRenderTool} can render the finished UI),
 * but {@code returnDirect=true} tells {@code OpenAiChatModel} to emit the
 * tool-result-bearing {@code ChatResponse} as the final stream element and
 * stop looping.
 */
@Configuration
public class BoundedToolCallingManagerConfig {

    private static final Logger log = LoggerFactory.getLogger(BoundedToolCallingManagerConfig.class);

    /**
     * Max number of tool-execution iterations per conversation turn. One is
     * plenty for the CopilotKit showcase demos (weather, single chart,
     * meeting scheduling) and ensures a deterministic aimock fixture can't
     * pull the agent into an infinite tool-call loop.
     */
    static final int MAX_TOOL_ITERATIONS = 1;

    @Bean
    public ToolCallingManager boundedToolCallingManager(
            ObjectProvider<ObservationRegistry> observationRegistryProvider,
            List<ToolCallback> toolCallbacks) {

        log.info("[BoundedTCM] Installing bounded ToolCallingManager (MAX_TOOL_ITERATIONS={}) with {} tool callbacks",
                MAX_TOOL_ITERATIONS, toolCallbacks.size());
        ObservationRegistry observationRegistry =
                observationRegistryProvider.getIfUnique(() -> ObservationRegistry.NOOP);

        ToolCallingManager delegate = ToolCallingManager.builder()
                .observationRegistry(observationRegistry)
                .toolCallbackResolver(new StaticToolCallbackResolver(toolCallbacks))
                .toolExecutionExceptionProcessor(
                        DefaultToolExecutionExceptionProcessor.builder().build())
                .build();

        // Scope the iteration counter to the ChatOptions instance: Spring-AI
        // reuses the same options object across tool-execution iterations
        // within a single streaming call, so this gives us per-conversation-turn
        // state without a thread-local (reactor hops threads between
        // iterations). Weak keys ensure the counter is GC'd once the
        // conversation completes.
        Map<ChatOptions, Integer> iterations =
                Collections.synchronizedMap(new WeakHashMap<>());

        return new ToolCallingManager() {
            @Override
            public List<ToolDefinition> resolveToolDefinitions(ToolCallingChatOptions chatOptions) {
                return delegate.resolveToolDefinitions(chatOptions);
            }

            @Override
            public ToolExecutionResult executeToolCalls(Prompt prompt, ChatResponse chatResponse) {
                ToolExecutionResult delegated = delegate.executeToolCalls(prompt, chatResponse);
                ChatOptions options = prompt.getOptions();
                int next = iterations.getOrDefault(options, 0) + 1;
                iterations.put(options, next);
                if (next >= MAX_TOOL_ITERATIONS && !delegated.returnDirect()) {
                    log.warn(
                            "Tool-execution loop cap hit (iteration {} >= {}); flipping returnDirect=true to terminate the loop after this tool call.",
                            next, MAX_TOOL_ITERATIONS);
                    iterations.remove(options);
                    return DefaultToolExecutionResult.builder()
                            .conversationHistory(delegated.conversationHistory())
                            .returnDirect(true)
                            .build();
                }
                return delegated;
            }
        };
    }
}
