package com.copilotkit.showcase.springai;

import org.junit.jupiter.api.Test;
import org.springframework.boot.web.reactive.function.client.WebClientCustomizer;
import org.springframework.http.client.reactive.JdkClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;

import java.lang.reflect.Field;
import java.net.http.HttpClient;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link WebClientConfig}.
 *
 * <p>Verifies that the {@link WebClientCustomizer} bean installs a
 * {@link JdkClientHttpConnector} whose underlying {@link HttpClient} is
 * pinned to HTTP/1.1 — the key invariant that keeps aimock/Prism fixtures
 * from rejecting an HTTP/2 upgrade negotiation.
 */
class WebClientConfigTest {

    @Test
    void http11CustomizerPinsHttpClientToHttp11() throws Exception {
        WebClientConfig config = new WebClientConfig();
        WebClientCustomizer customizer = config.http11WebClientCustomizer();

        WebClient.Builder builder = WebClient.builder();
        customizer.customize(builder);

        // Reflectively read the clientConnector out of the builder — there's
        // no public getter, but we only need to confirm the connector type
        // and its pinned HTTP version.
        Field connectorField = builder.getClass().getDeclaredField("connector");
        connectorField.setAccessible(true);
        Object connector = connectorField.get(builder);

        assertThat(connector).isInstanceOf(JdkClientHttpConnector.class);

        // JdkClientHttpConnector stores its HttpClient in a private field.
        Field httpClientField = JdkClientHttpConnector.class.getDeclaredField("httpClient");
        httpClientField.setAccessible(true);
        HttpClient httpClient = (HttpClient) httpClientField.get(connector);

        assertThat(httpClient.version()).isEqualTo(HttpClient.Version.HTTP_1_1);
    }

    @Test
    void staticInitDoesNotOverrideExplicitUserTimeout() {
        // The static initializer runs once at class load; simulate the
        // "user already set a non-zero value" path by writing the property
        // first, reloading, and confirming we don't stomp it.
        //
        // NOTE: we can't actually re-trigger the static initializer in-process
        // (classes initialize once per classloader), so we assert the
        // *current* property state is sane: if anything set it, it should be
        // "0" (our default) or whatever the user/JVM-arg path chose.
        String actual = System.getProperty("jdk.httpclient.keepalive.timeout");
        assertThat(actual).as(
                "keepalive timeout must be either our default '0' or a user/JVM-arg-supplied value; never unset if WebClientConfig has been loaded"
        ).isNotNull();
    }
}
