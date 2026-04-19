package com.copilotkit.showcase.springai;

import org.junit.jupiter.api.Test;
import org.springframework.boot.web.reactive.function.client.WebClientCustomizer;
import org.springframework.http.client.reactive.JdkClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;

import java.lang.reflect.Field;
import java.net.http.HttpClient;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link WebClientConfig}.
 *
 * <p>Verifies that the {@link WebClientCustomizer} bean installs a
 * {@link JdkClientHttpConnector} whose underlying {@link HttpClient} is
 * pinned to HTTP/1.1 — the key invariant that keeps aimock/Prism fixtures
 * from rejecting an HTTP/2 upgrade negotiation.
 *
 * <p>Also exercises the pure {@link WebClientConfig#applyKeepaliveDecision}
 * function that backs the static initializer's keep-alive override logic.
 * The static block itself is untestable in-process (classes initialize once
 * per classloader) — extracting the decision into a pure function is the
 * ergonomic workaround.
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

    // ------------------------------------------------------------------
    // applyKeepaliveDecision pure-function tests.
    // ------------------------------------------------------------------

    @Test
    void keepaliveDecision_unsetProperty_defaultsToZero() {
        Optional<String> result = WebClientConfig.applyKeepaliveDecision(null, null);
        assertThat(result).contains(WebClientConfig.ZERO);
    }

    @Test
    void keepaliveDecision_alreadyZero_leavesAlone() {
        Optional<String> result = WebClientConfig.applyKeepaliveDecision("0", null);
        assertThat(result).isEmpty();
    }

    @Test
    void keepaliveDecision_zeroWithWhitespace_leavesAlone() {
        // Trim-tolerance: "0 " shouldn't trigger an override.
        Optional<String> result = WebClientConfig.applyKeepaliveDecision("0 ", null);
        assertThat(result).isEmpty();
    }

    @Test
    void keepaliveDecision_nonZeroUserValueWithoutOptIn_forceOverridesToZero() {
        Optional<String> result = WebClientConfig.applyKeepaliveDecision("60", null);
        assertThat(result).contains(WebClientConfig.ZERO);
    }

    @Test
    void keepaliveDecision_nonZeroUserValueWithAllowKeepaliveOptIn_leavesAlone() {
        // Operator has explicitly opted in via COPILOTKIT_ALLOW_KEEPALIVE=1.
        Optional<String> result = WebClientConfig.applyKeepaliveDecision("60", "1");
        assertThat(result).isEmpty();
    }

    @Test
    void keepaliveDecision_nonZeroUserValueWithArbitraryOptInString_doesNotCountAsOptIn() {
        // Only the literal "1" opts in — "true", "yes", etc. do NOT.
        Optional<String> result = WebClientConfig.applyKeepaliveDecision("60", "true");
        assertThat(result).contains(WebClientConfig.ZERO);
    }
}
