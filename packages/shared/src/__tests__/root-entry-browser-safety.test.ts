import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `@copilotkit/shared` is imported by browser-facing packages such as
 * `@copilotkit/react-core`. Browser bundlers resolve the whole static module
 * graph before they tree-shake, so a single static edge from this entry to a
 * Node-only package makes every dependent browser build print "Module ... has
 * been externalized for browser compatibility" warnings, even when the
 * consumer never touches the offending code. That was issue #4151, caused by
 * the root entry re-exporting `telemetry/telemetry-client.ts`.
 *
 * Deferring the import does not help: a dynamic import keeps the graph edge.
 * The edge itself has to stay out of this entry. This test walks the static,
 * value-level graph from `src/index.ts` and fails if it reaches a Node-only
 * package. Type-only edges are erased at build time and are therefore fine.
 */
const NODE_ONLY_PACKAGES = ["@segment/analytics-node", "node-fetch"];

const SRC = resolve(__dirname, "..");

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = join(dirname(fromFile), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    base,
  ]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      return candidate;
    }
  }
  return null;
}

/** Bare specifiers reachable from `entry` through value (non-type) edges. */
function collectRuntimeDependencies(entry: string): Set<string> {
  const bare = new Set<string>();
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    // `import ... from "x"`, `export ... from "x"`, `import("x")`. The
    // negative lookahead drops `import type` / `export type`, which the
    // compiler erases.
    const pattern =
      /(?:\b(?:import|export)\b(?!\s+type\b)[\s\S]*?\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;

    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith(".")) {
        const target = resolveRelative(file, specifier);
        if (target) queue.push(target);
        continue;
      }
      bare.add(specifier);
    }
  }

  return bare;
}

describe("root entry browser safety (#4151)", () => {
  it("does not reach Node-only packages through value imports", () => {
    const reachable = collectRuntimeDependencies(join(SRC, "index.ts"));
    const offenders = NODE_ONLY_PACKAGES.filter((pkg) => reachable.has(pkg));
    expect(offenders).toEqual([]);
  });

  it("still reaches Node-only packages from the telemetry subpath entry", () => {
    // Guards the test itself: the walker has to be able to see the edge it is
    // asserting the absence of above.
    const reachable = collectRuntimeDependencies(
      join(SRC, "telemetry", "index.ts"),
    );
    expect(reachable).toContain("@segment/analytics-node");
  });
});
