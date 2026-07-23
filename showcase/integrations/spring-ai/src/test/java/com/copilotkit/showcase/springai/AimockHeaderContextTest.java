package com.copilotkit.showcase.springai;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for {@link AimockHeaderContext}'s explicit cross-thread propagation,
 * which is what makes {@code x-aimock-context} survive the AG-UI SDK's
 * {@code CompletableFuture.runAsync} hop onto a pooled worker thread.
 *
 * <p>The headline test ({@link #runWithReestablishesHeadersOnAnotherThread})
 * reproduces the production failure mode at the unit level: a pre-existing
 * pooled worker thread (created BEFORE any header was set, so its
 * {@link InheritableThreadLocal} snapshot is empty) reads an empty context
 * unless propagation is done explicitly. With {@link AimockHeaderContext#capture()}
 * + {@link AimockHeaderContext#runWith(Map, Runnable)}, the worker sees the
 * captured headers regardless of when it was created.
 */
class AimockHeaderContextTest {

    @AfterEach
    void tearDown() {
        AimockHeaderContext.clear();
    }

    @Test
    void setFiltersToXPrefixedHeadersAndLowercasesKeys() {
        AimockHeaderContext.set(Map.of(
                "X-AIMock-Context", "spring-ai",
                "X-Test-Id", "demo",
                "Authorization", "Bearer secret",
                "Content-Type", "application/json"));

        Map<String, String> stored = AimockHeaderContext.get();

        assertThat(stored).containsOnlyKeys("x-aimock-context", "x-test-id");
        assertThat(stored).containsEntry("x-aimock-context", "spring-ai");
        assertThat(stored).containsEntry("x-test-id", "demo");
    }

    @Test
    void runWithReestablishesHeadersOnAnotherThread() throws Exception {
        // Simulate the SDK's pooled worker: a thread that was created BEFORE
        // the request set any header, so an InheritableThreadLocal alone would
        // snapshot an empty map. We grab a reference to such a worker first.
        AtomicReference<Thread> pooledWorker = new AtomicReference<>();
        CompletableFuture.runAsync(() -> pooledWorker.set(Thread.currentThread())).get();

        // Now, on THIS (request) thread, set the inbound headers.
        AimockHeaderContext.set(Map.of("X-AIMock-Context", "spring-ai"));
        Map<String, String> captured = AimockHeaderContext.capture();

        // Dispatch onto the SAME pooled worker via the common pool. Without
        // runWith, the worker would observe an empty context (the bug).
        AtomicReference<Map<String, String>> observedWithoutPropagation = new AtomicReference<>();
        AtomicReference<Map<String, String>> observedWithPropagation = new AtomicReference<>();

        CompletableFuture.runAsync(() -> {
            // Baseline: what the worker sees with NO explicit propagation.
            observedWithoutPropagation.set(AimockHeaderContext.get());
            // Fixed path: runWith re-establishes the captured snapshot.
            AimockHeaderContext.runWith(captured, () ->
                    observedWithPropagation.set(AimockHeaderContext.get()));
        }).get();

        // The bug: a pre-existing pooled worker sees an empty context.
        assertThat(observedWithoutPropagation.get()).doesNotContainKey("x-aimock-context");
        // The fix: runWith makes the captured header visible on that worker.
        assertThat(observedWithPropagation.get())
                .containsEntry("x-aimock-context", "spring-ai");
    }

    @Test
    void runWithRestoresPriorBindingAfterBody() {
        // A worker reused across requests must not leak one request's context
        // into the next run on the same thread.
        AimockHeaderContext.runWith(Map.of("x-aimock-context", "first"), () -> {
            assertThat(AimockHeaderContext.get()).containsEntry("x-aimock-context", "first");
        });
        // After the scoped run, the (empty) prior binding is restored.
        assertThat(AimockHeaderContext.get()).doesNotContainKey("x-aimock-context");
    }

    @Test
    void runWithEmptyHeadersPreservesExistingBinding() {
        AimockHeaderContext.set(Map.of("X-AIMock-Context", "outer"));
        AimockHeaderContext.runWith(Map.of(), () ->
                assertThat(AimockHeaderContext.get()).containsEntry("x-aimock-context", "outer"));
        assertThat(AimockHeaderContext.get()).containsEntry("x-aimock-context", "outer");
    }
}
