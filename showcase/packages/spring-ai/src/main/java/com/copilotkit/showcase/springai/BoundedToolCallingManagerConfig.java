package com.copilotkit.showcase.springai;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
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

import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Caps Spring-AI's internal tool-execution loop by wrapping the default
 * {@link ToolCallingManager} and flipping {@code returnDirect=true} on the
 * result once the configured iteration cap is hit on the current conversation
 * turn.
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
 * multi-step tool chains. The value is interpreted inclusively: a value of
 * {@code N} allows <em>exactly N</em> tool iterations before {@code returnDirect}
 * is flipped on the Nth result. For example, {@code N=1} means the very first
 * tool execution is the last one for that turn; {@code N=3} allows three tool
 * rounds before forcing completion.
 */
@Configuration
public class BoundedToolCallingManagerConfig {

    private static final Logger log = LoggerFactory.getLogger(BoundedToolCallingManagerConfig.class);

    /**
     * Default cap: one tool iteration is plenty for the CopilotKit showcase
     * demos (weather, single chart, meeting scheduling) and ensures a
     * deterministic aimock fixture can't pull the agent into an infinite
     * tool-call loop.
     *
     * <p>Interpretation: {@code N=1} allows exactly one tool round per turn;
     * Spring-AI executes the tool, we flip {@code returnDirect=true}, and the
     * outer loop terminates. Override via {@code copilotkit.tool.max-iterations}.
     */
    static final int DEFAULT_TOOL_ITERATION_CAP_INCLUSIVE = 1;

    private final int toolIterationCapInclusive;

    public BoundedToolCallingManagerConfig(
            @Value("${copilotkit.tool.max-iterations:" + DEFAULT_TOOL_ITERATION_CAP_INCLUSIVE + "}") int toolIterationCapInclusive) {
        if (toolIterationCapInclusive < 1) {
            throw new IllegalArgumentException(
                    "copilotkit.tool.max-iterations must be >= 1 (got " + toolIterationCapInclusive +
                    "). A value of 0 would short-circuit every tool call before execution; " +
                    "negative values are meaningless."
            );
        }
        this.toolIterationCapInclusive = toolIterationCapInclusive;
    }

    @Bean
    public ToolCallingManager boundedToolCallingManager(
            ObjectProvider<ObservationRegistry> observationRegistryProvider,
            List<ToolCallback> toolCallbacks) {

        log.info("[BoundedTCM] Installing bounded ToolCallingManager (toolIterationCapInclusive={}) with {} tool callbacks",
                toolIterationCapInclusive, toolCallbacks.size());
        ObservationRegistry observationRegistry =
                observationRegistryProvider.getIfUnique(() -> ObservationRegistry.NOOP);

        ToolCallingManager delegate = ToolCallingManager.builder()
                .observationRegistry(observationRegistry)
                .toolCallbackResolver(new StaticToolCallbackResolver(toolCallbacks))
                .toolExecutionExceptionProcessor(
                        DefaultToolExecutionExceptionProcessor.builder().build())
                .build();

        return new BoundedToolCallingManager(delegate, toolIterationCapInclusive);
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
     * single streaming tool-calling turn".
     *
     * <h4>Counter storage and eviction</h4>
     *
     * <p>The counter is stored in a {@link Caffeine} {@link Cache} configured
     * with {@link Caffeine#weakKeys()}, which is what actually forces identity
     * comparison ({@code ==} / {@code System.identityHashCode}) rather than
     * {@code equals}/{@code hashCode}. This matters: some Spring-AI
     * {@code ChatOptions} implementations have value-based equality, so two
     * concurrent turns with <em>equivalent but distinct</em> options instances
     * would otherwise SHARE a counter — causing the cap to fire early on the
     * second turn (an observed bug). {@code weakKeys()} also means abandoned
     * counters are GC-eligible once the caller drops the {@code ChatOptions}
     * reference, complementing the explicit eviction paths below. Caffeine
     * gives us three further guarantees we need:
     * <ul>
     *   <li>atomic read-modify-write via {@link Cache#asMap()} {@code compute},
     *       avoiding the {@code getOrDefault + put} race;</li>
     *   <li>bounded maximum size ({@value #MAX_CACHE_SIZE}) so a pathological
     *       volume of concurrent turns can't exhaust heap;</li>
     *   <li>{@code expireAfterAccess(5m)} so counters abandoned on the happy
     *       path (turn completes naturally without hitting the cap, and
     *       Spring-AI never calls {@code executeToolCalls} again for that
     *       turn) are evicted without relying on GC or explicit cleanup.</li>
     * </ul>
     *
     * <p>Historical note: earlier revisions used
     * {@code Collections.synchronizedMap(new WeakHashMap<>())} and later a
     * raw {@link java.util.concurrent.ConcurrentHashMap}. WeakHashMap was
     * wrong because {@code ChatOptions} uses identity-based hashing anyway and
     * {@code getOrDefault+put} isn't atomic. A bare ConcurrentHashMap was
     * correct for atomicity but leaked memory on the happy path — Spring-AI's
     * outer loop never notifies the ToolCallingManager that a turn has
     * finished, so natural-completion counters stayed in the map forever
     * (held by the live ChatOptions reference elsewhere). Caffeine fixes both
     * the atomicity and the residency bound in one primitive.
     */
    static final class BoundedToolCallingManager implements ToolCallingManager {

        /**
         * Upper bound on simultaneous in-flight counters. Calibrated well
         * above any plausible concurrent-turn count for the showcase; the cap
         * exists to protect against pathological misuse, not to throttle
         * steady-state traffic.
         */
        static final long MAX_CACHE_SIZE = 10_000L;

        /**
         * Inactivity window after which a counter is evicted. Covers "slow
         * clients" and "turn completed naturally on a below-cap iteration"
         * without holding memory indefinitely. Tool-calling turns that take
         * longer than 5 minutes between iterations are already broken in
         * other ways.
         */
        static final Duration EXPIRE_AFTER_ACCESS = Duration.ofMinutes(5);

        private final ToolCallingManager delegate;
        private final int maxIterationsBeforeReturnDirect;
        private final Cache<ChatOptions, AtomicInteger> iterations;

        BoundedToolCallingManager(ToolCallingManager delegate, int maxIterationsBeforeReturnDirect) {
            this.delegate = delegate;
            this.maxIterationsBeforeReturnDirect = maxIterationsBeforeReturnDirect;
            this.iterations = Caffeine.newBuilder()
                    // weakKeys() forces identity comparison (== / identity
                    // hash code) for keys — without it, Caffeine uses
                    // Object.equals/hashCode, which for some Spring-AI
                    // ChatOptions impls is value-based. Two concurrent turns
                    // with equivalent options would then share one counter
                    // and the cap would fire early on the second turn.
                    //
                    // NB: weakKeys() forces identity (==) not equals().
                    // Intentional here (per-request ChatOptions instance)
                    // but DO NOT feed canonicalized/interned keys through
                    // this cache — they'd all share one counter and the
                    // cap would trip across unrelated turns.
                    .weakKeys()
                    .maximumSize(MAX_CACHE_SIZE)
                    .expireAfterAccess(EXPIRE_AFTER_ACCESS)
                    .build();
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
            // is a defensive short-circuit — and crucially has NO counter
            // side effect (no cache insert, no increment).
            if (options == null) {
                log.debug("[BoundedTCM] prompt.getOptions() is null; delegating without cap");
                try {
                    return delegate.executeToolCalls(prompt, chatResponse);
                } catch (Exception ex) {
                    // Narrow to Exception: VirtualMachineError (OOM,
                    // StackOverflow) leaves the JVM in an undefined state —
                    // there's no safe action to take besides propagating. We
                    // deliberately do NOT catch Throwable here.
                    log.error("[BoundedTCM] delegate.executeToolCalls threw (null-options path)", ex);
                    throw ex;
                }
            }

            ToolExecutionResult delegated;
            try {
                delegated = delegate.executeToolCalls(prompt, chatResponse);
            } catch (Exception ex) {
                // Never leak counter state across failed turns. We narrowed
                // from Throwable to Exception deliberately: catching
                // VirtualMachineError (OOM, StackOverflow) is unsafe — the
                // JVM is in an undefined state and running arbitrary cleanup
                // code (like cache.invalidate()) can make things worse.
                // Let Errors unwind unhandled. Runtime/checked exceptions get
                // the cleanup + rethrow so the caller sees the original
                // failure with no lingering counter state.
                iterations.invalidate(options);
                log.error("[BoundedTCM] delegate.executeToolCalls threw; cleared iteration counter for options", ex);
                throw ex;
            }

            // Atomic read-modify-write via Caffeine's asMap compute. AtomicInteger
            // is used as the value type so we never have to replace the map entry
            // (keeps Caffeine's recency tracking clean and avoids redundant writes).
            AtomicInteger counter = iterations.get(options, k -> new AtomicInteger(0));
            int next = counter.incrementAndGet();

            // Cap hit: flip returnDirect and evict the counter so a subsequent
            // turn that happens to reuse this ChatOptions reference starts fresh.
            if (next >= maxIterationsBeforeReturnDirect && !delegated.returnDirect()) {
                log.warn(
                        "Tool-execution loop cap hit (iteration {} >= {}); flipping returnDirect=true to terminate the loop after this tool call.",
                        next, maxIterationsBeforeReturnDirect);
                iterations.invalidate(options);
                return DefaultToolExecutionResult.builder()
                        .conversationHistory(delegated.conversationHistory())
                        .returnDirect(true)
                        .build();
            }

            // Delegate already signalled end-of-turn (e.g. a tool declared
            // returnDirect). Evict so we don't leak memory for turns that
            // completed below the cap via the delegate's own signalling.
            if (delegated.returnDirect()) {
                iterations.invalidate(options);
            }

            return delegated;
        }

        // Visible for tests.
        int iterationCount(ChatOptions options) {
            if (options == null) {
                return 0;
            }
            AtomicInteger counter = iterations.getIfPresent(options);
            return counter == null ? 0 : counter.get();
        }

        // Visible for tests.
        boolean hasCounter(ChatOptions options) {
            if (options == null) {
                // The null-options path never populates the cache (see
                // executeToolCalls); report "no counter" to match.
                return false;
            }
            return iterations.getIfPresent(options) != null;
        }

        // Visible for tests: estimated live counter count. Caffeine may briefly
        // over-report pending inserts/evictions; tests tolerate a small delta.
        long counterCacheSize() {
            iterations.cleanUp();
            return iterations.estimatedSize();
        }
    }
}
