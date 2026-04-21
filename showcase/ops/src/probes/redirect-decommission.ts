import type { Probe, ProbeContext, ProbeResult } from "../types/index.js";

export interface RedirectDecommissionInput {
  /**
   * Pre-formatted Slack mrkdwn body (known-safe). Empty string == no candidates.
   *
   * IMPORTANT: This string is rendered via Mustache triple-brace
   * (`{{{ signal.body }}}`) in redirect-decommission-monthly.yml, which
   * bypasses HTML escaping. The producer of `body` MUST pre-escape any
   * user- or repo-sourced substrings for Slack mrkdwn before handing it
   * to the probe. Trusted characters include `<`, `>`, `&`, `*`, `_`, and
   * backticks only when used as valid mrkdwn markup. Never embed raw
   * URLs, page titles, or repo-owner names without vetting.
   */
  body: string;
  /** Candidate count; when zero, template suppresses via signal.hasCandidates. */
  candidateCount: number;
}

export interface RedirectDecommissionSignal {
  body: string;
  candidateCount: number;
  hasCandidates: boolean;
}

/**
 * Monthly redirect-decommission probe: passes through pre-formatted body
 * computed by the upstream SEO audit. Template uses {{{ signal.body }}}
 * (triple-brace) — signal field is marked slackSafe at probe-definition
 * time so the rule loader permits the unescaped interpolation.
 */
export const redirectDecommissionProbe: Probe<
  RedirectDecommissionInput,
  RedirectDecommissionSignal
> = {
  dimension: "redirect_decommission",
  async run(
    input: RedirectDecommissionInput,
    ctx: ProbeContext,
  ): Promise<ProbeResult<RedirectDecommissionSignal>> {
    return {
      key: "redirect_decommission:monthly",
      state: "green",
      signal: {
        body: input.body,
        candidateCount: input.candidateCount,
        hasCandidates: input.candidateCount > 0,
      },
      observedAt: ctx.now().toISOString(),
    };
  },
};

/** Fields on redirect_decommission signal that are safe for triple-brace interpolation. */
export const REDIRECT_DECOMMISSION_SLACK_SAFE_FIELDS = ["body"] as const;
