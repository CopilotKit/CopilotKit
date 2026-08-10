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

/** Reads content files used as managed-onboarding contract fixtures. */
function readSources(
  relativePaths: readonly string[],
  normalizeWhitespace = false,
): string[] {
  return relativePaths.map((relativePath) => {
    const source = fs.readFileSync(
      path.join(CONTENT_DIR, relativePath),
      "utf8",
    );
    return normalizeWhitespace ? source.replace(/\s+/g, " ") : source;
  });
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

test("names create as the init command alias across managed setup guides", () => {
  const sources = readSources([
    "docs/premium/managed-intelligence-platform.mdx",
    "snippets/shared/cli/cli.mdx",
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
  const sources = readSources(
    [
      "docs/premium/managed-intelligence-platform.mdx",
      "snippets/shared/cli/cli.mdx",
      "snippets/shared/threads/headless-threads.mdx",
    ],
    true,
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

test("documents the conditional managed onboarding sequence", () => {
  const sequence = [
    /new accounts accept[^.]*(?:Clerk[^.]*Terms|Terms[^.]*Clerk)/i,
    /select or create an organization/i,
    /only organizations created at or after[^.]*cutoff[^.]*Developer or a paid plan/i,
    /select or create a project/i,
    /resumes? the exact[^.]*CLI[^.]*managed[^.]*flow/i,
  ];

  for (const source of readSources(MANAGED_ONBOARDING_GUIDES, true)) {
    expectPatternsInOrder(source, sequence);
  }
});

test("documents grandfathering, consent, and customer-run self-hosting boundaries", () => {
  for (const source of readSources(MANAGED_ONBOARDING_GUIDES, true)) {
    expect(source).toMatch(
      /organizations created before[^.]*cutoff[^.]*continue without a plan prompt/i,
    );
    expect(source).toMatch(/existing accounts do not re-consent/i);
    expect(source).toMatch(
      /Team Self-hosted[^.]*purchase[^.]*customer-run self-hosted deployment[^.]*never uses[^.]*Clerk/i,
    );
    expect(source).not.toMatch(/(?:every|all) new organizations?[^.]*paid plan/i);
  }
});

test("removes automatic-Free promises from managed onboarding CTAs", () => {
  for (const source of readSources(MANAGED_CTA_SOURCES)) {
    expect(source).not.toMatch(/Create a free account/i);
    expect(source).toContain('ctaLabel="Start managed onboarding"');
  }
});
