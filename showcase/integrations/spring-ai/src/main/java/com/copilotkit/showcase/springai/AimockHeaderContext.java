package com.copilotkit.showcase.springai;

import java.util.Collections;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Thread-local holder for {@code x-*} prefixed headers extracted from incoming
 * AG-UI requests.
 *
 * <p>The outbound interceptors ({@link AimockHeaderRequestInterceptor} for
 * RestClient, {@link WebClientConfig} for WebClient) read these headers and
 * forward them to the LLM API (aimock/OpenAI).
 *
 * <p><b>Thread-handoff hazard.</b> The inbound headers are captured on the
 * Tomcat request thread by {@link AimockHeaderInterceptor#preHandle}, but the
 * AG-UI Java SDK's {@code LocalAgent.runAgent} dispatches the actual LLM call
 * via {@link java.util.concurrent.CompletableFuture#runAsync} onto a
 * <em>pre-existing</em> {@code ForkJoinPool.commonPool()} worker thread.
 * {@link InheritableThreadLocal} only copies the parent's value at the moment a
 * child thread is <em>created</em>; a pooled worker was created long before the
 * request arrived, so it snapshots an empty map and the outbound interceptor
 * reads nothing (journal shows {@code x-aimock-context} absent → aimock strict
 * 503 → empty assistant message → conversation-error).
 *
 * <p><b>Fix.</b> The {@code InheritableThreadLocal} is retained for the simple
 * same-thread case, but propagation across the SDK's pooled-thread hop is done
 * <em>explicitly</em>: {@link #capture()} snapshots the headers on the request
 * thread and {@link #runWith(Map, Runnable)} re-establishes that snapshot on
 * whatever worker thread actually runs the agent. {@code PropagatingLocalAgent}
 * wires these two together around the {@code runAsync} boundary. This mirrors
 * the AsyncLocalStorage-based shim used by the TypeScript integrations
 * (e.g. mastra's {@code _header_forwarding.ts}).
 *
 * <p>Lifecycle: set by {@link AimockHeaderInterceptor#preHandle}, cleared by
 * {@link AimockHeaderInterceptor#afterCompletion}; re-established/cleared around
 * the agent body by {@link #runWith(Map, Runnable)}.
 */
public final class AimockHeaderContext {

    private static final InheritableThreadLocal<Map<String, String>> HEADERS =
            new InheritableThreadLocal<>() {
                @Override
                protected Map<String, String> initialValue() {
                    return Collections.emptyMap();
                }
            };

    private AimockHeaderContext() {
        // utility class
    }

    /**
     * Stores the given headers after filtering to only {@code x-*} prefixed keys.
     * Keys are lower-cased for consistent matching on the outbound side.
     */
    public static void set(Map<String, String> headers) {
        Map<String, String> filtered = headers.entrySet().stream()
                .filter(e -> e.getKey().toLowerCase(java.util.Locale.ROOT)
                        .startsWith("x-"))
                .collect(Collectors.toMap(
                        e -> e.getKey().toLowerCase(java.util.Locale.ROOT),
                        Map.Entry::getValue));
        HEADERS.set(Collections.unmodifiableMap(filtered));
    }

    /**
     * Returns the current thread's {@code x-*} prefixed headers, or an empty map
     * if none have been set.
     */
    public static Map<String, String> get() {
        return HEADERS.get();
    }

    /** Removes the headers from the current thread. */
    public static void clear() {
        HEADERS.remove();
    }

    /**
     * Snapshots the current thread's headers for explicit propagation across a
     * thread hop. Call this on the request thread (where
     * {@link AimockHeaderInterceptor} has populated the context), then hand the
     * returned map to {@link #runWith(Map, Runnable)} on the worker thread.
     *
     * <p>Returns an immutable map; never {@code null}.
     */
    public static Map<String, String> capture() {
        return HEADERS.get();
    }

    /**
     * Runs {@code body} with {@code headers} bound to the current thread's
     * context, restoring the prior binding afterwards. This is the explicit
     * propagation primitive used to carry request-thread headers across the
     * AG-UI SDK's {@code CompletableFuture.runAsync} hop onto a pooled worker
     * thread that would otherwise see an empty {@link InheritableThreadLocal}.
     *
     * <p>If {@code headers} is {@code null} or empty, the body still runs but no
     * binding is established (any prior binding is preserved).
     */
    public static void runWith(Map<String, String> headers, Runnable body) {
        if (headers == null || headers.isEmpty()) {
            body.run();
            return;
        }
        Map<String, String> previous = HEADERS.get();
        HEADERS.set(Collections.unmodifiableMap(new java.util.HashMap<>(headers)));
        try {
            body.run();
        } finally {
            // Restore the worker thread's prior binding. A pooled worker is
            // reused across requests, so leaving a stale binding would leak
            // one request's context into the next run on the same thread.
            if (previous == null || previous.isEmpty()) {
                HEADERS.remove();
            } else {
                HEADERS.set(previous);
            }
        }
    }
}
