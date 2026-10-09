package com.copilotkit.showcase.springai.cvdiag;

import java.util.regex.Pattern;

/**
 * PII / secret scrubber for CVDIAG metadata string values (spec §6).
 *
 * <p>Java mirror of the canonical TS {@code scrubSecrets} in
 * {@code showcase/harness/src/cvdiag/scrub.ts}: redacts {@code Bearer
 * <token>}, {@code sk-…} secret keys (including modern base64url bodies with
 * {@code _}/{@code -} tails, e.g. {@code sk-ant-api03-…}), and URL userinfo
 * segments — both {@code scheme://user:password@} AND colon-less
 * {@code scheme://token@host} — anywhere in a captured value. Applied to
 * {@code backend.error.caught.message_scrubbed} before the envelope leaves the
 * process (R6-F3: a synthetic {@code sk-test-12345} in an exception message
 * MUST NOT be retained).
 *
 * <p><b>Instrumentation only.</b> Never throws; a {@code null} input returns
 * {@code null}.
 */
public final class MessageScrubber {

    /** {@code Bearer <token>} anywhere in a captured value (whole token). */
    private static final Pattern BEARER_TOKEN = Pattern.compile("Bearer\\s+\\S+");
    /**
     * {@code sk-…} secret keys, including modern base64url bodies (the alphabet
     * includes {@code _} and {@code -}, and the entropy tail can sit AFTER a
     * hyphen segment — e.g. {@code sk-ant-api03-AbCd_Ef-0123456789xyzAB} — which
     * the legacy {@code sk-[A-Za-z0-9]{16,}} could not span). Mirrors
     * {@code SK_KEY_REGEX}: {@code sk-} then up to 200 base64url chars, a 12-char
     * contiguous alphanumeric entropy run, then up to 200 more base64url chars.
     * Every quantifier is bounded with no overlapping-unbounded pair → linear,
     * no catastrophic backtracking.
     */
    private static final Pattern SK_KEY =
            Pattern.compile("sk-[A-Za-z0-9_-]{0,200}[A-Za-z0-9]{12}[A-Za-z0-9_-]{0,200}");
    /**
     * URL userinfo authority segment: redacts userinfo between {@code scheme://}
     * and the last authority {@code @}, covering {@code scheme://user:password@},
     * bare-token {@code scheme://token@host} (no colon), and multi-{@code @}
     * authorities. Mirrors {@code URL_USERINFO_REGEX}; the userinfo class
     * {@code [^/\s?#]*} never crosses into the path/query/fragment.
     */
    private static final Pattern URL_USERINFO =
            Pattern.compile("([a-z][a-z0-9+.-]*://)[^/\\s?#]*@",
                    Pattern.CASE_INSENSITIVE);

    /** Replacement token written in place of a scrubbed secret. */
    public static final String REPLACEMENT = "[REDACTED]";

    /**
     * Hard input-size guard mirroring {@code SCRUB_MAX_SCAN_LEN} (2 KB): no regex
     * ever runs on a string longer than this. Anything larger has only its
     * bounded prefix scanned, with a self-describing {@code …[unscanned:<N>]}
     * marker (a char count) recording the dropped tail length. With a bounded
     * input and the three linear regexes above, ReDoS is impossible by
     * construction.
     */
    public static final int MAX_SCAN_LEN = 2 * 1024;

    private MessageScrubber() {
        // utility class
    }

    /**
     * Scrub the known secret patterns from {@code value}. Returns {@code null}
     * when {@code value} is {@code null}; otherwise the scrubbed string. The
     * {@code sk-} pass runs after the {@code Bearer} pass so a {@code Bearer
     * sk-…} pair collapses to a single {@code [REDACTED]}.
     *
     * <p>Mirrors {@code scrubSecrets}' size guard: a value longer than
     * {@code MAX_SCAN_LEN} never reaches a regex — only the bounded prefix is
     * scanned, and a {@code …[unscanned:<N>]} marker (appended AFTER scrubbing
     * so it can never be mistaken for scrubbed content) records the dropped tail
     * char count.
     */
    public static String scrub(String value) {
        if (value == null) {
            return null;
        }
        if (value.length() > MAX_SCAN_LEN) {
            int droppedTail = value.length() - MAX_SCAN_LEN;
            String scanned = value.substring(0, MAX_SCAN_LEN);
            return runScrubRegexes(scanned) + "…[unscanned:" + droppedTail + "]";
        }
        return runScrubRegexes(value);
    }

    /** The three linear-time secret regexes, applied in sequence. */
    private static String runScrubRegexes(String value) {
        String result = BEARER_TOKEN.matcher(value).replaceAll(REPLACEMENT);
        result = SK_KEY.matcher(result).replaceAll(REPLACEMENT);
        result = URL_USERINFO.matcher(result).replaceAll("$1" + REPLACEMENT + "@");
        return result;
    }
}
