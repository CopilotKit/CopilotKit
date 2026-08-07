import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const CONTENT_DIR = path.resolve(import.meta.dirname, "../../content");

test("names create as the init command alias across managed setup guides", () => {
  const sources = [
    "docs/premium/managed-intelligence-platform.mdx",
    "snippets/shared/cli/cli.mdx",
    "snippets/shared/threads/headless-threads.mdx",
  ].map((relativePath) =>
    fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8"),
  );
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
    expect(source).not.toMatch(
      /copy[^.]*`INTELLIGENCE_API_KEY`[^.]*`CPK_INTELLIGENCE_API_KEY`/i,
    );
    expect(source).not.toContain("COPILOTKIT_LICENSE_TOKEN=...");
  }
});
