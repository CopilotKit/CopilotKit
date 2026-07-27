package com.copilotkit.showcase.springai.cvdiag;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Parity tests for {@link MessageScrubber} against the canonical TS
 * {@code scrubSecrets} in {@code showcase/harness/src/cvdiag/scrub.ts}.
 *
 * <p>Each case exercises a class the legacy Java regexes leaked:
 * <ul>
 *   <li>{@code sk-…} base64url tails ({@code _}/{@code -}) that the legacy
 *       {@code sk-[A-Za-z0-9]{16,}} could not span;</li>
 *   <li>colon-less URL userinfo ({@code scheme://token@host}) that the legacy
 *       {@code user:password@} form required a colon for;</li>
 *   <li>{@code Bearer <token>} tokens containing base64/sig punctuation.</li>
 * </ul>
 */
class MessageScrubberTest {

    /**
     * Anthropic key: base64url body with {@code _}/{@code -} separators and an
     * entropy run that sits AFTER a hyphen segment. The legacy
     * {@code sk-[A-Za-z0-9]{16,}} stops at the first {@code _}/{@code -} (so it
     * matches only a short alnum head and leaks the rest); the canonical regex
     * spans the whole base64url body. Uses the documented {@code scrubSecrets}
     * example, which has a contiguous 12-char alphanumeric entropy run.
     */
    @Test
    void redactsSkKeyWithBase64UrlTail() {
        String secret = "sk-ant-api03-AbCd_Ef-0123456789xyzAB";
        String out = MessageScrubber.scrub("key=" + secret);
        assertThat(out).doesNotContain(secret);
        assertThat(out).doesNotContain("_Ef");
        assertThat(out).doesNotContain("-0123456789");
        assertThat(out).isEqualTo("key=" + MessageScrubber.REPLACEMENT);
    }

    /** Colon-less userinfo: `scheme://token@host` (no `:` in the userinfo). */
    @Test
    void redactsColonlessUrlUserinfo() {
        String out = MessageScrubber.scrub("see https://ghp_secrettoken@example.com/x");
        assertThat(out).doesNotContain("ghp_secrettoken");
        assertThat(out).isEqualTo(
                "see https://" + MessageScrubber.REPLACEMENT + "@example.com/x");
    }

    /** Whole Bearer token, including base64/sig punctuation, is redacted. */
    @Test
    void redactsWholeBearerToken() {
        String out = MessageScrubber.scrub(
                "Authorization: Bearer eyJabc.J9.sig/tail+more=end");
        assertThat(out).doesNotContain("eyJabc");
        assertThat(out).doesNotContain("sig/tail+more=end");
        assertThat(out).isEqualTo(
                "Authorization: " + MessageScrubber.REPLACEMENT);
    }
}
