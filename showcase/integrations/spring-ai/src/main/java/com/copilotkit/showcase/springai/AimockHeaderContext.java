package com.copilotkit.showcase.springai;

import java.util.Collections;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Thread-local holder for {@code x-*} prefixed headers extracted from incoming
 * AG-UI requests.
 *
 * <p>Uses {@link InheritableThreadLocal} so the headers propagate into child
 * threads created by {@link java.util.concurrent.CompletableFuture#runAsync}
 * (which the AG-UI SDK uses internally). The outbound interceptors
 * ({@link AimockHeaderRequestInterceptor} for RestClient,
 * {@link WebClientConfig} for WebClient) read these headers and forward them
 * to the LLM API (aimock/OpenAI).
 *
 * <p>Lifecycle: set by {@link AimockHeaderInterceptor#preHandle}, cleared by
 * {@link AimockHeaderInterceptor#afterCompletion}.
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
}
