import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Generated `src/data/*.json` bundles imported by a client module ship to the
// browser in full. `demo-content.json` (every showcase demo's source, ~39 MB)
// did, through a "use client" <DemoSource>: a ~40 MB chunk on most docs pages,
// downloaded again for each route group. Client code may only reach the
// bundles listed here, on purpose: the search index for the search modal, and
// the integration registries used by search, analytics and the framework
// selectors. Adding one ships the whole file to every reader.
const CLIENT_DATA_ALLOWLIST = new Set([
  "search-index.json",
  "registry.json",
  "frontend-registry.json",
]);

const SRC = path.resolve(__dirname, "../..");
// Type-only imports are erased at build time, so they don't count.
const IMPORT_RE =
  /(?:import|export)\s(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const USE_CLIENT_RE =
  /^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*\s*['"]use client['"]/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (base.endsWith(".json")) return base;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function importsOf(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  return [...text.matchAll(IMPORT_RE)]
    .map((m) => resolveImport(file, m[1] ?? m[2]))
    .filter((p): p is string => p !== null);
}

describe("client modules and generated data bundles", () => {
  it("reach only allowlisted src/data/*.json files", () => {
    const dataDir = path.join(SRC, "data");
    const clientFiles = sourceFiles(SRC).filter((f) =>
      USE_CLIENT_RE.test(fs.readFileSync(f, "utf8")),
    );
    expect(clientFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const start of clientFiles) {
      const parent = new Map<string, string | null>([[start, null]]);
      const queue = [start];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.endsWith(".json")) {
          const name = path.basename(current);
          if (
            path.dirname(current) === dataDir &&
            !CLIENT_DATA_ALLOWLIST.has(name)
          ) {
            const chain: string[] = [];
            for (let at: string | null = current; at; at = parent.get(at)!) {
              chain.unshift(path.relative(SRC, at));
            }
            violations.push(chain.join(" -> "));
          }
          continue;
        }
        for (const next of importsOf(current)) {
          if (!parent.has(next)) {
            parent.set(next, current);
            queue.push(next);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
