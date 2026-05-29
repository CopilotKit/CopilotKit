import { test, expect } from "@playwright/test";
import type { Route } from "@playwright/test";

/**
 * Env-routing test (B14): for each shell × env combination, assert that
 *   (a) the inlined `window.__SHOWCASE_CONFIG__` matches the env's
 *       expected URL set, and
 *   (b) every backend fetch host matches a tight per-env allowlist.
 *
 * Runs against live deployments after B15 wires the per-env Railway env
 * vars. Failures indicate either a runtime-config wiring regression
 * (the artifact serves stale URLs) or an unsanctioned third-party host
 * appearing in a page load (silent dep introducing a tracker, etc.).
 *
 * Allowlists below are derived from the plan-B host inventory (real
 * page-load captures across the four shells). Treat the inventory as a
 * floor — extend it when a captured load surfaces a new legitimate
 * host, never contract it. An over-broad allowlist masks env-leak bugs.
 *
 * This file is intentionally scoped narrowly to env-routing assertions
 * and uses its own Playwright config at
 * `showcase/playwright.env-routing.config.ts` (the existing
 * `showcase/tests/playwright.config.ts` is the integrations smoke
 * harness with `testDir: ./e2e`).
 */

// Tell ts-prune / unused-import linters that Route is intentionally
// imported for future use (per-request interception in follow-on
// suites that will inspect specific URLs rather than only hosts).
type _Route = Route;

interface EnvSet {
  name: "staging" | "prod";
  expected: {
    baseUrl?: string;
    shellUrl?: string;
    pocketbaseUrl?: string;
    opsBaseUrl?: string;
  };
  /** Hosts (regex) that backend fetches MAY hit. Anything else fails. */
  backendAllowlist: RegExp[];
}

// Third-party hosts shared by both envs (analytics, fonts, CDN, HubSpot,
// REB2B, Reo). Same keys/hosts in staging and prod — these are NOT
// env-routing signals. Pinned tightly to the EXACT hosts captured in
// real page loads (see plan-B B14 host-inventory step); broader
// patterns would let env leaks slip through.
const SHARED_THIRDPARTY_ALLOWLIST: RegExp[] = [
  // Analytics + product telemetry
  /^eu\.i\.posthog\.com$/,
  /^eu-assets\.i\.posthog\.com$/,
  /^static\.scarf\.sh$/,
  /^www\.google-analytics\.com$/,
  /^region1\.google-analytics\.com$/,
  // Fonts (next/font/google preconnects to both)
  /^fonts\.googleapis\.com$/,
  /^fonts\.gstatic\.com$/,
  // Marketing + visitor identification (shell-docs)
  /^js\.hs-scripts\.com$/,
  /^static\.reo\.dev$/,
  /^b2bjsstore\.s3\.us-west-2\.amazonaws\.com$/,
  // Shared image/video CDN (cdn.copilotkit.ai, next.config.ts)
  /^cdn\.copilotkit\.ai$/,
];

const STAGING: EnvSet = {
  name: "staging",
  expected: {
    baseUrl: "https://docs.staging.copilotkit.ai",
    shellUrl: "https://showcase.staging.copilotkit.ai",
    pocketbaseUrl: "https://pocketbase-staging-eec0.up.railway.app",
    opsBaseUrl: "https://harness-staging-2ee4.up.railway.app",
  },
  backendAllowlist: [
    // Staging ingress: ONLY *.staging.copilotkit.ai (e.g.
    // docs.staging.copilotkit.ai, showcase.staging.copilotkit.ai,
    // dashboard.showcase.staging.copilotkit.ai). Anchored at both
    // ends so `something.docs.staging.copilotkit.ai` does NOT slip
    // through.
    /^(docs|showcase|dashboard\.showcase)\.staging\.copilotkit\.ai$/,
    // Railway public domains for the staging deploys this
    // workstream wires. Pinned to the EXACT host suffixes that
    // appear in the B15 env-var list — not a wildcard
    // `-staging-[a-z0-9]+` pattern that would also match other
    // unrelated staging services in the workspace.
    /^pocketbase-staging-eec0\.up\.railway\.app$/,
    /^harness-staging-2ee4\.up\.railway\.app$/,
    ...SHARED_THIRDPARTY_ALLOWLIST,
  ],
};

const PROD: EnvSet = {
  name: "prod",
  expected: {
    baseUrl: "https://docs.copilotkit.ai",
    shellUrl: "https://showcase.copilotkit.ai",
    pocketbaseUrl: "https://showcase-pocketbase-production.up.railway.app",
    opsBaseUrl: "https://showcase-harness-production.up.railway.app",
  },
  backendAllowlist: [
    // Prod ingress: bare-domain marketing + docs + showcase +
    // dashboard hosts. ONLY these — anchored at both ends so
    // `something.docs.copilotkit.ai` doesn't slip through.
    /^(www|docs|showcase|dashboard\.showcase)\.copilotkit\.ai$/,
    // Railway public domains used by prod (exact suffix match per
    // the build-args at showcase_build.yml:197-198).
    /^showcase-pocketbase-production\.up\.railway\.app$/,
    /^showcase-harness-production\.up\.railway\.app$/,
    ...SHARED_THIRDPARTY_ALLOWLIST,
  ],
};

interface ShellTarget {
  shell: "shell" | "shell-docs" | "shell-dashboard" | "shell-dojo";
  urlFor: (env: EnvSet) => string;
  expectedFields: Array<keyof EnvSet["expected"]>;
}

const TARGETS: ShellTarget[] = [
  {
    shell: "shell",
    urlFor: (e) =>
      e.name === "staging"
        ? "https://showcase.staging.copilotkit.ai/"
        : "https://showcase.copilotkit.ai/",
    expectedFields: ["baseUrl"],
  },
  {
    shell: "shell-docs",
    urlFor: (e) =>
      e.name === "staging"
        ? "https://docs.staging.copilotkit.ai/"
        : "https://docs.copilotkit.ai/",
    expectedFields: ["baseUrl", "shellUrl"],
  },
  {
    shell: "shell-dashboard",
    urlFor: (e) =>
      e.name === "staging"
        ? "https://dashboard.showcase.staging.copilotkit.ai/"
        : "https://dashboard.showcase.copilotkit.ai/",
    expectedFields: ["pocketbaseUrl", "shellUrl", "opsBaseUrl"],
  },
  // shell-dojo — uncomment when a public env-routed host is wired
  // (no public ingress today per the B15 service inventory).
];

for (const env of [STAGING, PROD]) {
  for (const target of TARGETS) {
    test(`${target.shell} on ${env.name}: runtime config + backend allowlist`, async ({
      page,
    }) => {
      const offenders: string[] = [];
      page.on("request", (req) => {
        const url = new URL(req.url());
        // Same-origin requests don't cross env lines.
        if (url.origin === new URL(target.urlFor(env)).origin) return;
        // Data: and blob: aren't network hosts.
        if (url.protocol === "data:" || url.protocol === "blob:") return;
        const allowed = env.backendAllowlist.some((re) => re.test(url.host));
        if (!allowed) offenders.push(req.url());
      });

      await page.goto(target.urlFor(env), { waitUntil: "networkidle" });

      // Assert __SHOWCASE_CONFIG__ matches the expected env.
      const cfg = await page.evaluate(
        () =>
          (window as Window & { __SHOWCASE_CONFIG__?: unknown })
            .__SHOWCASE_CONFIG__,
      );
      expect(cfg).toBeDefined();
      for (const field of target.expectedFields) {
        expect((cfg as Record<string, string>)[field]).toBe(
          env.expected[field],
        );
      }

      expect(
        offenders,
        `${target.shell} on ${env.name} hit non-allowlisted hosts:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });
  }
}
