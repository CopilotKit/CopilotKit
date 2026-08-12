/**
 * staged-ts-scrub-parity.test.ts — regression guard that the COPY-staged
 * cvdiag scrub in each standalone TS integration matches the canonical
 * scrub redesign (R5-A1 base64url `sk-ant-…` keys, R5-A2 colon-less URL
 * userinfo). The four TS integrations get `src/cvdiag/` copy-staged by
 * `showcase cvdiag-stage-ts`; a stale stage ships the LEGACY scrub which
 * leaks both secret shapes. This test fails RED against a stale stage and
 * passes GREEN once re-staged from canonical.
 *
 * Imports the staged copies directly by relative path so the test exercises
 * the EXACT source each integration's Docker build context bundles, not the
 * canonical harness module.
 */

import { describe, it, expect } from "vitest";

// Anthropic key with a base64url body (`_` and `-` after a hyphen segment) —
// the legacy `sk-[A-Za-z0-9]{16,}` only matched the trailing alnum run, so the
// full key leaked. Colon-less userinfo `token@host` — the legacy
// `user:password@` form required a colon, so a bare token leaked.
const SK_ANT = "sk-ant-api03-AAAA_BBBB-CCCC0123456789xyzAB";
const URL_TOKEN = "https://ghp_secrettoken@example.com/x";

const stagedDirs = {
  "built-in-agent":
    "../../../integrations/built-in-agent/src/cvdiag/edge-headers.js",
  "claude-sdk-typescript":
    "../../../integrations/claude-sdk-typescript/src/cvdiag/edge-headers.js",
  "langgraph-typescript":
    "../../../integrations/langgraph-typescript/src/cvdiag/edge-headers.js",
  mastra: "../../../integrations/mastra/src/cvdiag/edge-headers.js",
} as const;

describe("staged TS cvdiag scrub parity with canonical", () => {
  for (const [integration, spec] of Object.entries(stagedDirs)) {
    it(`${integration}: redacts base64url sk-ant key + colon-less URL userinfo`, async () => {
      const mod = (await import(/* @vite-ignore */ spec)) as {
        scrubSecrets: (v: string) => string;
      };
      const scrubbedKey = mod.scrubSecrets(SK_ANT);
      const scrubbedUrl = mod.scrubSecrets(URL_TOKEN);

      // The full base64url Anthropic key must be gone.
      expect(scrubbedKey).not.toContain("AAAA_BBBB");
      expect(scrubbedKey).not.toContain("0123456789xyzAB");
      expect(scrubbedKey).toContain("[REDACTED]");

      // The colon-less userinfo token must be gone, scheme + host preserved.
      expect(scrubbedUrl).not.toContain("ghp_secrettoken");
      expect(scrubbedUrl).toContain("[REDACTED]");
      expect(scrubbedUrl).toContain("example.com");
    });
  }
});
