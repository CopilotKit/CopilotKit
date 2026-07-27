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
