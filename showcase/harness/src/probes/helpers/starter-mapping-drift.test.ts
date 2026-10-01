/**
 * Drift test — the starter↔column mapping vs the FILESYSTEM and the CI matrix.
 *
 * The harness `starter_smoke` probe family remaps each starter slug to a
 * dashboard COLUMN slug via `STARTER_TO_COLUMN` before emitting
 * `starter:<column-slug>/<level>` rows, and the dashboard decides what to
 * render for a column from `STARTER_COLUMNS` / `STARTER_COLUMNS_UNPROBED`.
 * Every one of those is a HAND-MAINTAINED mirror of facts that live somewhere
 * else, so they rot.
 *
 * They already did: the previous version of this file (plus a `size === 12`
 * assertion in `live-status.test.ts`) let `strands-typescript`,
 * `claude-sdk-python` and `claude-sdk-typescript` — three starters that exist
 * on disk, one of them in the CI smoke matrix — render as
 * 🚫 "Not supported by this framework", an outward-facing capability claim
 * about a partner framework used to describe our own stale plumbing.
 *
 * THE POINT OF THIS FILE IS NON-CIRCULARITY. Every expectation below is
 * derived from a source the mapping does not control:
 *
 *   - `examples/integrations/` — the starter directories on disk.
 *   - `.github/workflows/test_smoke-starter.yml` — the CI smoke matrix.
 *   - `showcase/tests/e2e/starter-smoke.spec.ts` — the Playwright matrix.
 *   - `showcase/integrations/` — the dashboard column directories.
 *
 * None of the four is generated from `STARTER_TO_COLUMN` / `STARTER_COLUMNS`,
 * so none can be made to agree with a rotted mapping by editing the mapping.
 *
 * The smoke matrix and the integration/column lists live outside this pnpm
 * workspace, so they are read via `fs` rather than imported (same technique as
 * `d5-mapping-drift.test.ts`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  STARTER_TO_COLUMN,
  UNPROBED_STARTER_TO_COLUMN,
} from "./starter-mapping.js";
import {
  STARTER_COLUMNS,
  STARTER_COLUMNS_UNPROBED,
  starterSupport,
} from "../../shared/cell-model/live-status.js";

/** showcase/harness/src/probes/helpers → showcase/ */
const SHOWCASE_DIR = resolve(__dirname, "../../../..");
/** showcase/harness/src/probes/helpers → repo root */
const REPO_ROOT = resolve(__dirname, "../../../../..");

const STARTER_SPEC_FILE = resolve(
  SHOWCASE_DIR,
  "tests/e2e/starter-smoke.spec.ts",
);
/** Dashboard columns = the `showcase/integrations/<slug>` manifest dirs. */
const COLUMNS_DIR = resolve(SHOWCASE_DIR, "integrations");
/** Starters = the `examples/integrations/<slug>` template dirs. */
const STARTERS_DIR = resolve(REPO_ROOT, "examples/integrations");
const SMOKE_WORKFLOW_FILE = resolve(
  REPO_ROOT,
  ".github/workflows/test_smoke-starter.yml",
);
/**
 * Per-integration docs pages. Their DIRECTORY names track the STARTER template
 * (`crewai-flows`), while `showcase/integrations/` directory names track the
 * dashboard COLUMN (`crewai-conversational-flows`). Joining the two on the
 * scaffold command each advertises is what makes assertion 6 non-circular.
 */
const DOCS_INTEGRATIONS_DIR = resolve(
  SHOWCASE_DIR,
  "shell-docs/src/content/docs/integrations",
);

/**
 * Directories under `examples/integrations/` that are NOT starter templates —
 * shared parity fixtures and standalone demos with no dashboard column. Kept
 * tiny and explicit: a name only belongs here if it is not a starter at all,
 * never to silence a mapping gap.
 */
const NON_STARTER_EXAMPLE_DIRS: ReadonlySet<string> = new Set([
  "_parity",
  "a2a-a2ui",
  "a2a-middleware",
  "adk-angular",
  "agent-spec",
  "agentcore",
  "mcp-apps",
]);

/**
 * Smoke-matrix starters deliberately NOT accounted for by EITHER mapping, each
 * with the REASON written down. A reason is required (assertion 5), so parking
 * a starter here is a positive declaration a reviewer can read, not silence.
 *
 * EMPTY as of 2026-09-15. It previously held `crewai-flows`, declared undecided
 * because "nothing in the tree records whether this starter IS the
 * `crewai-conversational-flows` dashboard column". Something did: the column's
 * `manifest.yaml` and the starter's own docs directory advertise the SAME
 * `npx copilotkit@latest init --framework flows` scaffold command, and the two
 * CrewAI starters differ in kind (Flow vs Crew) exactly as their two columns do.
 * `crewai-flows` is now declared in `UNPROBED_STARTER_TO_COLUMN`, and the
 * "advertises the same scaffold command" join is asserted below so the identity
 * is guarded by the manifests and docs rather than by this note.
 *
 * The slot stays because the next genuinely-undecided starter needs somewhere
 * honest to sit; it is NOT a place to park a question that the tree answers.
 */
const UNRESOLVED_STARTERS: Readonly<Record<string, string>> = {};

/** Parse the `slug:` values out of the `STARTERS` array in the smoke spec. */
function parseSmokeMatrixSlugs(): string[] {
  const src = readFileSync(STARTER_SPEC_FILE, "utf8");
  const block = src.match(
    /const STARTERS:\s*Starter\[\]\s*=\s*\[([\s\S]+?)\n\];/,
  );
  if (!block || !block[1]) {
    throw new Error(
      "drift parser: could not locate `STARTERS` array in starter-smoke.spec.ts — " +
        "if the spec's shape changed, update the regex in this test.",
    );
  }
  const slugs = Array.from(
    block[1].matchAll(/slug:\s*"([^"]+)"/g),
    (m) => m[1] as string,
  );
  if (slugs.length === 0) {
    throw new Error(
      "drift parser: matched the STARTERS block but found no `slug:` entries.",
    );
  }
  return slugs;
}

/** Parse `jobs.smoke-starter.strategy.matrix.starter` from the CI workflow. */
function parseWorkflowMatrixSlugs(): string[] {
  const src = readFileSync(SMOKE_WORKFLOW_FILE, "utf8");
  const block = src.match(/\n\s*starter:\n((?:\s*-\s*[\w.-]+\n)+)/);
  if (!block || !block[1]) {
    throw new Error(
      "drift parser: could not locate the `starter:` matrix list in " +
        "test_smoke-starter.yml — if the workflow shape changed, update this regex.",
    );
  }
  const slugs = Array.from(
    block[1].matchAll(/-\s*([\w.-]+)/g),
    (m) => m[1] as string,
  );
  if (slugs.length === 0) {
    throw new Error(
      "drift parser: matched the workflow matrix block but parsed zero slugs.",
    );
  }
  return slugs;
}

function readDirNames(dir: string, skip: ReadonlySet<string>): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !skip.has(d.name))
    .map((d) => d.name);
}

/** The on-disk dashboard column slugs = integration manifest directories. */
function readColumnSlugs(): string[] {
  return readDirNames(COLUMNS_DIR, new Set(["_shared"]));
}

/** The on-disk starter template slugs = example integration directories. */
function readStarterDirs(): string[] {
  return readDirNames(STARTERS_DIR, NON_STARTER_EXAMPLE_DIRS);
}

describe("starter-mapping-drift", () => {
  it("parses non-empty source sets (positive control for the fs parsers)", () => {
    // Guards the whole file: every assertion below is of the "no offenders"
    // shape, which passes vacuously if a parser silently returns nothing.
    expect(parseSmokeMatrixSlugs().length).toBeGreaterThan(0);
    expect(parseWorkflowMatrixSlugs().length).toBeGreaterThan(0);
    expect(readColumnSlugs().length).toBeGreaterThan(0);
    expect(readStarterDirs().length).toBeGreaterThan(0);
    expect(STARTER_COLUMNS.size).toBeGreaterThan(0);
  });

  /* ------------------------------------------------------------------ */
  /*  1. The claim that matters: 🚫 must mean "no starter exists".        */
  /* ------------------------------------------------------------------ */

  it("no column rendering 🚫 'Not supported by this framework' has a starter on disk", () => {
    // THE anti-rot assertion. `starterSupport(col) === "unsupported"` is the
    // ONLY input to the 🚫 branch of `buildStarterBadge`, and 🚫 is an
    // outward-facing capability claim about a partner framework. Expectation is
    // derived from `examples/integrations/` — the mapping cannot satisfy this
    // by describing itself.
    //
    // Identity is a SOUND (not complete) starter↔column test: it cannot detect
    // a starter whose directory name differs from its column (that gap is
    // assertion 4's job), but every name it DOES match is a real starter, so a
    // hit here is always a real false claim. It is the reason this test reds on
    // `origin/main` for strands-typescript / claude-sdk-python /
    // claude-sdk-typescript.
    const starters = new Set(readStarterDirs());
    const falseClaims = readColumnSlugs().filter(
      (col) => starterSupport(col) === "unsupported" && starters.has(col),
    );
    expect(
      falseClaims,
      `these dashboard columns render 🚫 "Not supported by this framework" but ` +
        `examples/integrations/<slug> EXISTS for them: ${JSON.stringify(falseClaims)} — ` +
        `the framework IS supported and a starter ships for it. Add each to ` +
        `STARTER_COLUMNS_UNPROBED (live-status.ts) if nothing probes it, or to ` +
        `STARTER_TO_COLUMN + STARTER_COLUMNS if the fleet does.`,
    ).toEqual([]);
  });

  it("every STARTER_COLUMNS_UNPROBED column really has a starter on disk", () => {
    // The converse guard: the "starter exists in-repo; no live probe yet"
    // tooltip is itself a factual claim, so it may not be handed to a column
    // with no starter directory.
    const starters = new Set(readStarterDirs());
    // A column qualifies EITHER by identity (`examples/integrations/<col>`) or
    // via a declared name-drift entry whose KEY is a real starter directory —
    // `crewai-conversational-flows`'s starter is named `crewai-flows`. The
    // drift entry is not self-certifying: its key is checked against the
    // filesystem below, and the column↔starter identity itself is checked
    // against the manifests + docs in the scaffold-command assertion.
    const unprobedColumnHasStarter = (col: string): boolean =>
      starters.has(col) ||
      Object.entries(UNPROBED_STARTER_TO_COLUMN).some(
        ([starterSlug, columnSlug]) =>
          columnSlug === col && starters.has(starterSlug),
      );
    const phantom = [...STARTER_COLUMNS_UNPROBED].filter(
      (col) => !unprobedColumnHasStarter(col),
    );
    expect(
      phantom,
      `STARTER_COLUMNS_UNPROBED claims "starter exists in-repo" for columns ` +
        `with no examples/integrations/<slug> directory: ${JSON.stringify(phantom)}.`,
    ).toEqual([]);
  });

  it("STARTER_COLUMNS and STARTER_COLUMNS_UNPROBED are disjoint", () => {
    const both = [...STARTER_COLUMNS_UNPROBED].filter((c) =>
      STARTER_COLUMNS.has(c),
    );
    expect(
      both,
      `columns claimed as both probed and unprobed: ${JSON.stringify(both)}`,
    ).toEqual([]);
  });

  /* ------------------------------------------------------------------ */
  /*  2. The two CI matrices must not drift apart.                       */
  /* ------------------------------------------------------------------ */

  it("the workflow smoke matrix equals the Playwright STARTERS matrix", () => {
    // `test_smoke-starter.yml` picks WHICH starters CI builds;
    // `starter-smoke.spec.ts` decides which slugs the spec knows about (an
    // unknown slug makes the whole run `test.skip`). They are equal today by
    // hand, not by guard — so a starter added to one and not the other silently
    // does nothing. This makes assertion 4's single-file source set legitimate.
    const workflow = [...parseWorkflowMatrixSlugs()].sort();
    const spec = [...parseSmokeMatrixSlugs()].sort();
    expect(
      workflow,
      "test_smoke-starter.yml's matrix.starter and starter-smoke.spec.ts's " +
        "STARTERS array have drifted — a starter in the workflow but not the " +
        "spec is skipped silently; the reverse is never built.",
    ).toEqual(spec);
  });

  /* ------------------------------------------------------------------ */
  /*  3. Mapping coverage + reality.                                     */
  /* ------------------------------------------------------------------ */

  it("every smoke-matrix starter is either mapped, declared unprobed, or declared unresolved", () => {
    // Three ways to be accounted for, all positive declarations:
    //   - mapped in STARTER_TO_COLUMN (the fleet probes it), or
    //   - an identically-named column in STARTER_COLUMNS_UNPROBED (a starter
    //     exists and CI smoke-tests it, but no live service is probed), or
    //   - parked in UNRESOLVED_STARTERS with a written reason.
    // Silence is not a fourth option.
    const matrixSlugs = parseSmokeMatrixSlugs();
    const unaccounted = matrixSlugs.filter(
      (slug) =>
        !(slug in STARTER_TO_COLUMN) &&
        !(slug in UNPROBED_STARTER_TO_COLUMN) &&
        !STARTER_COLUMNS_UNPROBED.has(slug) &&
        !(slug in UNRESOLVED_STARTERS),
    );
    expect(
      unaccounted,
      `starters in the smoke matrix with no mapping AND no declared reason: ` +
        `${JSON.stringify(unaccounted)} — add them to STARTER_TO_COLUMN ` +
        `(starter-mapping.ts), to STARTER_COLUMNS_UNPROBED (live-status.ts), or ` +
        `to UNRESOLVED_STARTERS in this test WITH a reason.`,
    ).toEqual([]);
  });

  it("every UNRESOLVED_STARTERS entry is a real matrix slug with a written reason", () => {
    const matrixSlugs = new Set(parseSmokeMatrixSlugs());
    const bad = Object.entries(UNRESOLVED_STARTERS)
      .filter(
        ([slug, reason]) => !matrixSlugs.has(slug) || reason.trim() === "",
      )
      .map(([slug]) => slug);
    expect(
      bad,
      `UNRESOLVED_STARTERS entries that are not in the smoke matrix, or carry ` +
        `an empty reason: ${JSON.stringify(bad)} — a starter is parked here only ` +
        `by a positive, readable declaration; drop stale entries.`,
    ).toEqual([]);
  });

  it("no mapped starter is also declared unresolved (mutually exclusive)", () => {
    const both = Object.keys(STARTER_TO_COLUMN).filter(
      (s) => s in UNRESOLVED_STARTERS,
    );
    expect(
      both,
      `starters both mapped and declared unresolved: ${JSON.stringify(both)}`,
    ).toEqual([]);
  });

  it("every mapped starter slug is a real examples/integrations directory", () => {
    const orphans = Object.keys(STARTER_TO_COLUMN).filter(
      (slug) => !existsSync(resolve(STARTERS_DIR, slug)),
    );
    expect(
      orphans,
      `STARTER_TO_COLUMN keys with no examples/integrations/<slug> directory: ` +
        `${JSON.stringify(orphans)} — the starter was renamed or removed.`,
    ).toEqual([]);
  });

  it("every mapped column slug exists as a real dashboard column (manifest dir)", () => {
    const columns = new Set(readColumnSlugs());
    const orphans = Object.entries(STARTER_TO_COLUMN)
      .filter(([, columnSlug]) => !columns.has(columnSlug))
      .map(([starterSlug, columnSlug]) => `${starterSlug}→${columnSlug}`);
    expect(
      orphans,
      `mapped column slugs with no matching showcase/integrations/<slug> ` +
        `manifest directory: ${JSON.stringify(orphans)} — a column was ` +
        `renamed/removed, or the mapping has a typo.`,
    ).toEqual([]);
  });

  it("every STARTER_COLUMNS_UNPROBED column exists as a real dashboard column", () => {
    const columns = new Set(readColumnSlugs());
    const orphans = [...STARTER_COLUMNS_UNPROBED].filter(
      (col) => !columns.has(col),
    );
    expect(
      orphans,
      `STARTER_COLUMNS_UNPROBED entries with no showcase/integrations/<slug> ` +
        `directory: ${JSON.stringify(orphans)}.`,
    ).toEqual([]);
  });

  /* ------------------------------------------------------------------ */
  /*  4b. A column and a starter that scaffold the SAME template are the  */
  /*      same integration — so the column may not render 🚫.             */
  /* ------------------------------------------------------------------ */

  it("no column renders 🚫 when a real starter advertises the same `init --framework` command", () => {
    // NON-CIRCULAR by construction. Both sides are prose surfaces this mapping
    // does not generate:
    //   - `showcase/integrations/<column>/manifest.yaml` — the column's own
    //     "CLI Start Command".
    //   - `showcase/shell-docs/.../integrations/<dir>/quickstart.mdx` — the
    //     docs page, whose DIRECTORY is named for the starter template.
    // When both advertise the same `--framework <flag>` and
    // `examples/integrations/<dir>` exists, the column and the starter scaffold
    // ONE template, so the column demonstrably has a starter and the 🚫
    // "Not supported by this framework" capability claim is false.
    //
    // This is what resolved `crewai-conversational-flows` (manifest) ↔
    // `crewai-flows` (docs dir + starter dir), both `--framework flows`, while
    // `crewai-crews` advertises a different flag and stays a separate column.
    const starters = new Set(readStarterDirs());
    const docsFrameworkToStarter = new Map<string, string>();
    for (const dir of readdirSync(DOCS_INTEGRATIONS_DIR, {
      withFileTypes: true,
    }).filter((d) => d.isDirectory())) {
      const quickstart = resolve(
        DOCS_INTEGRATIONS_DIR,
        dir.name,
        "quickstart.mdx",
      );
      if (!existsSync(quickstart) || !starters.has(dir.name)) continue;
      const flag = readFileSync(quickstart, "utf8").match(
        /init\s+--framework\s+([\w.-]+)/,
      );
      if (flag?.[1]) docsFrameworkToStarter.set(flag[1], dir.name);
    }

    const falseClaims: string[] = [];
    for (const col of readColumnSlugs()) {
      const manifest = resolve(COLUMNS_DIR, col, "manifest.yaml");
      if (!existsSync(manifest)) continue;
      const flag = readFileSync(manifest, "utf8").match(
        /init\s+--framework\s+([\w.-]+)/,
      );
      const starter = flag?.[1] && docsFrameworkToStarter.get(flag[1]);
      if (starter && starterSupport(col) === "unsupported") {
        falseClaims.push(`${col}→${starter} (--framework ${flag?.[1]})`);
      }
    }

    // Positive control: the join must actually find pairings, or every
    // assertion above passes vacuously on a docs/manifest reshuffle.
    expect(
      docsFrameworkToStarter.size,
      "the `init --framework` join found NO starter-backed docs pages — the " +
        "manifest or quickstart shape changed and this assertion is now vacuous.",
    ).toBeGreaterThan(0);

    expect(
      falseClaims,
      `these dashboard columns render 🚫 "Not supported by this framework" but ` +
        `advertise the SAME \`npx copilotkit init --framework\` command as a real ` +
        `starter under examples/integrations/: ${JSON.stringify(falseClaims)} — ` +
        `they are the same integration under two names. Declare the pairing in ` +
        `UNPROBED_STARTER_TO_COLUMN (starter-mapping.ts) + STARTER_COLUMNS_UNPROBED ` +
        `(live-status.ts), or in STARTER_TO_COLUMN + STARTER_COLUMNS if the fleet ` +
        `probes it.`,
    ).toEqual([]);
  });

  /* ------------------------------------------------------------------ */
  /*  4. NON_STARTER_EXAMPLE_DIRS may not be used to hide a starter.     */
  /* ------------------------------------------------------------------ */

  it("no NON_STARTER_EXAMPLE_DIRS entry is in the smoke matrix or has a column", () => {
    // Without this, the cheapest repair for a red assertion 1 is to add the
    // offending name to NON_STARTER_EXAMPLE_DIRS. A directory that CI smoke-
    // tests, or that has a dashboard column, is a starter by definition and
    // cannot be parked there.
    const matrixSlugs = new Set(parseSmokeMatrixSlugs());
    const columns = new Set(readColumnSlugs());
    const misfiled = [...NON_STARTER_EXAMPLE_DIRS].filter(
      (name) => matrixSlugs.has(name) || columns.has(name),
    );
    expect(
      misfiled,
      `NON_STARTER_EXAMPLE_DIRS names that ARE starters (in the CI smoke matrix ` +
        `or owning a dashboard column): ${JSON.stringify(misfiled)} — this list is ` +
        `for non-starter examples only, never a way to silence assertion 1.`,
    ).toEqual([]);
  });

  it("NON_STARTER_EXAMPLE_DIRS has no stale entries", () => {
    const onDisk = new Set(
      readdirSync(STARTERS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name),
    );
    const stale = [...NON_STARTER_EXAMPLE_DIRS].filter((n) => !onDisk.has(n));
    expect(
      stale,
      `NON_STARTER_EXAMPLE_DIRS names that no longer exist under ` +
        `examples/integrations/: ${JSON.stringify(stale)}.`,
    ).toEqual([]);
  });
});
