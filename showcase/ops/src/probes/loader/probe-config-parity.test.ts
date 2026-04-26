import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import yaml from "js-yaml";

// Resolve the configs dir relative to THIS test file rather than
// `process.cwd()`. Earlier versions used `path.resolve(process.cwd(),
// "config/probes")`, which silently broke when vitest was launched from
// a parent directory (monorepo root, IDE runner, etc.) — the test would
// throw ENOENT before reaching the parity assertion. import.meta.url is
// stable regardless of cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    // Resolve relative to this file (probes/loader/) up to showcase/ops
    // root, then into config/probes. cwd-relative resolution was wrong
    // because vitest may be launched from any ancestor directory and
    // would resolve config/probes against the wrong root.
    return path.resolve(__dirname, "../../../config/probes");
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
