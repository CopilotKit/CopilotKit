/**
 * Drift assertions for the `starter_validation:` manifest key — the SSOT for
 * "which columns have a starter, and which of those are provisioned".
 *
 * These five assertions replace the hand-mirrored `STARTER_COLUMNS` /
 * `STARTER_TO_COLUMN` pair and the `🚫 "Not supported by this framework"` claim
 * it produced on 9 columns, 5 of which were false.
 *
 * WHY EACH ONE CAN FAIL — the previous generation of this test could not.
 * Its predicate was `{columns with a block} ∪ {columns without} = the on-disk
 * set`, which is true of ANY partition. A later draft over-corrected into a
 * predicate that could not PASS: it quantified over `examples/integrations/`
 * directories and demanded "the corresponding column" declare a block, but 7 of
 * those directories are not starters and have no column at all (`_parity`,
 * `a2a-a2ui`, `a2a-middleware`, `adk-angular`, `agent-spec`, `agentcore`,
 * `mcp-apps`), and 6 more have a column under a DIFFERENT name
 * (`adk`→`google-adk`, `langgraph-js`→`langgraph-typescript`,
 * `strands-python`→`strands`, `ms-agent-framework-{dotnet,python}`→
 * `ms-agent-{dotnet,python}`, `crewai-flows`→`crewai-conversational-flows`).
 * Resolving that name gap through the generated mapping would be circular,
 * because the mapping is derived from the very manifests under test.
 *
 * So assertions 1a/1b are stated ENTIRELY IN THE EXAMPLE-SLUG NAMESPACE, where
 * no directory is ever resolved to a column. There is no exclusion list, and
 * none may be added: an exclusion list is the lever that turns a red guard into
 * a green one without fixing anything.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE = path.resolve(HERE, "..", "..");
const REPO = path.resolve(SHOWCASE, "..");
const INTEGRATIONS = path.join(SHOWCASE, "integrations");
const EXAMPLES = path.join(REPO, "examples", "integrations");
const SMOKE_SPEC = path.join(SHOWCASE, "tests", "e2e", "starter-smoke.spec.ts");
const SMOKE_WORKFLOW = path.join(
  REPO,
  ".github",
  "workflows",
  "test_smoke-starter.yml",
);
const RAILWAY_ENVS = path.join(HERE, "..", "railway-envs.generated.json");

type Block =
  | { path: string; service?: string; supported?: true }
  | { supported: false; reason: string };

function columns(): { slug: string; block: Block | undefined }[] {
  return readdirSync(INTEGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "_shared")
    .map((d) => d.name)
    .filter((slug) =>
      existsSync(path.join(INTEGRATIONS, slug, "manifest.yaml")),
    )
    .sort()
    .map((slug) => ({
      slug,
      block: yaml.parse(
        readFileSync(path.join(INTEGRATIONS, slug, "manifest.yaml"), "utf8"),
      ).starter_validation as Block | undefined,
    }));
}

const isSupported = (b: Block): b is { path: string; service?: string } =>
  (b as { supported?: boolean }).supported !== false;

/** The smoke matrix's starter slugs, parsed from the spec's `STARTERS` array. */
function smokeSpecSlugs(): string[] {
  const src = readFileSync(SMOKE_SPEC, "utf8");
  const block = src.match(
    /const STARTERS:\s*Starter\[\]\s*=\s*\[([\s\S]+?)\n\];/,
  );
  if (!block?.[1]) {
    throw new Error(
      "drift parser: could not locate the `STARTERS` array in starter-smoke.spec.ts",
    );
  }
  const slugs = Array.from(
    block[1].matchAll(/slug:\s*"([^"]+)"/g),
    (m) => m[1] as string,
  );
  if (slugs.length === 0) {
    throw new Error("drift parser: `STARTERS` matched but yielded no slugs");
  }
  return slugs;
}

/** The same list as the CI workflow declares it. */
function workflowMatrixSlugs(): string[] {
  const doc = yaml.parse(readFileSync(SMOKE_WORKFLOW, "utf8"));
  const slugs = doc?.jobs?.["smoke-starter"]?.strategy?.matrix?.starter;
  if (!Array.isArray(slugs) || slugs.length === 0) {
    throw new Error(
      "drift parser: could not read jobs.smoke-starter.strategy.matrix.starter",
    );
  }
  return slugs as string[];
}

describe("starter_validation drift", () => {
  // ── 1a — COVERAGE. source ⊆ claim, in the example-slug namespace. ──
  //
  // MUTATION THAT REDS THIS: delete the `starter_validation:` block from
  // showcase/integrations/strands-typescript/manifest.yaml. That is exactly the
  // defect visible before this change — a real starter, in the CI matrix,
  // rendering "Not supported by this framework".
  it("1a — every smoke-matrix starter is claimed by some manifest", () => {
    const source = new Set(smokeSpecSlugs());
    const claimed = new Set(
      columns()
        .map((c) => c.block)
        .filter((b): b is Block => !!b)
        .filter(isSupported)
        .map((b) => path.basename(b.path)),
    );
    const unclaimed = [...source].filter((s) => !claimed.has(s)).sort();
    expect(unclaimed, "smoke-matrix starters no manifest claims").toEqual([]);
  });

  // ── 1b — REALITY + INJECTIVITY. ──
  //
  // MUTATIONS: point any `path:` at a directory that does not exist (reality);
  // or give two columns the same `path:` (injectivity). Injectivity is what
  // stops a copy-paste from silently making two columns read the same probe.
  it("1b — every declared path is a real directory, and no path is claimed twice", () => {
    const declared = columns()
      .filter((c) => c.block && isSupported(c.block))
      .map((c) => ({ slug: c.slug, p: (c.block as { path: string }).path }));

    const missing = declared
      .filter((d) => !existsSync(path.join(REPO, d.p)))
      .map((d) => `${d.slug} -> ${d.p}`);
    expect(missing, "starter_validation.path values with no directory").toEqual(
      [],
    );

    const byPath = new Map<string, string[]>();
    for (const d of declared)
      byPath.set(d.p, [...(byPath.get(d.p) ?? []), d.slug]);
    const dupes = [...byPath.entries()]
      .filter(([, slugs]) => slugs.length > 1)
      .map(([p, slugs]) => `${p} claimed by ${slugs.join(", ")}`);
    expect(dupes, "paths claimed by more than one column").toEqual([]);
  });

  // ── 2 — RAILWAY DRIFT, both directions. ──
  //
  // MUTATION: rename any `service:` value. A column claiming a service that
  // does not exist would render as provisioned and never receive a row.
  it("2 — declared services exist, and every provisioned service is claimed once", () => {
    const real = new Set<string>(
      (
        JSON.parse(readFileSync(RAILWAY_ENVS, "utf8")).services as {
          name: string;
        }[]
      )
        .map((s) => s.name)
        .filter((n) => n.startsWith("starter-")),
    );
    const claimed = columns()
      .filter((c) => c.block && isSupported(c.block))
      .map((c) => (c.block as { service?: string }).service)
      .filter((s): s is string => !!s);

    expect(
      claimed.filter((s) => !real.has(s)).sort(),
      "declared services with no Railway service",
    ).toEqual([]);
    expect(
      [...real].filter((s) => !claimed.includes(s)).sort(),
      "provisioned starter services no manifest claims",
    ).toEqual([]);
    expect(
      claimed.filter((s, i) => claimed.indexOf(s) !== i),
      "services claimed by more than one column",
    ).toEqual([]);
  });

  // ── 3 — NO SILENT COLUMN. ──
  //
  // Rendering "this framework has no starter" requires a POSITIVE declaration.
  // A column with no block at all fails here — and, because Step 5 mints no
  // cell for it, renders NOTHING rather than a not-supported claim, so silence
  // can never become a rendered claim.
  //
  // MUTATION: delete the block from any one of the 21 manifests.
  it("3 — all 21 columns declare a block; the 5 unsupported ones declare a reason", () => {
    const cols = columns();
    expect(cols).toHaveLength(21);
    expect(
      cols.filter((c) => !c.block).map((c) => c.slug),
      "columns with no starter_validation block",
    ).toEqual([]);

    const unsupported = cols.filter(
      (c) => c.block && !isSupported(c.block),
    ) as { slug: string; block: { supported: false; reason: string } }[];
    expect(unsupported.map((c) => c.slug).sort()).toEqual([
      "ag2",
      "built-in-agent",
      "langroid",
      "ms-agent-harness-dotnet",
      "spring-ai",
    ]);
    for (const c of unsupported) {
      // A placeholder would be schema-valid (`minLength: 1`) and would ship an
      // unreviewed capability claim, which is the whole thing assertion 3
      // exists to prevent.
      expect(c.block.reason.trim().length, `${c.slug} reason`).toBeGreaterThan(
        20,
      );
      expect(c.block.reason.toUpperCase()).not.toContain("TODO");
      expect(c.block.reason.toUpperCase()).not.toContain("FIXME");
    }
  });

  // ── 4 — SPEC ↔ WORKFLOW MATRIX PARITY. ──
  //
  // Nothing asserted this before. The two lists were equal BY HAND, and 1a's
  // single-file source set is only legitimate because this now makes them equal
  // BY GUARD.
  //
  // MUTATION: add or remove one entry from either list alone.
  it("4 — the smoke spec's STARTERS and the workflow matrix are the same set", () => {
    const spec = [...new Set(smokeSpecSlugs())].sort();
    const wf = [...new Set(workflowMatrixSlugs())].sort();
    expect(wf).toEqual(spec);
  });

  // ── 5 — THE PUBLIC `starter:` KEY STAYS DARK. ──
  //
  // `starter:` drives a public "🚀 Full Starter" section (name heading, live
  // demo iframe, GitHub link, `npx degit` command) on the integration profile
  // page, plus a file bundler, across three shells. Zero manifests declare it
  // and this change adds none — so the ladder cannot switch public product
  // content on as a side effect, and an author cannot do it by mistaking one
  // key for the other.
  //
  // MUTATION: add a `starter:` block to any manifest.
  it("5 — no manifest declares the public `starter:` key", () => {
    const declaring = columns()
      .filter(
        (c) =>
          yaml.parse(
            readFileSync(
              path.join(INTEGRATIONS, c.slug, "manifest.yaml"),
              "utf8",
            ),
          ).starter !== undefined,
      )
      .map((c) => c.slug);
    expect(declaring, "manifests declaring the PUBLIC `starter:` key").toEqual(
      [],
    );
  });

  // Non-vacuity: assertions 1a/1b/2 all quantify over the declared set. If that
  // set were ever empty they would pass by construction, so the shape of the
  // declaration set is pinned directly.
  it("non-vacuity: the declared set is 12 provisioned + 4 in-repo-only + 5 unsupported", () => {
    const cols = columns();
    const supported = cols.filter((c) => c.block && isSupported(c.block));
    const provisioned = supported.filter(
      (c) => (c.block as { service?: string }).service,
    );
    expect(provisioned).toHaveLength(12);
    expect(supported.length - provisioned.length).toBe(4);
    expect(cols.filter((c) => c.block && !isSupported(c.block))).toHaveLength(
      5,
    );
  });
});
