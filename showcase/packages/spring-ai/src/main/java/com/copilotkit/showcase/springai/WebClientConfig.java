package com.copilotkit.showcase.springai;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.reactive.function.client.WebClientCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.JdkClientHttpConnector;

import java.net.http.HttpClient;

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
 * <p><b>Authoritative path:</b> {@code entrypoint.sh} passes
 * {@code -Djdk.httpclient.keepalive.timeout=0} as a JVM arg, which guarantees
 * the property is set before any class — including this one — is loaded. The
 * static initializer below is a defensive belt-and-suspenders fallback for
 * direct {@code java -jar agent.jar} invocations (e.g. IDE debugging or
 * Maven failsafe) where {@code entrypoint.sh} isn't in play. Because static
 * initializer ordering across Spring {@code @Configuration} classes is
 * fragile (this class may be loaded *after* the first {@link HttpClient} is
 * constructed elsewhere), always prefer the JVM-arg path in production.
 */
@Configuration
public class WebClientConfig {

    private static final Logger log = LoggerFactory.getLogger(WebClientConfig.class);

    static {
        // Must be set before the first java.net.http.HttpClient is built.
        // Value is in seconds; 0 disables connection keep-alive entirely.
        String existing = System.getProperty("jdk.httpclient.keepalive.timeout");
        if (existing == null) {
            System.setProperty("jdk.httpclient.keepalive.timeout", "0");
        } else if (!"0".equals(existing.trim())) {
            // Respect the user's override but warn loudly — a non-zero value
            // re-enables keep-alive and can resurrect the half-closed-socket
            // bug the JVM-arg + static-init pair is meant to prevent.
            log.warn(
                    "jdk.httpclient.keepalive.timeout is already set to '{}' (non-zero); leaving it alone, but note that keep-alive reuse can trigger 'Connection reset' against aimock/Prism upstreams. Set it to 0 to disable pooling.",
                    existing);
        }
    }

    @Bean
    public WebClientCustomizer http11WebClientCustomizer() {
        HttpClient jdkClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .build();
        JdkClientHttpConnector connector = new JdkClientHttpConnector(jdkClient);
        return builder -> builder.clientConnector(connector);
    }
}
