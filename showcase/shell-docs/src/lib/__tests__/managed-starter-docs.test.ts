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
  const sources = [
    "docs/premium/managed-intelligence-platform.mdx",
    "snippets/shared/cli/cli.mdx",
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
    expect(source).not.toMatch(
      /copy[^.]*`INTELLIGENCE_API_KEY`[^.]*`CPK_INTELLIGENCE_API_KEY`/i,
    );
    expect(source).not.toContain("COPILOTKIT_LICENSE_TOKEN=...");
  }
});
