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
 * <p>Spring-AI 1.0.1 builds its OpenAI {@code WebClient} from the auto-configured
 * {@code WebClient.Builder}. Without reactor-netty on the classpath, that builder
 * defaults to {@link JdkClientHttpConnector} with a {@link HttpClient} whose
 * {@code Version} is unset — so the client advertises {@code Upgrade: h2c} on
 * every cleartext HTTP/1.1 request. Some HTTP fixtures (e.g. aimock) reject the
 * upgrade negotiation with 404, breaking chat + tool calls even though the
 * underlying endpoint is reachable by curl. Pinning to HTTP/1.1 drops the
 * {@code Connection: Upgrade, HTTP2-Settings} + {@code Upgrade: h2c} headers
 * and restores compatibility (TLS paths use ALPN so real OpenAI still
 * negotiates HTTP/2 when supported).
 *
 * <p>On top of that, the JDK HttpClient pools connections by default. When the
 * first streaming SSE response finishes, the pooled socket can be half-closed
 * by the upstream (Prism/aimock do this between fixtures), but the client
 * will happily reuse it for the follow-up tool-result request and trip over
 * {@code Connection reset}. Setting {@code jdk.httpclient.keepalive.timeout=0}
 * before the first HttpClient is created forces a fresh connection per request.
 *
 * <p><b>JVM-arg authority note:</b> static initializer ordering across Spring
 * {@code @Configuration} classes is fragile. If the JVM arg path is ever
 * dropped AND this class happens to load after a {@link HttpClient} has
 * already been constructed elsewhere, keepalive will silently stay pooled —
 * the static block writes a property that's already been read. The
 * {@code @Bean} method below therefore re-checks the property at bean
 * construction time and logs an ERROR if it wasn't set to {@code "0"} by
 * then — that's the authoritative signal that the operator config is broken.
 *
 * <p><b>Authoritative path:</b> {@code entrypoint.sh} passes
 * {@code -Djdk.httpclient.keepalive.timeout=0} as a JVM arg, which guarantees
 * the property is set before any class — including this one — is loaded. The
 * static initializer below is a defensive belt-and-suspenders fallback for
 * direct {@code java -jar agent.jar} invocations (e.g. IDE debugging or
 * Maven failsafe) where {@code entrypoint.sh} isn't in play. Because static
 * initializer ordering across Spring {@code @Configuration} classes is
 * fragile (this class may be loaded <em>after</em> the first {@link HttpClient}
 * is constructed elsewhere), always prefer the JVM-arg path in production.
 *
 * <p><b>Operator-hostile configuration:</b> a user-supplied non-zero
 * {@code jdk.httpclient.keepalive.timeout} re-enables connection pooling and
 * resurrects the half-closed-socket bug. By default we force-override it back
 * to {@code 0} with a prominent {@code ERROR} log. To opt out of the override
 * (e.g. for a deployment that has verified its upstream doesn't half-close
 * sockets), set {@code COPILOTKIT_ALLOW_KEEPALIVE} to any of
 * {@code "1"} / {@code "true"} / {@code "yes"} (case-insensitive — common
 * operator conventions are all accepted), at which point we warn loudly and
 * honor the operator's choice.
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
     *                          {@code null} if unset. Any of the strings
     *                          {@code "1"} / {@code "true"} / {@code "yes"}
     *                          (case-insensitive, after trimming) opts in to
     *                          honoring a non-zero user value. Other values
     *                          (including {@code "0"}, {@code "false"},
     *                          garbage) do NOT opt in.
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
                "[WebClientConfig] {}='{}' is non-zero and {} is not a recognized opt-in value (accepted: 1/true/yes, case-insensitive); force-overriding to 0 to prevent 'Connection reset' against half-closed upstream sockets. Set {}=1 (or true/yes) to opt out of the override.",
                KEEPALIVE_PROPERTY, existing, ALLOW_KEEPALIVE_ENV, ALLOW_KEEPALIVE_ENV);
        return Optional.of(ZERO);
    }

    /**
     * Case-insensitive truthiness check. Accepts {@code "1"}, {@code "true"},
     * {@code "yes"} (each trimmed) as truthy; everything else — including
     * {@code null}, empty, {@code "0"}, {@code "false"}, garbage — is falsy.
     * Package-private for test coverage.
     */
    static boolean isTruthy(String raw) {
        if (raw == null) {
            return false;
        }
        String normalized = raw.trim().toLowerCase(java.util.Locale.ROOT);
        return normalized.equals("1") || normalized.equals("true") || normalized.equals("yes");
    }

    @Bean
    public WebClientCustomizer http11WebClientCustomizer() {
        // Defensive runtime check: by bean construction time, the JVM arg path
        // (`-Djdk.httpclient.keepalive.timeout=0` in entrypoint.sh) should
        // have rendered the property "0". If it's anything else, either:
        //   (a) the JVM arg was dropped from entrypoint.sh, OR
        //   (b) this class loaded AFTER an HttpClient was already constructed
        //       elsewhere — in which case our static block's setProperty
        //       would have had no effect on that pre-existing client's pool.
        // Either way it's an operator-visible misconfiguration that silently
        // resurrects the half-closed-socket bug. Emit an ERROR so the issue
        // surfaces in the container logs instead of as mysterious downstream
        // `Connection reset` failures.
        String observed = System.getProperty(KEEPALIVE_PROPERTY);
        if (!ZERO.equals(observed)) {
            log.error(
                    "[WebClientConfig] At bean construction time, {}={} (expected '0'). " +
                    "The JVM arg -D{}=0 (set in entrypoint.sh) must land before any java.net.http.HttpClient is constructed — " +
                    "if it didn't, pooled half-closed sockets WILL cause 'Connection reset' against aimock/Prism streams. " +
                    "Verify entrypoint.sh passes -D{}=0, and that no earlier class-init path constructed an HttpClient before this bean ran.",
                    KEEPALIVE_PROPERTY, observed, KEEPALIVE_PROPERTY, KEEPALIVE_PROPERTY);
        }

        HttpClient jdkClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .build();
        JdkClientHttpConnector connector = new JdkClientHttpConnector(jdkClient);
        return builder -> builder.clientConnector(connector);
    }
}
