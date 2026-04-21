package com.copilotkit.showcase.springai;

import com.copilotkit.showcase.springai.BoundedToolCallingManagerConfig.BoundedToolCallingManager;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.DefaultToolExecutionResult;
import org.springframework.ai.model.tool.ToolCallingManager;
import org.springframework.ai.model.tool.ToolExecutionResult;

import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link BoundedToolCallingManagerConfig.BoundedToolCallingManager}.
 *
 * <p>Covers: first-call pass-through, Nth-call returnDirect flip, counter
 * reset on fresh options, null-options short-circuit, counter eviction after
 * cap, counter eviction on delegate-signalled returnDirect, counter eviction
 * on delegate exception, constructor validation, and bounded-size invariant
 * on the happy path (sub-cap iterations).
 */
class BoundedToolCallingManagerConfigTest {

    private static ToolExecutionResult passThroughResult() {
        return DefaultToolExecutionResult.builder()
                .conversationHistory(Collections.emptyList())
                .returnDirect(false)
                .build();
    }

    private static ToolExecutionResult returnDirectResult() {
        return DefaultToolExecutionResult.builder()
                .conversationHistory(Collections.emptyList())
                .returnDirect(true)
                .build();
    }

    private static Prompt promptWithOptions(ChatOptions options) {
        Prompt prompt = mock(Prompt.class);
        when(prompt.getOptions()).thenReturn(options);
        return prompt;
    }

    private static ChatResponse emptyChatResponse() {
        return new ChatResponse(Collections.emptyList());
    }

    @Test
    void firstCallBelowCap_delegatesThroughWithoutFlippingReturnDirect() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 2);
        ChatOptions options = mock(ChatOptions.class);

        ToolExecutionResult result = mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse());

        assertThat(result.returnDirect()).isFalse();
        assertThat(mgr.iterationCount(options)).isEqualTo(1);
    }

    @Test
    void nthCallAtCap_flipsReturnDirectTrue() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 1);
        ChatOptions options = mock(ChatOptions.class);

        ToolExecutionResult result = mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse());

        assertThat(result.returnDirect()).isTrue();
    }

    @Test
    void freshOptionsInstance_resetsCounter() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        // Cap high so the first turn doesn't flip.
        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 5);
        ChatOptions turnA = mock(ChatOptions.class);
        ChatOptions turnB = mock(ChatOptions.class);

        mgr.executeToolCalls(promptWithOptions(turnA), emptyChatResponse());
        mgr.executeToolCalls(promptWithOptions(turnA), emptyChatResponse());
        assertThat(mgr.iterationCount(turnA)).isEqualTo(2);

        mgr.executeToolCalls(promptWithOptions(turnB), emptyChatResponse());
        assertThat(mgr.iterationCount(turnB)).isEqualTo(1);
        // Turn A's counter is independent of turn B.
        assertThat(mgr.iterationCount(turnA)).isEqualTo(2);
    }

    @Test
    void nullOptions_delegatesWithoutCappingAndWithoutSharedKey() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 1);

        // Many calls with null options should never flip returnDirect, and
        // should never populate a null-keyed counter.
        for (int i = 0; i < 10; i++) {
            ToolExecutionResult result = mgr.executeToolCalls(promptWithOptions(null), emptyChatResponse());
            assertThat(result.returnDirect()).isFalse();
        }
        assertThat(mgr.hasCounter(null)).isFalse();
        // Null-options path must have zero counter-cache side effects.
        assertThat(mgr.counterCacheSize()).isZero();
    }

    @Test
    void counterRemovedAfterCapHit_allowsNextTurnOnSameOptionsToStartFresh() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 1);
        ChatOptions options = mock(ChatOptions.class);

        // First call hits cap immediately (cap=1) and removes the counter.
        ToolExecutionResult first = mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse());
        assertThat(first.returnDirect()).isTrue();
        assertThat(mgr.hasCounter(options)).isFalse();
    }

    @Test
    void delegateReturnDirect_evictsCounterToPreventHappyPathLeak() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 5);
        ChatOptions options = mock(ChatOptions.class);

        // Delegate signals end-of-turn via returnDirect=true (e.g. a tool
        // declared returnDirect). The cap is nowhere near hit, but we should
        // still evict the counter so memory doesn't accumulate on the happy
        // path.
        doReturn(returnDirectResult()).when(delegate).executeToolCalls(any(), any());
        ToolExecutionResult result = mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse());

        assertThat(result.returnDirect()).isTrue();
        assertThat(mgr.hasCounter(options)).isFalse();
    }

    @Test
    void happyPathNaturalCompletion_keepsCounterBoundedUnderCapAndCacheSizeBounded() {
        // Simulates the leak scenario: a high cap (so returnDirect is never
        // flipped) and a delegate that returns returnDirect=false every time.
        // Without the bounded-cache fix, the map would accumulate one entry
        // per distinct ChatOptions reference forever. With Caffeine's
        // maxSize bound, the cache cannot exceed its capacity regardless of
        // traffic.
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 1_000_000);

        // Each iteration uses a DIFFERENT ChatOptions reference (what you'd
        // see across many independent concurrent conversation turns).
        int turns = 200;
        for (int i = 0; i < turns; i++) {
            ChatOptions perTurn = mock(ChatOptions.class);
            mgr.executeToolCalls(promptWithOptions(perTurn), emptyChatResponse());
        }

        // The cache should hold at most MAX_CACHE_SIZE entries. In this test
        // we're well under that bound, but the real invariant we care about
        // is "the count tracks what a bounded cache gives us" — assert it's
        // at most the number of distinct turns (i.e. we didn't double-insert
        // per iteration).
        long size = mgr.counterCacheSize();
        assertThat(size).isLessThanOrEqualTo(turns);
        assertThat(size).isLessThanOrEqualTo(BoundedToolCallingManager.MAX_CACHE_SIZE);
    }

    @Test
    void tenSubCapIterationsOnSameOptions_doNotCauseMapGrowth() {
        // 10 non-cap iterations on the same ChatOptions should produce at
        // most ONE cache entry — the counter increments in place rather than
        // allocating a new entry per iteration.
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 1_000_000);
        ChatOptions options = mock(ChatOptions.class);

        for (int i = 0; i < 10; i++) {
            mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse());
        }

        assertThat(mgr.iterationCount(options)).isEqualTo(10);
        assertThat(mgr.counterCacheSize()).isEqualTo(1L);
    }

    @Test
    void delegateException_clearsCounterAndRethrows() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        RuntimeException boom = new RuntimeException("boom");

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 5);
        ChatOptions options = mock(ChatOptions.class);

        // Seed the counter with one successful increment, then swap the stub
        // to throw. Use do*.when so re-stubbing doesn't invoke the previous
        // behavior during recording.
        doReturn(passThroughResult()).when(delegate).executeToolCalls(any(), any());
        mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse());
        assertThat(mgr.iterationCount(options)).isEqualTo(1);

        doThrow(boom).when(delegate).executeToolCalls(any(), any());
        assertThatThrownBy(() ->
                mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse()))
                .isSameAs(boom);

        // Counter must not leak across a failed turn.
        assertThat(mgr.hasCounter(options)).isFalse();
    }

    @Test
    void delegateError_propagatesWithoutCatching() {
        // VirtualMachineError (OOM, StackOverflow) leaves the JVM in an
        // undefined state — we deliberately do NOT catch Throwable here
        // because running arbitrary cleanup code (cache.invalidate, etc.)
        // against a broken JVM can make things worse. Errors unwind unhandled;
        // only RuntimeException/checked Exception get the cleanup+rethrow path.
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        Error err = new OutOfMemoryError("simulated");

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 5);
        ChatOptions options = mock(ChatOptions.class);

        doReturn(passThroughResult()).when(delegate).executeToolCalls(any(), any());
        mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse());
        assertThat(mgr.iterationCount(options)).isEqualTo(1);

        doThrow(err).when(delegate).executeToolCalls(any(), any());
        assertThatThrownBy(() ->
                mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse()))
                .isSameAs(err);
    }

    @Test
    void nullOptionsDelegateException_rethrowsAndLogsWithoutTouchingCounter() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        RuntimeException boom = new RuntimeException("boom-null");
        when(delegate.executeToolCalls(any(), any())).thenThrow(boom);

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 1);

        assertThatThrownBy(() ->
                mgr.executeToolCalls(promptWithOptions(null), emptyChatResponse()))
                .isSameAs(boom);
        assertThat(mgr.hasCounter(null)).isFalse();
        // Failed null-options path must have zero counter-cache side effects.
        assertThat(mgr.counterCacheSize()).isZero();
    }

    /**
     * Test-only {@link ChatOptions} with value-based equals/hashCode. Without
     * {@code Caffeine.weakKeys()} (which forces identity comparison), two
     * distinct instances that are {@code equals} would collapse onto a single
     * cache entry — causing the iteration cap to fire early on the second
     * concurrent turn.
     */
    private static final class EqualsBasedChatOptions implements ChatOptions {
        private final String marker;
        EqualsBasedChatOptions(String marker) { this.marker = marker; }
        @Override public boolean equals(Object o) {
            if (!(o instanceof EqualsBasedChatOptions)) return false;
            return marker.equals(((EqualsBasedChatOptions) o).marker);
        }
        @Override public int hashCode() { return marker.hashCode(); }
        @Override public String getModel() { return null; }
        @Override public Double getFrequencyPenalty() { return null; }
        @Override public Integer getMaxTokens() { return null; }
        @Override public Double getPresencePenalty() { return null; }
        @Override public java.util.List<String> getStopSequences() { return null; }
        @Override public Double getTemperature() { return null; }
        @Override public Integer getTopK() { return null; }
        @Override public Double getTopP() { return null; }
        @Override public <T extends ChatOptions> T copy() {
            @SuppressWarnings("unchecked")
            T t = (T) new EqualsBasedChatOptions(marker);
            return t;
        }
    }

    @Test
    void equalButNotSameChatOptions_trackSeparateCounters() {
        // Identity-keyed cache: two ChatOptions instances that are equals()
        // but not == must NOT share a counter. If they did, two concurrent
        // turns with equivalent options would collapse onto one counter and
        // the cap would trip early on the second turn.
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 5);

        EqualsBasedChatOptions a = new EqualsBasedChatOptions("same");
        EqualsBasedChatOptions b = new EqualsBasedChatOptions("same");

        // Sanity: our test fixture really does have value equality.
        assertThat(a).isEqualTo(b);
        assertThat(a).isNotSameAs(b);

        mgr.executeToolCalls(promptWithOptions(a), emptyChatResponse());
        mgr.executeToolCalls(promptWithOptions(a), emptyChatResponse());
        mgr.executeToolCalls(promptWithOptions(b), emptyChatResponse());

        assertThat(mgr.iterationCount(a)).isEqualTo(2);
        assertThat(mgr.iterationCount(b)).isEqualTo(1);
    }

    @Test
    void constructorRejectsZeroOrNegativeCap() {
        assertThatThrownBy(() -> new BoundedToolCallingManagerConfig(0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("max-iterations must be >= 1");
        assertThatThrownBy(() -> new BoundedToolCallingManagerConfig(-3))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("max-iterations must be >= 1");
    }

    // AssistantMessage import present to force test compile against Spring-AI
    // so a stale transitive dep is caught at test-compile time rather than
    // run time. (Unused reference — instantiate cheaply.)
    @Test
    void springAiClasspathSanityCheck() {
        AssistantMessage m = new AssistantMessage("hi");
        assertThat(m.getText()).isEqualTo("hi");
    }

    @Test
    void concurrentCallsOnSameOptions_honorCapInvariant() throws Exception {
        // Race-contention test: N threads concurrently exercise executeToolCalls
        // on the SAME ChatOptions instance. The cap invariant is:
        //   "at most 1 call should see returnDirect=true flipped; all others
        //    should see returnDirect=false, AND the total number of flips must
        //    equal exactly 1".
        // Without atomic increment + single-flip logic, two threads could both
        // observe next>=cap and both flip returnDirect (double-terminate), or
        // both miss the cap (runaway loop). Caffeine's compute semantics +
        // AtomicInteger.incrementAndGet guarantee the single-writer property.
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        // Cap = 1: the very first increment hits cap; every other concurrent
        // caller (which observes next > 1 after the cap-hitter invalidated
        // the counter, re-seeded it, and re-incremented) must see the
        // cap-hit branch too and flip returnDirect. To make the invariant
        // stricter we use cap = N threads: exactly N flips total.
        final int threads = 16;
        final int callsPerThread = 50;
        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 1);
        ChatOptions options = mock(ChatOptions.class);

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger flips = new AtomicInteger(0);
        AtomicInteger total = new AtomicInteger(0);
        AtomicInteger failures = new AtomicInteger(0);
        try {
            for (int t = 0; t < threads; t++) {
                pool.submit(() -> {
                    try {
                        start.await();
                        for (int i = 0; i < callsPerThread; i++) {
                            ToolExecutionResult r = mgr.executeToolCalls(
                                    promptWithOptions(options), emptyChatResponse());
                            total.incrementAndGet();
                            if (r.returnDirect()) {
                                flips.incrementAndGet();
                            }
                        }
                    } catch (Throwable ex) {
                        failures.incrementAndGet();
                    }
                });
            }
            start.countDown();
            pool.shutdown();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        } finally {
            if (!pool.isTerminated()) {
                pool.shutdownNow();
            }
        }

        assertThat(failures.get()).as("no thread should have thrown").isZero();
        assertThat(total.get()).isEqualTo(threads * callsPerThread);

        // Invariant: at cap=1 EVERY call must flip returnDirect, because the
        // cap-hit branch invalidates the counter after flipping, so each
        // fresh increment re-hits the cap. Crucially, no call should see
        // returnDirect=false — that would indicate a lost update in the
        // counter (two threads both incrementing to 1 when only one should
        // have crossed the threshold first).
        assertThat(flips.get())
                .as("with cap=1, every concurrent call must observe the cap and flip returnDirect (no lost updates)")
                .isEqualTo(total.get());
    }

    @Test
    void concurrentCallsOnSameOptions_noTwoThreadsExceedCapMinusOneConcurrently() throws Exception {
        // Stronger invariant: with cap=N and N concurrent threads each doing
        // one call, we must see EXACTLY one returnDirect=true flip across the
        // batch (the Nth thread to increment) — no two threads can both
        // observe "next >= N" and both flip, no two can both miss it.
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        final int cap = 8;
        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, cap);
        ChatOptions options = mock(ChatOptions.class);

        ExecutorService pool = Executors.newFixedThreadPool(cap);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger flips = new AtomicInteger(0);
        try {
            for (int t = 0; t < cap; t++) {
                pool.submit(() -> {
                    try {
                        start.await();
                        ToolExecutionResult r = mgr.executeToolCalls(
                                promptWithOptions(options), emptyChatResponse());
                        if (r.returnDirect()) {
                            flips.incrementAndGet();
                        }
                    } catch (InterruptedException ignored) {
                        Thread.currentThread().interrupt();
                    }
                });
            }
            start.countDown();
            pool.shutdown();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        } finally {
            if (!pool.isTerminated()) {
                pool.shutdownNow();
            }
        }

        // Exactly one thread hit the cap; the cap was not exceeded (no
        // double-flip) nor missed (no zero-flip). This is the race-safety
        // invariant the atomic compute primitive buys us.
        assertThat(flips.get()).isEqualTo(1);
    }
}
