import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import yaml from "js-yaml";

/**
 * Parity check between the three Railway-discovery probe YAMLs that share
 * an `infra exclude` list:
 *
 *   - `smoke.yml`        (showcase-* health pings, every 15 min)
 *   - `e2e-smoke.yml`    (deep L3/L4 chat round-trip, every 30 min)
 *   - `e2e-demos.yml`    (per-demo structural goto+selector, every 6 hr)
 *
 * All three exclude the same infra services (aimock, ops, pocketbase,
 * shell, shell-dashboard, shell-docs, shell-dojo) — drift between them
 * means a new infra service added to one will silently flap red on the
 * others. This test mechanises the "kept in sync with `smoke.yml` /
 * `e2e-smoke.yml`" comment that lives in each YAML's header so a
 * misaligned PR fails CI instead of relying on review attention.
 *
 * This test reads the YAML files directly rather than going through
 * `createProbeLoader` so it doesn't need a registry-mocked bootstrap —
 * the parity invariant is independent of probe registration.
 */
describe("probe-config nameExcludes parity", () => {
  function configsDir(): string {
    // Resolve relative to this file so the test is portable across
    // worktrees / CI checkouts. `import.meta.url` would also work but
    // the existing probe-loader tests use `process.cwd()` resolution
    // (see probe-loader.test.ts), so mirror that pattern.
    return path.resolve(process.cwd(), "config/probes");
  }

  async function readNameExcludes(file: string): Promise<string[]> {
    const fullPath = path.join(configsDir(), file);
    const raw = await fs.readFile(fullPath, "utf-8");
    const parsed = yaml.load(raw) as {
      discovery?: { filter?: { nameExcludes?: string[] } };
    };
    const excludes = parsed.discovery?.filter?.nameExcludes;
    if (!Array.isArray(excludes)) {
      throw new Error(
        `${file}: expected discovery.filter.nameExcludes to be an array; got ${JSON.stringify(excludes)}`,
      );
    }
    return excludes;
  }

  it("smoke / e2e-smoke / e2e-demos all share an identical nameExcludes list", async () => {
    const [smoke, e2eSmoke, e2eDemos] = await Promise.all([
      readNameExcludes("smoke.yml"),
      readNameExcludes("e2e-smoke.yml"),
      readNameExcludes("e2e-demos.yml"),
    ]);

    // Compare as sorted arrays — list order doesn't matter for
    // exclusion semantics, only set membership.
    const sortedSmoke = [...smoke].sort();
    const sortedE2eSmoke = [...e2eSmoke].sort();
    const sortedE2eDemos = [...e2eDemos].sort();

    expect(sortedE2eSmoke).toEqual(sortedSmoke);
    expect(sortedE2eDemos).toEqual(sortedSmoke);
  });
});
