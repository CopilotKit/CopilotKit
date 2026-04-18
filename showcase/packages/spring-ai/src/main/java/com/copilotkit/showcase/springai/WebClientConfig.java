package com.copilotkit.showcase.springai;

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
 * The property must be set statically (before any JDK HttpClient is
 * instantiated), so we do it in a {@code static} initializer which Spring
 * invokes when loading this {@link Configuration}.
 */
@Configuration
public class WebClientConfig {

    static {
        // Must be set before the first java.net.http.HttpClient is built.
        // Value is in seconds; 0 disables connection keep-alive entirely.
        if (System.getProperty("jdk.httpclient.keepalive.timeout") == null) {
            System.setProperty("jdk.httpclient.keepalive.timeout", "0");
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
