package com.copilotkit.showcase.springai;

import com.copilotkit.showcase.springai.cvdiag.CvdiagBackend;
import com.copilotkit.showcase.springai.cvdiag.CvdiagRunContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
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
 *
 * <p>Also the CVDIAG {@code backend.request.ingress} boundary (plan unit L1-G):
 * when backend emission is enabled (bean present), a per-request
 * {@link CvdiagBackend.CvdiagRun} is minted here for {@code POST} agent traffic
 * and bound to {@link CvdiagRunContext} so the agent body and the error advice
 * can emit the remaining backend boundaries against the same {@code test_id}.
 */
@Component
public class AimockHeaderInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(AimockHeaderInterceptor.class);

    /** Null when {@code cvdiag.backend.emitter} is not {@code on} (default OFF). */
    private final CvdiagBackend cvdiagBackend;

    @Autowired
    public AimockHeaderInterceptor(@Autowired(required = false) CvdiagBackend cvdiagBackend) {
        this.cvdiagBackend = cvdiagBackend;
    }

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
        // CVDIAG inbound breadcrumb: the x-* headers (incl. x-diag-run-id /
        // x-diag-hops / x-aimock-context) have now been captured into the
        // InheritableThreadLocal on this Tomcat request thread.
        CvDiag.logInbound(log, "backend-spring-ai", AimockHeaderContext.get());

        // CVDIAG backend.request.ingress: mint the per-request run for agent
        // POSTs (skip GET health/ok probes) and bind it for downstream emit.
        if (cvdiagBackend != null && "POST".equalsIgnoreCase(request.getMethod())) {
            Map<String, String> allHeaders = new HashMap<>();
            Enumeration<String> names = request.getHeaderNames();
            if (names != null) {
                while (names.hasMoreElements()) {
                    String name = names.nextElement();
                    allHeaders.put(name, request.getHeader(name));
                }
            }
            long contentLength = request.getContentLengthLong();
            CvdiagBackend.CvdiagRun run = cvdiagBackend.beginRun(
                    allHeaders, request.getMethod(), request.getRequestURI(),
                    contentLength >= 0 ? contentLength : null);
            CvdiagRunContext.set(run);
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request,
                                HttpServletResponse response,
                                Object handler,
                                Exception ex) {
        // CVDIAG backend.response.complete: the HTTP response stream is closed.
        // For the SSE agent path the body streams asynchronously, but this is
        // the deterministic request-completion boundary the servlet container
        // gives us; emit it with the final status + egress edge headers.
        CvdiagBackend.CvdiagRun run = CvdiagRunContext.get();
        if (run != null) {
            // The servlet response exposes no readable content-length getter;
            // the streamed SSE body length is not knowable here, so pass null
            // (closed-world keeps the optional field absent).
            run.responseComplete(response.getStatus(), null);
        }
        AimockHeaderContext.clear();
        CvdiagRunContext.clear();
    }
}
