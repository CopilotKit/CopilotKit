import { readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
// Extensions such as Grammarly can add body attributes before React hydrates.
const BODY_TAG = /^[ \t]*<body\b[^>]*>/gm;
const IGNORED_DIRECTORIES = new Set([".git", ".next", "dist", "node_modules"]);
const NEXT_ROOT_FILES = new Set([
  "_document.js",
  "_document.jsx",
  "_document.tsx",
  "layout.js",
  "layout.jsx",
  "layout.tsx",
]);

function walkFiles(root: string, include: (path: string) => boolean): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;

    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...walkFiles(path, include));
      }
    } else if (entry.isFile() && include(path)) {
      files.push(path);
    }
  }

  return files;
}

function unguardedBodyTags(path: string): string[] {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(BODY_TAG)]
    .map(([tag]) => tag)
    .filter((tag) => !tag.includes("suppressHydrationWarning"));
}

function relativeOffenders(paths: string[]): string[] {
  return paths
    .filter((path) => unguardedBodyTags(path).length > 0)
    .map((path) => relative(REPO_ROOT, path))
    .sort();
}

describe("Next.js browser-extension hydration guard", () => {
  it("guards every first-party Next root body", () => {
    const rootDocuments = walkFiles(REPO_ROOT, (path) =>
      NEXT_ROOT_FILES.has(basename(path)),
    );

    expect(relativeOffenders(rootDocuments)).toEqual([]);
  });

  it("guards every body shown in Next.js setup documentation", () => {
    const contentRoot = join(
      REPO_ROOT,
      "showcase",
      "shell-docs",
      "src",
      "content",
    );
    const documentation = walkFiles(REPO_ROOT, (path) =>
      /\.(?:md|mdx)$/.test(path),
    ).filter(
      (path) =>
        path.startsWith(contentRoot) ||
        readFileSync(path, "utf8").includes("RootLayout"),
    );

    expect(relativeOffenders(documentation)).toEqual([]);
  });
});
