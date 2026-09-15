import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `express` is an OPTIONAL peer dependency (OSS-1177), and `createTeamsServer`
 * in `listener.ts` is the only code in this package that uses it.
 *
 * It must therefore be imported LAZILY. A static `import ... from "express"`
 * anywhere in the graph reachable from `src/index.ts` would make express a hard
 * install requirement of the package's root entry point — and a self-hosted bot
 * that brings its own HTTP server (as `examples/teams` does) would have to
 * install a package it never calls, or fail at import with a module-not-found.
 *
 * Node reports one missing package at a time, so a static import here also
 * turns a single "install the Microsoft SDK" error into two rounds of
 * fix-and-rerun. That is the cost this test exists to prevent.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("express is reached only through a lazy import", () => {
  const files = sourceFiles(SRC);

  it("scans the package's sources, so an empty result is not a false pass", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.map((f) => relative(SRC, f))).toContain("listener.ts");
  });

  it("has no static express import in any source file", () => {
    // `import x from "express"`, `import "express"`, `export ... from "express"`
    // — every static form. A dynamic `import("express")` is deliberately not
    // matched, because that is the form this package must use.
    const staticImport =
      /(?:^|\n)\s*(?:import|export)(?:(?!\bfrom\b)[^\n;])*?from\s*["']express["']|(?:^|\n)\s*import\s*["']express["']/;
    const offenders = files
      .filter((f) => staticImport.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("loads express dynamically inside listener.ts", () => {
    const source = readFileSync(join(SRC, "listener.ts"), "utf8");
    expect(source).toMatch(/await import\(\s*["']express["']\s*\)/);
  });
});
