import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { FileSnapshotRestorer, execOptsFor } from "./test-cleanup";
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

const EXEC_OPTS = execOptsFor(SCRIPTS_DIR);

function runGenerator(): string {
  const out = execFileSync("npx", ["tsx", "generate-registry.ts"], EXEC_OPTS);
  return out.toString();
}

function readCatalog(dir: string = SHELL_DATA_DIR): any {
  const catalogPath = path.join(dir, "catalog.json");
  return JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
}

beforeAll(() => {
  runGenerator();
  dataRestorer.snapshot();
  if (dataRestorer.snapshotMap.size === 0) {
    throw new Error(
      `generate-catalog.test.ts: data snapshot is empty. Expected generated` +
        ` files at:\n` +
        DATA_FILES.map((p) => `  ${p}`).join("\n"),
    );
  }
});
afterEach(() => dataRestorer.restore());
afterAll(() => dataRestorer.restore());

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

  it("cross-join produces 756 cells (42 features x 18 integrations); metadata.total_cells excludes docs-only", () => {
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

    expect(integrated.length).toBe(756); // 42 features x 18 integrations
    expect(starters.length).toBe(0);
    expect(catalog.cells.length).toBe(756);
    // total_cells excludes docs-only features (currently 1 feature x 18 integrations = 18)
    expect(catalog.metadata.total_cells).toBe(738);
    expect(catalog.metadata.docs_only).toBe(18);
  });

  it("LGP has 42 cells: 35 wired + 1 stub + 6 unshipped", () => {
    runGenerator();
    const catalog = readCatalog();

    const lgpCells = catalog.cells.filter(
      (c: any) =>
        c.integration === "langgraph-python" &&
        c.manifestation === "integrated",
    );
    expect(lgpCells.length).toBe(42); // One cell per feature

    const wired = lgpCells.filter((c: any) => c.status === "wired");
    const stub = lgpCells.filter((c: any) => c.status === "stub");
    const unshipped = lgpCells.filter((c: any) => c.status === "unshipped");

    expect(wired.length).toBe(35);
    expect(stub.length).toBe(1);
    expect(unshipped.length).toBe(6);
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
    expect(crewaiWired.length).toBeGreaterThanOrEqual(30);

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
    expect(catalog.metadata.total_cells).toBe(738);

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
    expect(catalog.metadata.docs_only).toBe(18);
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
    expect(lgpAgenticChat.feature_name).toBe("Pre-Built CopilotChat");
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
