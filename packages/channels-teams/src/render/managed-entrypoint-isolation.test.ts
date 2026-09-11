import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `@microsoft/agents-hosting` and `@microsoft/agents-activity` are OPTIONAL
 * peer dependencies of this package, not dependencies (OSS-1173). They are
 * reached only from the self-hosted surface — `adapter.ts` and `listener.ts`.
 *
 * That is only safe while the `./render` subpath stays free of them. It is the
 * entry point `@copilotkit/channels-intelligence` imports for managed Teams
 * delivery, and managed hosts do not install the Microsoft SDK. If a Microsoft
 * import ever reaches this graph, every managed host breaks at import time with
 * a module-not-found — so pin the invariant here rather than discover it in
 * production.
 *
 * The walk is over source, not `dist`, so it fails in the PR that introduces
 * the import rather than at publish time.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Resolve a relative ESM specifier (`./x.js`) to its TypeScript source file. */
function resolveLocal(specifier: string, importer: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = normalize(join(dirname(importer), specifier)).replace(
    /\.js$/,
    "",
  );
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Walk every module reachable from `entry`, returning the bare (non-relative)
 * specifiers the graph imports. Matches `import ... from "x"`, `export ... from
 * "x"`, and `import("x")`, which is every form this package uses.
 */
function externalSpecifiersFrom(entry: string): Map<string, string[]> {
  const seen = new Set<string>();
  const external = new Map<string, string[]>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /(?:from|import)\s*\(?\s*["']([^"']+)["']/g,
    )) {
      const specifier = match[1]!;
      const local = resolveLocal(specifier, file);
      if (local) {
        queue.push(local);
      } else if (!specifier.startsWith(".")) {
        external.set(specifier, [...(external.get(specifier) ?? []), file]);
      }
    }
  }
  return external;
}

describe("./render is importable without the Microsoft Agents SDK", () => {
  const external = externalSpecifiersFrom(join(HERE, "index.ts"));

  it("reaches no @microsoft/* package", () => {
    const microsoft = [...external.entries()].filter(([specifier]) =>
      specifier.startsWith("@microsoft/"),
    );
    // Name the importing file in the failure so the offending edge is obvious.
    expect(
      microsoft.map(
        ([specifier, importers]) => `${specifier} <- ${importers.join(", ")}`,
      ),
    ).toEqual([]);
  });

  it("walks a non-trivial graph, so an empty result is not a false pass", () => {
    // Guards the walker itself: if `resolveLocal` silently stopped resolving,
    // the Microsoft assertion above would pass while proving nothing.
    expect(external.size).toBeGreaterThan(0);
    expect([...external.keys()]).toContain("@copilotkit/channels-core");
  });
});
