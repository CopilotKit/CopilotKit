package com.copilotkit.showcase.springai;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.reactive.function.client.WebClientCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.JdkClientHttpConnector;

import java.net.http.HttpClient;
import java.util.Optional;

/**
 * Forces Spring-AI's WebClient to use the JDK HttpClient pinned to HTTP/1.1
 * with connection pooling disabled.
 *
 * <p>Pinning HTTP/1.1 prevents cleartext {@code Upgrade: h2c} negotiation
 * (which aimock/Prism reject with 404). Disabling keepalive via
 * {@code jdk.httpclient.keepalive.timeout=0} prevents reuse of half-closed
 * pooled sockets, which would otherwise trip {@code Connection reset} on
 * follow-up tool-result requests.
 *
 * <p><b>Canonical rationale:</b> see {@code entrypoint.sh} — it carries the
 * authoritative JVM-arg wiring ({@code -Djdk.httpclient.keepalive.timeout=0})
 * and the full explanation of why we pin HTTP/1.1 and disable pooling. This
 * class is a defensive belt-and-suspenders: a static initializer for direct
 * {@code java -jar agent.jar} invocations where {@code entrypoint.sh} isn't
 * in play, plus a fail-fast {@code @Bean} check that throws
 * {@link IllegalStateException} (mirroring {@link OpenAiApiKeyValidator}'s
 * philosophy) if the property isn't {@code "0"} by bean construction time.
 * Set {@link #ALLOW_KEEPALIVE_ENV}={@code 1} (or {@code true}) to suppress
 * the override/throw — we warn and honor the operator's opt-in.
 */
@Configuration
public class WebClientConfig {

    private static final Logger log = LoggerFactory.getLogger(WebClientConfig.class);

    /** Property name we manage. */
    static final String KEEPALIVE_PROPERTY = "jdk.httpclient.keepalive.timeout";

    /** Value we force the property to in the default override path. */
    static final String ZERO = "0";

    /** Env var operators set to opt-in to honoring a non-zero value. */
    static final String ALLOW_KEEPALIVE_ENV = "COPILOTKIT_ALLOW_KEEPALIVE";

    static {
        applyKeepaliveDecision(
                System.getProperty(KEEPALIVE_PROPERTY),
                System.getenv(ALLOW_KEEPALIVE_ENV))
                .ifPresent(newValue -> System.setProperty(KEEPALIVE_PROPERTY, newValue));
    }

    /**
     * Pure function that computes whether (and how) to rewrite
     * {@code jdk.httpclient.keepalive.timeout}. Returns {@code Optional.empty()}
     * to mean "leave the existing value alone"; returns a non-empty value that
     * should be written into {@link System#setProperty(String, String)}.
     *
     * <p>Extracted as a static method so it can be unit-tested without the
     * awkward "re-trigger the static initializer" dance (classes only
     * initialize once per classloader, so the static block itself is
     * effectively untestable in-process).
     *
     * @param existing current value of the system property, or {@code null}
     *                 if unset
     * @param allowKeepaliveEnv value of {@link #ALLOW_KEEPALIVE_ENV}, or
     *                          {@code null} if unset. The strings
     *                          {@code "1"} or {@code "true"}
     *                          (case-insensitive, after trimming) opt in to
     *                          honoring a non-zero user value. Other values
     *                          (including {@code "0"}, {@code "false"},
     *                          {@code "yes"}, garbage) do NOT opt in.
     */
    static Optional<String> applyKeepaliveDecision(String existing, String allowKeepaliveEnv) {
        if (existing == null) {
            log.info(
                    "[WebClientConfig] {} was unset; defaulting to 0 to disable JDK HttpClient connection pooling (prevents 'Connection reset' against half-closed upstream sockets).",
                    KEEPALIVE_PROPERTY);
            return Optional.of(ZERO);
        }

        String trimmed = existing.trim();
        if (ZERO.equals(trimmed)) {
            // Already the value we would have set — nothing to do.
            return Optional.empty();
        }

        boolean allowKeepalive = isTruthy(allowKeepaliveEnv);
        if (allowKeepalive) {
            log.warn(
                    "[WebClientConfig] {}='{}' is non-zero AND {}=1 was set; honoring operator override. Note: keep-alive reuse can trigger 'Connection reset' against aimock/Prism upstreams. Set {} to 0 (or unset it) to re-enable the safe default.",
                    KEEPALIVE_PROPERTY, existing, ALLOW_KEEPALIVE_ENV, KEEPALIVE_PROPERTY);
            return Optional.empty();
        }

        log.error(
                "[WebClientConfig] {}='{}' is non-zero and {} is not a recognized opt-in value (accepted: 1/true, case-insensitive); force-overriding to 0 to prevent 'Connection reset' against half-closed upstream sockets. Set {}=1 (or true) to opt out of the override.",
                KEEPALIVE_PROPERTY, existing, ALLOW_KEEPALIVE_ENV, ALLOW_KEEPALIVE_ENV);
        return Optional.of(ZERO);
    }

    /**
     * Case-insensitive truthiness check. Accepts {@code "1"} and {@code "true"}
     * (each trimmed) as truthy; everything else — including {@code null},
     * empty, {@code "0"}, {@code "false"}, {@code "yes"}, garbage — is falsy.
     * The vocabulary is deliberately narrow: Spring and the broader Java
     * ecosystem canonicalize on {@code true}/{@code false}, so accepting
     * shell-idiomatic variants like {@code "yes"} would be non-standard here.
     * Package-private for test coverage.
     */
    static boolean isTruthy(String raw) {
        if (raw == null) {
            return false;
        }
        String normalized = raw.trim().toLowerCase(java.util.Locale.ROOT);
        return normalized.equals("1") || normalized.equals("true");
    }

    @Bean
    public WebClientCustomizer http11WebClientCustomizer() {
        // Defensive runtime check. See class Javadoc + entrypoint.sh for the
        // authoritative rationale. COPILOTKIT_ALLOW_KEEPALIVE is the
        // operator opt-out.
        String observed = System.getProperty(KEEPALIVE_PROPERTY);
        if (!ZERO.equals(observed)) {
            boolean optedIn = isTruthy(System.getenv(ALLOW_KEEPALIVE_ENV));
            if (optedIn) {
                log.warn(
                        "[WebClientConfig] At bean construction time, {}={} (expected '0') — but {} is set, honoring operator opt-in. " +
                        "Note: keep-alive reuse can trigger 'Connection reset' against aimock/Prism upstreams.",
                        KEEPALIVE_PROPERTY, observed, ALLOW_KEEPALIVE_ENV);
            } else {
                throw new IllegalStateException(
                        "[WebClientConfig] At bean construction time, " + KEEPALIVE_PROPERTY + "=" + observed +
                        " (expected '0'). The JVM arg -D" + KEEPALIVE_PROPERTY + "=0 (set in entrypoint.sh) must land " +
                        "before any java.net.http.HttpClient is constructed — if it didn't, pooled half-closed sockets " +
                        "WILL cause 'Connection reset' against aimock/Prism streams. " +
                        "Refusing to start: verify entrypoint.sh passes -D" + KEEPALIVE_PROPERTY + "=0, and that no earlier " +
                        "class-init path constructed an HttpClient before this bean ran. To bypass this check (e.g. because " +
                        "your upstream does not half-close sockets), set " + ALLOW_KEEPALIVE_ENV + "=1."
                );
            }
        }

        HttpClient jdkClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .build();
        JdkClientHttpConnector connector = new JdkClientHttpConnector(jdkClient);
        return builder -> builder.clientConnector(connector);
    }
}
