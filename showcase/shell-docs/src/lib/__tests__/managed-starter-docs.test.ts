import fs from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

const CONTENT_DIR = path.resolve(import.meta.dirname, "../../content");
const MANAGED_ONBOARDING_GUIDES = [
  "docs/premium/managed-intelligence-platform.mdx",
  "snippets/shared/cli/cli.mdx",
];
const MANAGED_CTA_SOURCES = [
  ...MANAGED_ONBOARDING_GUIDES,
  "docs/premium/intelligence-platform.mdx",
];
const MANAGED_RUNTIME_GUIDES = [
  "docs/backend/runtime-endpoints.mdx",
  "docs/premium/connect-your-runtime.mdx",
  "snippets/shared/threads/headless-threads.mdx",
];
const MANAGED_DASHBOARD_URL = "https://dashboard.operations.copilotkit.ai/";

/** Reads managed-onboarding docs as whitespace-normalized contract fixtures. */
function readSources(relativePaths: readonly string[]): string[] {
  return relativePaths.map((relativePath) =>
    fs
      .readFileSync(path.join(CONTENT_DIR, relativePath), "utf8")
      .replace(/\s+/g, " "),
  );
}

/** Asserts that a guide presents onboarding requirements in journey order. */
function expectPatternsInOrder(
  source: string,
  patterns: readonly RegExp[],
): void {
  let previousIndex = -1;

  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) throw new Error(`Missing onboarding step: ${pattern}`);

    expect(
      match.index,
      `Onboarding step is out of order: ${pattern}`,
    ).toBeGreaterThan(previousIndex);
    previousIndex = match.index;
  }
}

test("documents the conditional managed onboarding journey", () => {
  const sequence = [
    /Clerk signup,[^.]*\b(?:new users accept|a new user accepts)\b[^.]*CopilotKit Self-Service Agreement/i,
    /select or create an organization/i,
    /every new hosted organization created at or after[^.]*cutoff[^.]*explicitly choose[^.]*Developer[^.]*paid plan/i,
    /### (?:Return to the terminal|Continue where you started)/i,
    /### Select or create a project/i,
  ];

  for (const source of readSources(MANAGED_ONBOARDING_GUIDES)) {
    expectPatternsInOrder(source, sequence);
  }
});

test("documents grandfathering, consent, and self-hosted admission boundaries", () => {
  for (const source of readSources(MANAGED_ONBOARDING_GUIDES)) {
    expect(source).toMatch(
      /(?:existing )?hosted organizations created before[^.]*cutoff[^.]*continue without a plan prompt/i,
    );
    expect(source).toMatch(/existing accounts do not re-consent/i);
    expect(source).toMatch(
      /customer-run self-hosted deployment[^.]*customer[^.]*identity provider[^.]*never sees[^.]*Clerk admission/i,
    );
  }
});

test("does not count Clerk automatic Free as the required organization choice", () => {
  for (const source of readSources(MANAGED_ONBOARDING_GUIDES)) {
    expect(source).toMatch(
      /Clerk(?:'s|’s) automatic Free assignment does not (?:satisfy|count as) the required Developer-or-paid choice/i,
    );
    expect(source).not.toMatch(
      /Clerk(?:'s|’s) automatic Free assignment (?:satisfies|counts as) the required Developer-or-paid choice/i,
    );
  }
});

test("removes automatic-Free promises from managed onboarding calls to action", () => {
  for (const source of readSources(MANAGED_CTA_SOURCES)) {
    expect(source).not.toMatch(/Create a free account/i);
    expect(source).toContain('ctaLabel="Start managed onboarding"');
  }
});

test("points managed onboarding calls to action at the hosted dashboard", () => {
  for (const source of readSources(MANAGED_CTA_SOURCES)) {
    const managedCta = source.match(
      /<OpsPlatformCTA[^>]*ctaLabel="Start managed onboarding"[^>]*\/>/,
    )?.[0];

    expect(managedCta).toContain(`href="${MANAGED_DASHBOARD_URL}"`);
  }
});

test("names create as the init command alias across managed setup guides", () => {
  const sources = readSources([
    ...MANAGED_ONBOARDING_GUIDES,
    "snippets/shared/threads/headless-threads.mdx",
  ]);
  const reversedAlias =
    /`create`(?:\s+\(aliased as|\s+(?:and|or)\s+its)\s+`init`/;
  const canonicalAlias =
    /`init`(?:\s+\(aliased as|\s+(?:and|or)\s+its)\s+`create`/;

  for (const source of sources) {
    expect(source).toMatch(canonicalAlias);
    expect(source).not.toMatch(reversedAlias);
  }
});

test("documents the managed CLI credential without an offline license token", () => {
  const oldKeyName = ["INTELLIGENCE", "API", "KEY"].join("_");
  const sources = [
    "docs/premium/managed-intelligence-platform.mdx",
    "snippets/shared/cli/cli.mdx",
    "snippets/shared/threads/headless-threads.mdx",
  ].map((relativePath) =>
    fs
      .readFileSync(path.join(CONTENT_DIR, relativePath), "utf8")
      .replace(/\s+/g, " "),
  );

  for (const source of sources) {
    expect(source).toContain(
      "Managed project setup does not issue `COPILOTKIT_LICENSE_TOKEN`.",
    );
    expect(source).toContain("`CPK_INTELLIGENCE_API_KEY`");
    expect(source).not.toContain(`\`${oldKeyName}\``);
    expect(source).not.toContain("COPILOTKIT_LICENSE_TOKEN=...");
  }
});

/**
 * A provisioned project key is `cpk-<projectId>_<short>_<long>` — see
 * `keyPrefix: \`cpk-${projectId}\`` in Intelligence's `apps/app-api/src/api-keys.ts`
 * and the `parseApiKeyToken` fixtures. `cpk_...` matches no key the platform
 * issues, so a reader comparing the placeholder against their own key sees a
 * mismatch where there is none.
 */
test("uses the managed API key prefix in thread import examples", () => {
  const sources = readSources([
    "docs/integrations/adk/threads-import.mdx",
    "docs/integrations/langgraph/threads-import.mdx",
    "snippets/shared/cli/cli.mdx",
    "snippets/shared/threads/threads-import.mdx",
  ]);

  for (const source of sources) {
    expect(source).toContain('CPK_INTELLIGENCE_API_KEY="cpk-..."');
    expect(source).not.toContain('CPK_INTELLIGENCE_API_KEY="cpk_..."');
  }
});

test("reads the CLI-managed key name in Runtime wiring guides", () => {
  const oldKeyName = ["INTELLIGENCE", "API", "KEY"].join("_");
  const sources = readSources(MANAGED_RUNTIME_GUIDES);

  for (const source of sources) {
    expect(source).toContain("process.env.CPK_INTELLIGENCE_API_KEY");
    expect(source).not.toContain(`process.env.${oldKeyName}`);
  }

  const connectRuntime = sources[1];
  expect(connectRuntime).toContain("CPK_INTELLIGENCE_API_KEY=cpk-...");
  expect(connectRuntime).not.toContain("CPK_INTELLIGENCE_API_KEY=cpk_...");
});

/**
 * ENT-1151 removed the license token from managed setup, but twelve integration
 * quickstarts still handed the reader `CPK_INTELLIGENCE_API_KEY=your_license_key`
 * under "The runtime reads the license key from step 1" — a license key named as
 * the value of the project API key, on the credential the PRD exists to isolate
 * (OSS-1029). The two are different credentials with different lifetimes, and a
 * reader who goes looking for a license key to paste finds a dead end.
 *
 * Scanned rather than listed: a page added next month is covered the day it
 * lands, not the day someone remembers this test.
 */
test("never names a license key as the value of the project API key", () => {
  const offenders: string[] = [];

  for (const file of mdxFilesIn(CONTENT_DIR)) {
    const text = fs.readFileSync(file, "utf8");
    const relative = path.relative(CONTENT_DIR, file);

    for (const [, value] of text.matchAll(/CPK_INTELLIGENCE_API_KEY=(\S+)/g)) {
      if (/license/i.test(value!)) offenders.push(`${relative} (${value})`);
    }
    if (/reads the license key/i.test(text)) {
      offenders.push(`${relative} (prose: "reads the license key")`);
    }
  }

  expect(offenders).toEqual([]);
});

/** Every MDX page under `dir`, recursively. */
function mdxFilesIn(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return mdxFilesIn(full);
    return entry.name.endsWith(".mdx") ? [full] : [];
  });
}
