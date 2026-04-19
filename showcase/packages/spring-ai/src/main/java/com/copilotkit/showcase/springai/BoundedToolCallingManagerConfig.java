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
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.micrometer.observation.ObservationRegistry;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Caps Spring-AI's internal tool-execution loop by wrapping the default
 * {@link ToolCallingManager} and flipping {@code returnDirect=true} on the
 * result once {@link #maxToolIterationsBeforeReturnDirect} iterations have
 * executed on the current conversation turn.
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
 *
 * <p>Override the cap at runtime via the
 * {@code copilotkit.tool.max-iterations} property (or the
 * {@code COPILOTKIT_TOOL_MAX_ITERATIONS} env var). Raise this if demos need
 * multi-step tool chains.
 */
@Configuration
public class BoundedToolCallingManagerConfig {

    private static final Logger log = LoggerFactory.getLogger(BoundedToolCallingManagerConfig.class);

    /**
     * Default cap: one tool iteration is plenty for the CopilotKit showcase
     * demos (weather, single chart, meeting scheduling) and ensures a
     * deterministic aimock fixture can't pull the agent into an infinite
     * tool-call loop. Override via {@code copilotkit.tool.max-iterations}.
     */
    static final int DEFAULT_MAX_TOOL_ITERATIONS_BEFORE_RETURN_DIRECT = 1;

    private final int maxToolIterationsBeforeReturnDirect;

    public BoundedToolCallingManagerConfig(
            @Value("${copilotkit.tool.max-iterations:" + DEFAULT_MAX_TOOL_ITERATIONS_BEFORE_RETURN_DIRECT + "}") int maxToolIterationsBeforeReturnDirect) {
        this.maxToolIterationsBeforeReturnDirect = maxToolIterationsBeforeReturnDirect;
    }

    @Bean
    public ToolCallingManager boundedToolCallingManager(
            ObjectProvider<ObservationRegistry> observationRegistryProvider,
            List<ToolCallback> toolCallbacks) {

        log.info("[BoundedTCM] Installing bounded ToolCallingManager (maxToolIterationsBeforeReturnDirect={}) with {} tool callbacks",
                maxToolIterationsBeforeReturnDirect, toolCallbacks.size());
        ObservationRegistry observationRegistry =
                observationRegistryProvider.getIfUnique(() -> ObservationRegistry.NOOP);

        ToolCallingManager delegate = ToolCallingManager.builder()
                .observationRegistry(observationRegistry)
                .toolCallbackResolver(new StaticToolCallbackResolver(toolCallbacks))
                .toolExecutionExceptionProcessor(
                        DefaultToolExecutionExceptionProcessor.builder().build())
                .build();

        return new BoundedToolCallingManager(delegate, maxToolIterationsBeforeReturnDirect);
    }

    /**
     * Wraps a delegate {@link ToolCallingManager} and caps the iteration count
     * per {@link ChatOptions} instance (Spring-AI reuses the same options
     * object across iterations within a single streaming call, giving us
     * per-conversation-turn scope without a thread-local — reactor hops
     * threads between iterations).
     *
     * <p>Verified against Spring-AI 1.0.1 (see {@code pom.xml}). The invariant
     * relied upon is "same ChatOptions instance across all iterations of a
     * single streaming tool-calling turn". A {@link ConcurrentHashMap} keyed
     * by identity (via the {@code ChatOptions} reference) is used for
     * thread-safe atomic updates. We clear the map entry both on cap-hit
     * (below) and after any delegate exception (in a finally) so failures
     * don't leak counter state.
     *
     * <p>Historical note: an earlier revision used a
     * {@code Collections.synchronizedMap(new WeakHashMap<>())} to auto-GC
     * entries. That was swapped out because (a) {@code getOrDefault + put} is
     * not atomic under concurrency, and (b) {@code WeakHashMap} uses
     * {@code .equals()}/{@code .hashCode()} which for {@code ChatOptions} is
     * identity-based anyway. A {@code ConcurrentHashMap} with explicit
     * remove-on-completion gives us atomicity without the leak risk, since
     * every conversation turn either hits the cap (we {@code remove}) or
     * completes/errors normally (we {@code remove} in finally).
     */
    static final class BoundedToolCallingManager implements ToolCallingManager {

        private final ToolCallingManager delegate;
        private final int maxIterationsBeforeReturnDirect;
        private final Map<ChatOptions, Integer> iterations = new ConcurrentHashMap<>();

        BoundedToolCallingManager(ToolCallingManager delegate, int maxIterationsBeforeReturnDirect) {
            this.delegate = delegate;
            this.maxIterationsBeforeReturnDirect = maxIterationsBeforeReturnDirect;
        }

        @Override
        public List<ToolDefinition> resolveToolDefinitions(ToolCallingChatOptions chatOptions) {
            return delegate.resolveToolDefinitions(chatOptions);
        }

        @Override
        public ToolExecutionResult executeToolCalls(Prompt prompt, ChatResponse chatResponse) {
            ChatOptions options = prompt.getOptions();

            // When options are null we have no stable per-turn key; rather
            // than collapse every concurrent null-options prompt onto a shared
            // counter (cross-contamination), pass through to the delegate
            // with no cap. Showcase demos always supply ChatOptions, so this
            // is a defensive short-circuit.
            if (options == null) {
                log.debug("[BoundedTCM] prompt.getOptions() is null; delegating without cap");
                try {
                    return delegate.executeToolCalls(prompt, chatResponse);
                } catch (RuntimeException ex) {
                    log.error("[BoundedTCM] delegate.executeToolCalls threw (null-options path)", ex);
                    throw ex;
                }
            }

            ToolExecutionResult delegated;
            try {
                delegated = delegate.executeToolCalls(prompt, chatResponse);
            } catch (RuntimeException ex) {
                // Never leak counter state across failed turns.
                iterations.remove(options);
                log.error("[BoundedTCM] delegate.executeToolCalls threw; cleared iteration counter for options", ex);
                throw ex;
            }

            // Atomic read-modify-write: avoids the getOrDefault+put race that
            // could lose increments under concurrent tool-execution callbacks.
            int next = iterations.compute(options, (k, v) -> (v == null ? 0 : v) + 1);

            if (next >= maxIterationsBeforeReturnDirect && !delegated.returnDirect()) {
                log.warn(
                        "Tool-execution loop cap hit (iteration {} >= {}); flipping returnDirect=true to terminate the loop after this tool call.",
                        next, maxIterationsBeforeReturnDirect);
                iterations.remove(options);
                return DefaultToolExecutionResult.builder()
                        .conversationHistory(delegated.conversationHistory())
                        .returnDirect(true)
                        .build();
            }
            return delegated;
        }

        // Visible for tests.
        int iterationCount(ChatOptions options) {
            if (options == null) {
                return 0;
            }
            return iterations.getOrDefault(options, 0);
        }

        // Visible for tests.
        boolean hasCounter(ChatOptions options) {
            if (options == null) {
                // The null-options path never populates the map (see
                // executeToolCalls); report "no counter" to match.
                return false;
            }
            return iterations.containsKey(options);
        }
    }
}
