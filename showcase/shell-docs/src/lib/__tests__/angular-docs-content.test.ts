import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

function markdownFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) return markdownFiles(entryPath);
    return entry.name.endsWith(".mdx") ? [entryPath] : [];
  });
}

test("keeps published Angular docs standalone and canonical", () => {
  const contentRoot = join(process.cwd(), "src/content");
  const paths = [
    join(contentRoot, "docs/frontends/angular.mdx"),
    join(contentRoot, "docs/cookbook/angular-adk-agentic-app.mdx"),
    ...markdownFiles(join(contentRoot, "docs/frontends/angular")),
    ...markdownFiles(join(contentRoot, "reference/angular")),
  ];
  const publishedCopy = paths
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  expect(publishedCopy).not.toMatch(/\bReact\b/);
  expect(publishedCopy).not.toContain("/frontends/angular");
});
