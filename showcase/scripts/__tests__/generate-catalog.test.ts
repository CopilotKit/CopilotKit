import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import {
  FileSnapshotRestorer,
  acquireGeneratedDataLock,
  execOptsFor,
  withGeneratedDataLock,
} from "./test-cleanup";
import { SCRIPTS_DIR, SHELL_DATA_DIR } from "./paths";

// catalog.json is emitted alongside registry.json in all 4 output dirs.
// We snapshot the shell output dir to avoid leaking generated files.
const SHELL_DASHBOARD_DATA_DIR = path.resolve(
  SCRIPTS_DIR,
  "..",
  "shell-dashboard",
  "src",
  "data",
);

const DATA_FILES = [
  path.join(SHELL_DATA_DIR, "registry.json"),
  path.join(SHELL_DATA_DIR, "constraints.json"),
  path.join(SHELL_DATA_DIR, "catalog.json"),
  path.join(SHELL_DASHBOARD_DATA_DIR, "registry.json"),
  path.join(SHELL_DASHBOARD_DATA_DIR, "catalog.json"),
];
const dataRestorer = new FileSnapshotRestorer(DATA_FILES);
let releaseGeneratedDataLock: (() => void) | undefined;

const EXEC_OPTS = execOptsFor(SCRIPTS_DIR);

/**
 * `env` overrides are layered on top of the ambient environment, so the
 * DEFAULT call inherits CI's environment exactly as before — which is what
 * keeps the flag-off case a genuine test of the default build rather than of a
 * scrubbed one.
 */
function runGenerator(env?: Record<string, string>): string {
  const out = execFileSync("npx", ["tsx", "generate-registry.ts"], {
    ...EXEC_OPTS,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  return out.toString();
}

function readCatalog(dir: string = SHELL_DATA_DIR): any {
  const catalogPath = path.join(dir, "catalog.json");
  return JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
}

beforeAll(() =>
  withGeneratedDataLock(() => {
    runGenerator();
    dataRestorer.snapshot();
    if (dataRestorer.snapshotMap.size === 0) {
      throw new Error(
        `generate-catalog.test.ts: data snapshot is empty. Expected generated` +
          ` files at:\n` +
          DATA_FILES.map((p) => `  ${p}`).join("\n"),
      );
    }
  }),
);

beforeEach(() => {
  const release = acquireGeneratedDataLock();
  try {
    dataRestorer.restore();
    releaseGeneratedDataLock = release;
  } catch (err) {
    release();
    throw err;
  }
});

afterEach(() => {
  try {
    dataRestorer.restore();
  } finally {
    releaseGeneratedDataLock?.();
    releaseGeneratedDataLock = undefined;
  }
});

afterAll(() => withGeneratedDataLock(() => dataRestorer.restore()));

describe("Catalog Generator", () => {
  it("output shape matches CatalogData: { metadata, cells }", () => {
    runGenerator();
    const catalog = readCatalog();

    // Top-level keys must be exactly { metadata, cells }
    expect(Object.keys(catalog).sort()).toEqual(["cells", "metadata"]);

    // metadata must have exactly the CatalogMetadata keys
    expect(Object.keys(catalog.metadata).sort()).toEqual([
      "docs_only",
      "generated_at",
      "reference",
      "stub",
      "total_cells",
      "unshipped",
      "unsupported",
      "wired",
    ]);

    // No legacy top-level keys
    expect(catalog).not.toHaveProperty("generated_at");
    expect(catalog).not.toHaveProperty("reference_integration");
    expect(catalog).not.toHaveProperty("summary");
  });

  it("emits catalog.json to all output dirs", () => {
    runGenerator();

    const outputDirs = [
      path.resolve(SCRIPTS_DIR, "..", "shell", "src", "data"),
      path.resolve(SCRIPTS_DIR, "..", "shell-docs", "src", "data"),
      path.resolve(SCRIPTS_DIR, "..", "shell-dojo", "src", "data"),
      path.resolve(SCRIPTS_DIR, "..", "shell-dashboard", "src", "data"),
    ];

    for (const dir of outputDirs) {
      const catalogPath = path.join(dir, "catalog.json");
      expect(
        fs.existsSync(catalogPath),
        `catalog.json missing from ${dir}`,
      ).toBe(true);
    }
  });

  it("cross-join produces 1050 cells (50 features x 21 integrations); metadata.total_cells excludes docs-only", () => {
    runGenerator();
    const catalog = readCatalog();

    expect(catalog.cells).toBeDefined();
    expect(Array.isArray(catalog.cells)).toBe(true);

    const integrated = catalog.cells.filter(
      (c: any) => c.manifestation === "integrated",
    );
    const starters = catalog.cells.filter(
      (c: any) => c.manifestation === "starter",
    );

    // 50 features × 21 integrations = 1050 cells. The catalog emits cells
    // uniformly for all (integration × feature) pairs; deprecated-feature
    // visibility is controlled at the dashboard layer via the "Show
    // deprecated" toggle in feature-grid.tsx so the catalog stays
    // shape-stable. The 50 includes 2 byoc legacy IDs (`byoc-hashbrown`,
    // `byoc-json-render`) plus their renamed aliases (`declarative-*`)
    // that langgraph-python uses for the visible URL slugs, the
    // `a2ui-recovery` feature (wired for google-adk + langgraph-{python,
    // fastapi,typescript} + strands{,-typescript}; unshipped elsewhere),
    // and the 3 Mastra-only features (`background-agents`,
    // `observational-memory`, `browser-use`; unshipped for every other
    // integration).
    expect(integrated.length).toBe(1050);
    // Step 5 is gated by SHOWCASE_STARTER_CELLS, which is UNSET in CI — this
    // case pins the DEFAULT build. Its flag-on sibling is directly below.
    expect(starters.length).toBe(0);
    expect(catalog.cells.length).toBe(1050);
    // total_cells excludes docs-only features (currently 1 feature x 21 integrations = 21)
    expect(catalog.metadata.total_cells).toBe(1029);
    expect(catalog.metadata.docs_only).toBe(21);
  });

  // The flag-on sibling. Its ONLY job is the pairing: the starter cells appear
  // in `cells`, and the ROLLUPS do not move. Those two rollup assertions are
  // the whole point of Step 6's starter exclusion — `total_cells` is the
  // single most-read number on the dashboard, and starter cells carry
  // `feature: null` + `status: "wired"`, so the docs-only predicate ADMITS
  // them and would raise it by 21, unflagged.
  //
  // MUTATION THAT REDS THIS CASE: drop `c.manifestation !== "starter"` from
  // `countableCells` in `catalog-flatten.ts` Step 6 — `total_cells` becomes
  // 1050 and `wired` moves by the 16 non-`supported:false` columns.
  it("with SHOWCASE_STARTER_CELLS=1: 21 starter cells appear and the rollups do NOT move", () => {
    runGenerator();
    const flagOff = readCatalog();

    runGenerator({ SHOWCASE_STARTER_CELLS: "1" });
    const flagOn = readCatalog();

    const starters = flagOn.cells.filter(
      (c: any) => c.manifestation === "starter",
    );
    // One cell per column, all 21 — including the 5 `supported: false` ones,
    // each of which mints exactly one "not supported" cell rather than nothing.
    expect(starters.length).toBe(21);
    expect(flagOn.cells.length).toBe(1071);

    // Status is DERIVED from the block, not hardcoded "wired".
    expect(starters.filter((c: any) => c.status === "unsupported").length).toBe(
      5,
    );
    expect(starters.filter((c: any) => c.status === "wired").length).toBe(16);
    // The axis's uniform ceiling, on every starter cell.
    expect(new Set(starters.map((c: any) => c.max_depth))).toEqual(
      new Set([3]),
    );
    // Every starter cell is feature-null, which is what keeps it out of the
    // `page-stats` health band and depth histogram.
    expect(starters.every((c: any) => c.feature === null)).toBe(true);

    // BYTE-IDENTICAL rollups across the flag.
    expect(flagOn.metadata.total_cells).toBe(flagOff.metadata.total_cells);
    expect(flagOn.metadata.wired).toBe(flagOff.metadata.wired);
    expect(flagOn.metadata.stub).toBe(flagOff.metadata.stub);
    expect(flagOn.metadata.unshipped).toBe(flagOff.metadata.unshipped);
    expect(flagOn.metadata.unsupported).toBe(flagOff.metadata.unsupported);
    expect(flagOn.metadata.docs_only).toBe(flagOff.metadata.docs_only);
    // And the same absolute numbers the flag-off case pins, restated so a
    // drift in BOTH modes cannot pass by moving together.
    expect(flagOn.metadata.total_cells).toBe(1029);
    expect(flagOn.metadata.docs_only).toBe(21);
  });

  it("LGP has 50 cells: 37 wired + 1 stub + 10 unshipped + 2 unsupported (deprecated features included; dashboard hides them by default)", () => {
    runGenerator();
    const catalog = readCatalog();

    const lgpCells = catalog.cells.filter(
      (c: any) =>
        c.integration === "langgraph-python" &&
        c.manifestation === "integrated",
    );
    // 46 = 37 LGP-declared features + 2 quarantined interrupt features
    // (gen-ui-interrupt / interrupt-headless, now in
    // `not_supported_features`) + 4 deprecated features + 2 legacy
    // `byoc-*` aliases (LGP declares `declarative-{hashbrown,json-render}`
    // for the visible URL slugs while every other integration still
    // declares the legacy `byoc-*` IDs; the catalog emits cells for both
    // since both are in the registry, and the LGP cells for the legacy
    // IDs are `unshipped` because LGP's manifest only declares the
    // renamed form) + 1 unshipped for `threadid-frontend-tool-roundtrip`
    // (built-in-agent-only feature; LGP doesn't declare it). `a2ui-recovery`
    // is now WIRED for LGP (the recovery demo shipped across langgraph +
    // strands), so it no longer counts toward unshipped.
    // Dashboard's "Show deprecated" toggle hides deprecated rows by default.
    // +3 unshipped for the Mastra-only features (`background-agents`,
    // `observational-memory`, `browser-use`) that LGP does not declare,
    // taking unshipped 7 -> 10 and the LGP cell total 47 -> 50.
    expect(lgpCells.length).toBe(50);

    const wired = lgpCells.filter((c: any) => c.status === "wired");
    const stub = lgpCells.filter((c: any) => c.status === "stub");
    const unshipped = lgpCells.filter((c: any) => c.status === "unshipped");
    const unsupported = lgpCells.filter((c: any) => c.status === "unsupported");

    // The interrupt-pill quarantine moved gen-ui-interrupt / interrupt-headless
    // (both previously `wired`) into `not_supported_features`, so they now
    // surface as `unsupported`: wired drops 38 -> 36, unsupported rises 0 -> 2.
    // unshipped rises 6 -> 7 with threadid-frontend-tool-roundtrip. Then the
    // a2ui-recovery demo shipped for LGP (wired), so wired rises 36 -> 37 and
    // unshipped drops 8 -> 7.
    expect(wired.length).toBe(37);
    expect(stub.length).toBe(1);
    expect(unshipped.length).toBe(10);
    expect(unsupported.length).toBe(2);
  });

  it("stub detection: LGP/cli-start has stub status (demo exists, no route)", () => {
    runGenerator();
    const catalog = readCatalog();

    const cliStartCell = catalog.cells.find(
      (c: any) => c.id === "langgraph-python/cli-start",
    );
    expect(cliStartCell).toBeDefined();
    expect(cliStartCell.status).toBe("stub");
    expect(cliStartCell.manifestation).toBe("integrated");
  });

  it("parity tier: reference auto-detected as integration with the most wired features (alphabetical tie-break)", () => {
    runGenerator();
    const catalog = readCatalog();

    // After the showcase-fill-186 blitz, multiple integrations match the
    // historical LangGraph-Python wired-feature count. The auto-detection
    // tie-breaks alphabetically — `langgraph-fastapi` precedes
    // `langgraph-python` among the tied set, so it now wins the reference
    // slot. Cells under the elected reference must carry parity_tier =
    // "reference".
    const ref = catalog.metadata.reference;
    expect(ref).toBeTruthy();

    const refCells = catalog.cells.filter(
      (c: any) => c.integration === ref && c.manifestation === "integrated",
    );
    for (const cell of refCells) {
      expect(cell.parity_tier).toBe("reference");
    }
  });

  it("parity tier: crewai-crews wired cells render at_parity or partial against the elected reference", () => {
    runGenerator();
    const catalog = readCatalog();

    const crewaiCells = catalog.cells.filter(
      (c: any) =>
        c.integration === "crewai-crews" && c.manifestation === "integrated",
    );
    const crewaiWired = crewaiCells.filter((c: any) => c.status === "wired");
    // crewai-crews wired count moved with the blitz; assert the lower bound
    // (the partial tier requires intersection >= 3 with the reference's
    // wired set, which crewai-crews comfortably exceeds post-blitz).
    // Was 30; now 29 because `multimodal` moved from `features` to
    // `not_supported_features` in this integration's manifest (no `/multimodal`
    // route exists on its agent server — see the note there), so that cell is
    // `unsupported` rather than `wired`. This bound only guards against the
    // wired set collapsing below what the partial tier needs, so tracking the
    // manifest here is correct.
    expect(crewaiWired.length).toBeGreaterThanOrEqual(29);

    const tier = crewaiCells[0].parity_tier;
    expect(["at_parity", "partial"]).toContain(tier);
    for (const cell of crewaiCells) {
      expect(cell.parity_tier).toBe(tier);
    }
  });

  it("metadata counts are correct (docs-only excluded from breakdown)", () => {
    runGenerator();
    const catalog = readCatalog();

    expect(catalog.metadata).toBeDefined();
    // total_cells excludes docs-only features
    expect(catalog.metadata.total_cells).toBe(1029);

    // Headline counts exclude docs-only cells; must sum to total_cells.
    expect(
      catalog.metadata.wired +
        catalog.metadata.stub +
        catalog.metadata.unshipped +
        catalog.metadata.unsupported,
    ).toBe(catalog.metadata.total_cells);
    // docs_only + headline counts = total cells in the array
    expect(
      catalog.metadata.wired +
        catalog.metadata.stub +
        catalog.metadata.unshipped +
        catalog.metadata.unsupported +
        catalog.metadata.docs_only,
    ).toBe(catalog.cells.length);
    expect(catalog.metadata.wired).toBeGreaterThanOrEqual(490);
    expect(catalog.metadata.unsupported).toBeGreaterThanOrEqual(0);
    expect(catalog.metadata.docs_only).toBe(21);
  });

  it("max_depth: D4 for wired/stub cells, D0 for unshipped/unsupported", () => {
    runGenerator();
    const catalog = readCatalog();

    const wired = catalog.cells.filter((c: any) => c.status === "wired");
    const stub = catalog.cells.filter((c: any) => c.status === "stub");
    const unshipped = catalog.cells.filter(
      (c: any) => c.status === "unshipped",
    );
    const unsupported = catalog.cells.filter(
      (c: any) => c.status === "unsupported",
    );

    for (const cell of wired) {
      expect(cell.max_depth).toBe(4);
    }
    for (const cell of stub) {
      expect(cell.max_depth).toBe(4);
    }
    for (const cell of unshipped) {
      expect(cell.max_depth).toBe(0);
    }
    for (const cell of unsupported) {
      // Unsupported shares max_depth=0 with unshipped — neither has probes.
      expect(cell.max_depth).toBe(0);
    }
  });

  it("every integrated cell has a category from feature-registry.json", () => {
    runGenerator();
    const catalog = readCatalog();

    const featureRegistryPath = path.resolve(
      SCRIPTS_DIR,
      "..",
      "shared",
      "feature-registry.json",
    );
    const featureRegistry = JSON.parse(
      fs.readFileSync(featureRegistryPath, "utf-8"),
    );
    const validCategories = new Set(
      featureRegistry.categories.map((c: any) => c.id),
    );

    const integrated = catalog.cells.filter(
      (c: any) => c.manifestation === "integrated",
    );
    for (const cell of integrated) {
      expect(cell.category).toBeDefined();
      expect(
        validCategories.has(cell.category),
        `Invalid category "${cell.category}" for cell ${cell.id}`,
      ).toBe(true);
    }
  });

  it("metadata.generated_at timestamp is present and recent", () => {
    runGenerator();
    const catalog = readCatalog();

    expect(catalog.metadata.generated_at).toBeDefined();
    const genTime = new Date(catalog.metadata.generated_at).getTime();
    const now = Date.now();
    // Should be within the last 60 seconds
    expect(now - genTime).toBeLessThan(60000);
  });

  it("integrated cells have human-readable display names from registries", () => {
    runGenerator();
    const catalog = readCatalog();

    // LGP cell for agentic-chat should have display names, not slugs
    const lgpAgenticChat = catalog.cells.find(
      (c: any) => c.id === "langgraph-python/agentic-chat",
    );
    expect(lgpAgenticChat).toBeDefined();
    expect(lgpAgenticChat.integration_name).toBe("LangGraph (Python)");
    expect(lgpAgenticChat.feature_name).toBe("Pre-Built: CopilotChat");
    expect(lgpAgenticChat.category_name).toBe("Chat & UI");

    // All integrated cells must have non-null display names
    const integrated = catalog.cells.filter(
      (c: any) => c.manifestation === "integrated",
    );
    for (const cell of integrated) {
      expect(
        typeof cell.integration_name,
        `${cell.id} missing integration_name`,
      ).toBe("string");
      expect(typeof cell.feature_name, `${cell.id} missing feature_name`).toBe(
        "string",
      );
      expect(
        typeof cell.category_name,
        `${cell.id} missing category_name`,
      ).toBe("string");
    }
  });

  it("cell IDs are unique", () => {
    runGenerator();
    const catalog = readCatalog();

    const ids = catalog.cells.map((c: any) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
