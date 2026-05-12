package com.copilotkit.showcase.springai;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;

/**
 * Extracts {@code x-*} prefixed headers from incoming HTTP requests and stores
 * them in {@link AimockHeaderContext} so outbound LLM calls can forward them.
 *
 * <p>Registered via {@link AimockWebMvcConfig#addInterceptors}.
 */
@Component
public class AimockHeaderInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) {
        Map<String, String> headers = new HashMap<>();
        Enumeration<String> headerNames = request.getHeaderNames();
        if (headerNames != null) {
            while (headerNames.hasMoreElements()) {
                String name = headerNames.nextElement();
                if (name.toLowerCase(java.util.Locale.ROOT).startsWith("x-")) {
                    headers.put(name, request.getHeader(name));
                }
            }
        }
        AimockHeaderContext.set(headers);  // Always set, even when empty — clears stale state
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request,
                                HttpServletResponse response,
                                Object handler,
                                Exception ex) {
        AimockHeaderContext.clear();
    }
}
