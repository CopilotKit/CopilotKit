package com.copilotkit.showcase.springai;

import org.slf4j.Logger;

import java.util.Map;

/**
 * Cross-language header-forwarding diagnostic ("CVDIAG") instrumentation helper.
 *
 * <p>Emits a single-line, machine-greppable breadcrumb at the inbound capture
 * boundary and the outbound-LLM boundary so that a request's
 * {@code x-aimock-context} / {@code x-diag-run-id} / {@code x-diag-hops}
 * correlation headers can be traced as they cross the
 * {@link AimockHeaderContext} {@link InheritableThreadLocal} handoff (Tomcat
 * request thread -> {@code ForkJoinPool} worker). The line format is shared
 * verbatim with the other language integrations so logs join on
 * {@code run_id}.
 *
 * <p><b>Instrumentation only.</b> This class never alters request behavior; it
 * reads the already-captured header map and (for the outbound hop tag) returns
 * a new {@code x-diag-hops} value the caller appends to the outbound request.
 * Full header values are never logged — only a 12-char prefix.
 *
 * <p>Canonical line shape:
 * <pre>
 * CVDIAG component=&lt;name&gt; boundary=&lt;inbound|outbound-llm&gt; run_id=&lt;...&gt; slug=&lt;...&gt;
 *        header_present=&lt;true|false&gt; header_value_prefix=&lt;first 12 chars&gt;
 *        hop=&lt;int|-&gt; status=&lt;ok|miss|error&gt; test_id=&lt;...&gt; error=&lt;short&gt;
 * </pre>
 */
public final class CvDiag {

    /** Correlation header carrying the aimock fixture slug. */
    static final String HEADER_AIMOCK_CONTEXT = "x-aimock-context";
    /** Correlation header carrying the per-run diagnostic id. */
    static final String HEADER_DIAG_RUN_ID = "x-diag-run-id";
    /** Comma-joined breadcrumb each layer appends its hop tag to. */
    static final String HEADER_DIAG_HOPS = "x-diag-hops";
    /** Correlation header carrying the test id. */
    static final String HEADER_TEST_ID = "x-test-id";

    private CvDiag() {
        // utility class
    }

    /**
     * Logs the CVDIAG breadcrumb for the inbound capture boundary, where
     * {@code headers} has just been read off the request and stored into the
     * thread-local context.
     */
    static void logInbound(Logger log, String component, Map<String, String> headers) {
        log.info(line(component, "inbound", headers, "-", status(headers)));
    }

    /**
     * Logs the CVDIAG breadcrumb for the outbound-LLM boundary, where
     * {@code headers} is the thread-local context about to be forwarded onto
     * the LLM request. {@code hop} is this layer's position in the breadcrumb
     * (the number of tags now present on {@code x-diag-hops}).
     */
    static void logOutbound(Logger log, String component, Map<String, String> headers, int hop) {
        log.info(line(component, "outbound-llm", headers, Integer.toString(hop), status(headers)));
    }

    /**
     * Returns the new value for {@code x-diag-hops} after appending this
     * layer's {@code tag}, given the current (possibly absent) breadcrumb.
     * Never logs; pure string join. Returns {@code tag} if no prior breadcrumb.
     */
    static String appendHop(String existingHops, String tag) {
        if (existingHops == null || existingHops.isBlank()) {
            return tag;
        }
        return existingHops + "," + tag;
    }

    /**
     * Number of hops now present on {@code x-diag-hops} after this layer
     * appends, i.e. (count of existing comma-separated tags) + 1.
     */
    static int hopCount(String existingHops) {
        if (existingHops == null || existingHops.isBlank()) {
            return 1;
        }
        return existingHops.split(",").length + 1;
    }

    private static String status(Map<String, String> headers) {
        return present(headers, HEADER_AIMOCK_CONTEXT) ? "ok" : "miss";
    }

    private static boolean present(Map<String, String> headers, String key) {
        String v = headers == null ? null : headers.get(key);
        return v != null && !v.isEmpty();
    }

    private static String valueOr(Map<String, String> headers, String key, String fallback) {
        String v = headers == null ? null : headers.get(key);
        return (v == null || v.isEmpty()) ? fallback : v;
    }

    private static String prefix(Map<String, String> headers, String key) {
        String v = headers == null ? null : headers.get(key);
        if (v == null || v.isEmpty()) {
            return "";
        }
        return v.length() <= 12 ? v : v.substring(0, 12);
    }

    private static String line(String component, String boundary, Map<String, String> headers,
                               String hop, String status) {
        boolean present = present(headers, HEADER_AIMOCK_CONTEXT);
        return "CVDIAG"
                + " component=" + component
                + " boundary=" + boundary
                + " run_id=" + valueOr(headers, HEADER_DIAG_RUN_ID, "none")
                + " slug=" + valueOr(headers, HEADER_AIMOCK_CONTEXT, "MISSING")
                + " header_present=" + present
                + " header_value_prefix=" + prefix(headers, HEADER_AIMOCK_CONTEXT)
                + " hop=" + hop
                + " status=" + status
                + " test_id=" + valueOr(headers, HEADER_TEST_ID, "none")
                + " error=";
    }
}
