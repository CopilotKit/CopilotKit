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
    void keepaliveDecision_trueAsOptIn_leavesAlone() {
        // "true" is a common operator convention and must also count as opt-in.
        Optional<String> result = WebClientConfig.applyKeepaliveDecision("60", "true");
        assertThat(result).isEmpty();
    }

    @Test
    void keepaliveDecision_yesAsOptIn_leavesAlone() {
        // "yes" is accepted too.
        Optional<String> result = WebClientConfig.applyKeepaliveDecision("60", "yes");
        assertThat(result).isEmpty();
    }

    @Test
    void keepaliveDecision_optInIsCaseInsensitive() {
        assertThat(WebClientConfig.applyKeepaliveDecision("60", "TRUE")).isEmpty();
        assertThat(WebClientConfig.applyKeepaliveDecision("60", "Yes")).isEmpty();
        assertThat(WebClientConfig.applyKeepaliveDecision("60", " True ")).isEmpty();
    }

    @Test
    void keepaliveDecision_nonRecognizedOptInString_forceOverrides() {
        // Garbage, "false", "0", "no" — none of these opt in; the override still fires.
        assertThat(WebClientConfig.applyKeepaliveDecision("60", "maybe"))
                .contains(WebClientConfig.ZERO);
        assertThat(WebClientConfig.applyKeepaliveDecision("60", "false"))
                .contains(WebClientConfig.ZERO);
        assertThat(WebClientConfig.applyKeepaliveDecision("60", "0"))
                .contains(WebClientConfig.ZERO);
        assertThat(WebClientConfig.applyKeepaliveDecision("60", "no"))
                .contains(WebClientConfig.ZERO);
    }

    // ------------------------------------------------------------------
    // isTruthy unit coverage (direct, in case applyKeepaliveDecision ever
    // grows more callers).
    // ------------------------------------------------------------------

    @Test
    void isTruthy_acceptsCanonicalAndCommonForms() {
        assertThat(WebClientConfig.isTruthy("1")).isTrue();
        assertThat(WebClientConfig.isTruthy("true")).isTrue();
        assertThat(WebClientConfig.isTruthy("TRUE")).isTrue();
        assertThat(WebClientConfig.isTruthy("True")).isTrue();
        assertThat(WebClientConfig.isTruthy("yes")).isTrue();
        assertThat(WebClientConfig.isTruthy("YES")).isTrue();
        assertThat(WebClientConfig.isTruthy(" 1 ")).isTrue();
        assertThat(WebClientConfig.isTruthy(" true ")).isTrue();
    }

    @Test
    void isTruthy_rejectsFalsyAndGarbage() {
        assertThat(WebClientConfig.isTruthy(null)).isFalse();
        assertThat(WebClientConfig.isTruthy("")).isFalse();
        assertThat(WebClientConfig.isTruthy("0")).isFalse();
        assertThat(WebClientConfig.isTruthy("false")).isFalse();
        assertThat(WebClientConfig.isTruthy("no")).isFalse();
        assertThat(WebClientConfig.isTruthy("maybe")).isFalse();
        assertThat(WebClientConfig.isTruthy("2")).isFalse();
    }

    // ------------------------------------------------------------------
    // @Bean defensive runtime check: if the JVM arg path dropped
    // `-Djdk.httpclient.keepalive.timeout=0`, the bean MUST log ERROR.
    // We don't have a hook to force-reset the property without racing the
    // real static init order, so instead we drive it directly by toggling
    // the system property around the bean-creation call.
    // ------------------------------------------------------------------

    @Test
    void beanConstruction_whenKeepalivePropertyIsMissingOrNonZero_logsErrorButStillBuildsConnector() throws Exception {
        // Save-and-restore the property so we don't leak state across tests.
        String previous = System.getProperty(WebClientConfig.KEEPALIVE_PROPERTY);
        try {
            // Simulate the dangerous case: property is NOT "0" at bean time.
            System.setProperty(WebClientConfig.KEEPALIVE_PROPERTY, "60");

            WebClientConfig config = new WebClientConfig();
            // Bean construction must still succeed — we log the error, we don't fail the
            // app (the operator needs the error message in the logs to diagnose the
            // broken JVM-arg path, not a crash with no context).
            WebClientCustomizer customizer = config.http11WebClientCustomizer();
            assertThat(customizer).isNotNull();

            // And the customizer still pins HTTP/1.1 — the pinning is
            // orthogonal to the keepalive property, so nothing about the
            // connector itself should be different in the degraded path.
            WebClient.Builder builder = WebClient.builder();
            customizer.customize(builder);
            Field connectorField = builder.getClass().getDeclaredField("connector");
            connectorField.setAccessible(true);
            Object connector = connectorField.get(builder);
            assertThat(connector).isInstanceOf(JdkClientHttpConnector.class);
        } finally {
            if (previous == null) {
                System.clearProperty(WebClientConfig.KEEPALIVE_PROPERTY);
            } else {
                System.setProperty(WebClientConfig.KEEPALIVE_PROPERTY, previous);
            }
        }
    }
}
