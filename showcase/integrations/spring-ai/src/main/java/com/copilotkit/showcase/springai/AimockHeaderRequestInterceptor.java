package com.copilotkit.showcase.springai;

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

    @Override
    public ClientHttpResponse intercept(HttpRequest request,
                                        byte[] body,
                                        ClientHttpRequestExecution execution)
            throws IOException {
        Map<String, String> headers = AimockHeaderContext.get();
        if (!headers.isEmpty()) {
            headers.forEach((key, value) -> request.getHeaders().set(key, value));
        }
        return execution.execute(request, body);
    }
}
