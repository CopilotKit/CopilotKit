package com.copilotkit.showcase.springai.cvdiag;

import java.util.regex.Pattern;

/**
 * PII / secret scrubber for CVDIAG metadata string values (spec §6).
 *
 * <p>Java mirror of the canonical TS {@code scrubSecrets} in
 * {@code showcase/harness/src/cvdiag/edge-headers.ts}: redacts {@code Bearer
 * <token>}, OpenAI-style {@code sk-…} keys (≥16 trailing chars), and URL
 * userinfo segments ({@code scheme://user:password@}) anywhere in a captured
 * value. Applied to {@code backend.error.caught.message_scrubbed} before the
 * envelope leaves the process (R6-F3: a synthetic {@code sk-test-12345} in an
 * exception message MUST NOT be retained).
 *
 * <p><b>Instrumentation only.</b> Never throws; a {@code null} input returns
 * {@code null}.
 */
public final class MessageScrubber {

    /** {@code Bearer <token>} anywhere in a captured value. */
    private static final Pattern BEARER_TOKEN = Pattern.compile("Bearer\\s+\\S+");
    /** OpenAI-style secret keys {@code sk-…} (≥16 trailing chars). */
    private static final Pattern SK_KEY = Pattern.compile("sk-[A-Za-z0-9]{16,}");
    /** URL userinfo segment {@code scheme://user:password@}. */
    private static final Pattern URL_USERINFO =
            Pattern.compile("([a-z][a-z0-9+.-]*://)[^/@\\s:]+:[^/@\\s]+@",
                    Pattern.CASE_INSENSITIVE);

    /** Replacement token written in place of a scrubbed secret. */
    public static final String REPLACEMENT = "[REDACTED]";

    private MessageScrubber() {
        // utility class
    }

    /**
     * Scrub the known secret patterns from {@code value}. Returns {@code null}
     * when {@code value} is {@code null}; otherwise the scrubbed string. The
     * {@code sk-} pass runs after the {@code Bearer} pass so a {@code Bearer
     * sk-…} pair collapses to a single {@code [REDACTED]}.
     */
    public static String scrub(String value) {
        if (value == null) {
            return null;
        }
        String result = BEARER_TOKEN.matcher(value).replaceAll(REPLACEMENT);
        result = SK_KEY.matcher(result).replaceAll(REPLACEMENT);
        result = URL_USERINFO.matcher(result).replaceAll("$1" + REPLACEMENT + "@");
        return result;
    }
}
