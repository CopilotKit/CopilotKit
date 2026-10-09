import fs from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

const CONTENT_DIR = path.resolve(import.meta.dirname, "../../content");

/** Reads managed-onboarding docs as whitespace-normalized contract fixtures. */
function readSources(relativePaths: readonly string[]): string[] {
  return relativePaths.map((relativePath) =>
    fs
      .readFileSync(path.join(CONTENT_DIR, relativePath), "utf8")
      .replace(/\s+/g, " "),
  );
}

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

test("managed quickstarts provision a project API key instead of a license key", () => {
  const quickstarts = mdxFilesIn(path.join(CONTENT_DIR, "docs")).filter(
    (file) =>
      file.endsWith("quickstart.mdx") &&
      /<SignupLink\s+surface="[^"]*quickstart_step1"/.test(
        fs.readFileSync(file, "utf8"),
      ),
  );

  expect(quickstarts.length).toBeGreaterThan(0);

  for (const file of quickstarts) {
    const rawSource = fs.readFileSync(file, "utf8");
    const source = rawSource.replace(/\s+/g, " ");

    expect(source).not.toMatch(/license key/i);
    expect(source).not.toMatch(/free developer account/i);

    if (source.includes("`CPK_INTELLIGENCE_API_KEY`")) {
      expect(source).toContain("project API key");
      expect(source).toMatch(
        /npx copilotkit@latest (?:project select|init(?:\s|`))/,
      );

      for (const match of rawSource.matchAll(
        /npx copilotkit@latest project select/g,
      )) {
        const precedingSource = rawSource.slice(0, match.index);
        const branchStart = precedingSource.lastIndexOf(
          "<TailoredContentOption",
        );
        const previousBranchEnd = precedingSource.lastIndexOf(
          "</TailoredContentOption>",
        );
        const currentBranchStart =
          branchStart > previousBranchEnd ? branchStart : 0;
        const currentBranchBeforeSelection =
          precedingSource.slice(currentBranchStart);

        expect(currentBranchBeforeSelection).toMatch(
          /(?:git clone |npx create-next-app@latest |npx copilotkit@latest (?:create|init))/,
        );
      }
    }
  }
});

test("managed Inspector examples keep credentials on the runtime server", () => {
  const sources = readSources([
    "docs/inspector.mdx",
    "snippets/shared/intelligence/inspector.mdx",
  ]);

  for (const source of sources) {
    expect(source).toContain('runtimeUrl="/api/copilotkit"');
    expect(source).not.toContain("NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY");
  }
});

/** Every MDX page under `dir`, recursively. */
function mdxFilesIn(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return mdxFilesIn(full);
    return entry.name.endsWith(".mdx") ? [full] : [];
  });
}
