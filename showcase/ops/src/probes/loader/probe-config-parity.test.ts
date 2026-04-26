import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import yaml from "js-yaml";

// `import.meta.url` is stable regardless of cwd; see `configsDir()` for
// the full rationale on why we resolve relative to this file rather
// than `process.cwd()`.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Parity check between Railway-discovery probe YAMLs that share an
 * `infra exclude` list:
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
 * Beyond the strict triple, the test ALSO floor-checks every other
 * probe whose `discovery.source === "railway-services"` (e.g.
 * `image-drift`, `qa`, etc.): such probes must either share the same
 * infra-exclusion floor or appear in the documented exemption list
 * (`RAILWAY_PROBES_EXEMPT_FROM_EXCLUDES_FLOOR`). The exemption list
 * names each probe AND why it can omit the floor — so a future
 * railway-services probe authored without an `nameExcludes` list
 * fails CI instead of silently flapping infra services red.
 *
 * This test reads the YAML files directly rather than going through
 * `createProbeLoader` so it doesn't need a registry-mocked bootstrap —
 * the parity invariant is independent of probe registration.
 */

interface ParsedProbe {
  file: string;
  kind?: string;
  discovery?: {
    source?: string;
    filter?: { namePrefix?: string; nameExcludes?: string[] };
  };
}

/**
 * Documented exemption list for the railway-services-floor invariant.
 * Probes here are KNOWN to enumerate against `railway-services` without
 * needing the standard infra `nameExcludes` floor. New entries must
 * carry a one-line rationale so future maintainers can audit at a
 * glance whether an exemption still applies.
 *
 * Adding a probe here is a deliberate choice: its dimension does NOT
 * fan out user-visible signal across showcase-* services, so leaking
 * infra services into its enumeration is harmless (or desired).
 */
const RAILWAY_PROBES_EXEMPT_FROM_EXCLUDES_FLOOR: Record<string, string> = {
  // image-drift checks GHCR digest pinning across ALL railway services
  // (including infra), so the floor would actively break it — infra
  // drift is real signal here.
  "image-drift.yml":
    "image-drift checks digest pinning across all services (including infra)",
  // qa is scoped to a single service today (`showcase-langgraph-python`)
  // via a precise `namePrefix`, so the floor doesn't apply — there's
  // no infra leakage to exclude.
  "qa.yml":
    "qa is scoped to one service via precise namePrefix; no infra leakage",
};

describe("probe-config nameExcludes parity", () => {
  function configsDir(): string {
    // Resolve relative to this file (probes/loader/) up to showcase/ops
    // root, then into config/probes. cwd-relative resolution was wrong
    // because vitest may be launched from any ancestor directory and
    // would resolve config/probes against the wrong root.
    return path.resolve(__dirname, "../../../config/probes");
  }

  async function readProbeYaml(file: string): Promise<ParsedProbe> {
    const fullPath = path.join(configsDir(), file);
    const raw = await fs.readFile(fullPath, "utf-8");
    const parsed = yaml.load(raw) as ParsedProbe;
    return { ...parsed, file };
  }

  async function readNameExcludes(file: string): Promise<string[]> {
    const parsed = await readProbeYaml(file);
    const excludes = parsed.discovery?.filter?.nameExcludes;
    if (!Array.isArray(excludes)) {
      throw new Error(
        `${file}: expected discovery.filter.nameExcludes to be an array; got ${JSON.stringify(excludes)}`,
      );
    }
    return excludes;
  }

  async function readNamePrefix(file: string): Promise<string> {
    const parsed = await readProbeYaml(file);
    const prefix = parsed.discovery?.filter?.namePrefix;
    if (typeof prefix !== "string" || prefix.length === 0) {
      throw new Error(
        `${file}: expected discovery.filter.namePrefix to be a non-empty string; got ${JSON.stringify(prefix)}`,
      );
    }
    return prefix;
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

    // Defend against the vacuous-parity flake — three empty lists
    // would technically be "equal" but break the invariant. The smoke
    // floor must always carry the canonical infra services.
    expect(sortedSmoke.length).toBeGreaterThan(0);
    expect(sortedE2eSmoke).toEqual(sortedSmoke);
    expect(sortedE2eDemos).toEqual(sortedSmoke);
  });

  it("smoke / e2e-smoke / e2e-demos all share the same namePrefix", async () => {
    // namePrefix is also load-bearing across the railway-services
    // probe trio: a typo on one would silently scope it to a different
    // (or empty) set of services and rebroadcast no signal. Mechanise
    // this in the same parity test so a drift in either field fails
    // CI together.
    const [smoke, e2eSmoke, e2eDemos] = await Promise.all([
      readNamePrefix("smoke.yml"),
      readNamePrefix("e2e-smoke.yml"),
      readNamePrefix("e2e-demos.yml"),
    ]);

    expect(e2eSmoke).toBe(smoke);
    expect(e2eDemos).toBe(smoke);
    // Belt-and-suspenders: the canonical prefix is `showcase-`. Pin
    // it here so a coordinated rename on all three would still need
    // a deliberate test update.
    expect(smoke).toBe("showcase-");
  });

  it("every railway-services-backed YAML either floors the smoke excludes or is documented exempt", async () => {
    // Glob ALL probe YAMLs, not just the canonical trio. Future
    // probes added with `discovery.source: railway-services` must
    // either share the smoke-floor `nameExcludes` set (so infra
    // services don't flap red on a new dimension) OR be added to
    // `RAILWAY_PROBES_EXEMPT_FROM_EXCLUDES_FLOOR` with a documented
    // rationale.
    const dir = configsDir();
    const entries = await fs.readdir(dir);
    // Match both `.yml` and `.yaml` — the loader accepts either, so the
    // floor invariant must too. Filtering only `.yml` would let a probe
    // authored as `<name>.yaml` silently bypass the railway-services
    // floor check and flap infra services red.
    const ymlFiles = entries.filter(
      (f) => f.endsWith(".yml") || f.endsWith(".yaml"),
    );

    const smokeFloor = new Set(await readNameExcludes("smoke.yml"));
    expect(smokeFloor.size).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of ymlFiles) {
      const parsed = await readProbeYaml(file);
      if (parsed.discovery?.source !== "railway-services") continue;
      // Strict floor check on the canonical trio is already covered
      // by the previous test; here we assert the SUPERSET relation
      // (every probe excludes at least the smoke set) for the
      // non-trio members.
      if (file === "smoke.yml") continue;
      const excludes = parsed.discovery?.filter?.nameExcludes;
      if (file in RAILWAY_PROBES_EXEMPT_FROM_EXCLUDES_FLOOR) {
        // Exempt: the rationale must be a non-empty string. The
        // record-typed lookup makes this enforceable.
        const rationale = RAILWAY_PROBES_EXEMPT_FROM_EXCLUDES_FLOOR[file];
        expect(rationale && rationale.length > 0).toBe(true);
        // Guard against the exemption rationale rotting silently:
        // every exempt probe must EITHER be more narrowly scoped than
        // the broad `showcase-` floor (i.e. its `namePrefix` is a
        // strict superset of `showcase-`, like `showcase-quizapp-`),
        // OR carry a grep-able rationale phrase explicitly stating
        // why it spans every service (current marker:
        // `all services`, intentionally specific so an unrelated
        // rationale tweak can't accidentally satisfy it).
        //
        // Why this matters: today qa.yml is scoped to
        // `showcase-langgraph-python` so the floor doesn't apply.
        // If a future maintainer relaxes its `namePrefix` to
        // `showcase-` without removing the exemption, infra services
        // (aimock/ops/pocketbase/shell*) would silently leak into qa
        // discovery and flap red. This guard fires in that case and
        // forces them to either drop the exemption (and add the
        // smoke-floor `nameExcludes`) or update the rationale to
        // explicitly justify spanning every service.
        const prefix = parsed.discovery?.filter?.namePrefix;
        const hasNarrowPrefix =
          typeof prefix === "string" &&
          prefix.startsWith("showcase-") &&
          prefix.length > "showcase-".length;
        const rationaleSpansEverything = /all services/i.test(rationale ?? "");
        expect(
          hasNarrowPrefix || rationaleSpansEverything,
          `${file}: exempt probe must EITHER have a namePrefix narrower than "showcase-" (got ${JSON.stringify(prefix)}) OR carry an "all services" phrase in its RAILWAY_PROBES_EXEMPT_FROM_EXCLUDES_FLOOR rationale. Without one, broadening this probe later would silently flap infra services red.`,
        ).toBe(true);
        continue;
      }
      if (!Array.isArray(excludes)) {
        violations.push(
          `${file}: missing discovery.filter.nameExcludes (and not in exempt list)`,
        );
        continue;
      }
      const set = new Set(excludes);
      const missing = [...smokeFloor].filter((s) => !set.has(s));
      if (missing.length > 0) {
        violations.push(
          `${file}: missing infra excludes ${JSON.stringify(missing)} (must be a superset of smoke.yml or added to exempt list)`,
        );
      }
    }

    // Render the failure as a single error listing every offender so
    // a multi-probe drift surfaces in one CI run.
    expect(violations).toEqual([]);
  });
});
