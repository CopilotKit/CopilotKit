package com.copilotkit.showcase.springai;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Map;

/**
 * Injects {@code x-*} prefixed headers (from {@link AimockHeaderContext}) into
 * outgoing HTTP requests made through Spring's {@code RestClient}.
 *
 * <p>This covers Spring AI's synchronous {@code .call()} path
 * ({@code OpenAiChatModel.internalCall -> OpenAiApi.chatCompletionEntity ->
 * RestClient}). The reactive {@code WebClient} path ({@code .stream()}) is
 * handled by a parallel {@code ExchangeFilterFunction} in
 * {@link WebClientConfig}.
 *
 * <p>Registered via {@link WebClientConfig#connectionCloseRestClientCustomizer}.
 */
@Component
public class AimockHeaderRequestInterceptor implements ClientHttpRequestInterceptor {

    private static final Logger log = LoggerFactory.getLogger(AimockHeaderRequestInterceptor.class);

    @Override
    public ClientHttpResponse intercept(HttpRequest request,
                                        byte[] body,
                                        ClientHttpRequestExecution execution)
            throws IOException {
        Map<String, String> headers = AimockHeaderContext.get();
        if (!headers.isEmpty()) {
            headers.forEach((key, value) -> request.getHeaders().set(key, value));
        }
        // GATING RULE: only deviate from original control flow (append the
        // x-diag-hops breadcrumb, emit the per-outbound CVDIAG log) when a
        // diagnostic header is actually present. On non-diagnostic traffic the
        // outbound request stays byte-identical to pre-instrumentation behavior
        // (the inbound x-* forward loop above is original behavior). Mirrors the
        // reactive .stream() gate in WebClientConfig.
        boolean diagnosticPresent = headers.containsKey(CvDiag.HEADER_DIAG_RUN_ID)
                || headers.containsKey(CvDiag.HEADER_AIMOCK_CONTEXT);
        if (diagnosticPresent) {
            // CVDIAG: append this layer's hop tag to the x-diag-hops breadcrumb
            // on the outbound LLM call, then log the outbound boundary. The
            // threadlocal already carried x-diag-run-id / x-diag-hops the same
            // way as x-aimock-context across the ForkJoinPool handoff.
            String newHops = CvDiag.appendHop(headers.get(CvDiag.HEADER_DIAG_HOPS), "backend-spring-ai");
            request.getHeaders().set(CvDiag.HEADER_DIAG_HOPS, newHops);
            CvDiag.logOutbound(log, "backend-spring-ai", headers, CvDiag.hopCount(headers.get(CvDiag.HEADER_DIAG_HOPS)));
        }
        return execution.execute(request, body);
    }
}
