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
      "generated_at",
      "reference",
      "stub",
      "total_cells",
      "unshipped",
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

  it("cross-join produces 663 cells (646 integrated + 17 starters)", () => {
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

    expect(integrated.length).toBe(646); // 38 features x 17 integrations
    expect(starters.length).toBe(17);
    expect(catalog.cells.length).toBe(663);
    expect(catalog.metadata.total_cells).toBe(663);
  });

  it("LGP has status=wired for its 32 features (31 wired + 1 stub), unshipped for the other 6", () => {
    runGenerator();
    const catalog = readCatalog();

    const lgpCells = catalog.cells.filter(
      (c: any) =>
        c.integration === "langgraph-python" &&
        c.manifestation === "integrated",
    );
    expect(lgpCells.length).toBe(38); // One cell per feature

    const wired = lgpCells.filter((c: any) => c.status === "wired");
    const stub = lgpCells.filter((c: any) => c.status === "stub");
    const unshipped = lgpCells.filter((c: any) => c.status === "unshipped");

    // LGP has 32 features in manifest: 31 with routes (wired) + 1 without route (stub = cli-start)
    expect(wired.length).toBe(31);
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

  it("parity tier: LGP = reference (most wired features)", () => {
    runGenerator();
    const catalog = readCatalog();

    expect(catalog.metadata.reference).toBe("langgraph-python");

    // All LGP integrated cells should have parity_tier = "reference"
    const lgpCells = catalog.cells.filter(
      (c: any) =>
        c.integration === "langgraph-python" &&
        c.manifestation === "integrated",
    );
    for (const cell of lgpCells) {
      expect(cell.parity_tier).toBe("reference");
    }
  });

  it("parity tier: 8-feature integration = partial (intersection >= 3 with reference)", () => {
    runGenerator();
    const catalog = readCatalog();

    // All 16 non-LGP integrations have 8 features, all in LGP's set
    // intersection with reference = 8 >= 3 => partial
    const crewaiCells = catalog.cells.filter(
      (c: any) =>
        c.integration === "crewai-crews" && c.manifestation === "integrated",
    );
    const crewaiWired = crewaiCells.filter((c: any) => c.status === "wired");
    expect(crewaiWired.length).toBe(8);

    // All cells for crewai should have parity_tier = "partial"
    for (const cell of crewaiCells) {
      expect(cell.parity_tier).toBe("partial");
    }
  });

  it("metadata counts are correct", () => {
    runGenerator();
    const catalog = readCatalog();

    expect(catalog.metadata).toBeDefined();
    expect(catalog.metadata.total_cells).toBe(663);

    // Wired = LGP 31 wired + 16 * 8 wired + 17 starters = 31 + 128 + 17 = 176
    // Stub = 1 (LGP cli-start)
    // Unshipped = 6 (LGP) + 16 * 30 (other integrations) = 6 + 480 = 486
    // Total integrated = 159 + 1 + 486 = 646
    // Starters (all wired) = 17
    // So wired = 159 + 17 = 176, stub = 1, unshipped = 486
    expect(catalog.metadata.wired).toBe(176);
    expect(catalog.metadata.stub).toBe(1);
    expect(catalog.metadata.unshipped).toBe(486);
  });

  it("max_depth: D4 for wired/stub cells, D0 for unshipped", () => {
    runGenerator();
    const catalog = readCatalog();

    const wired = catalog.cells.filter((c: any) => c.status === "wired");
    const stub = catalog.cells.filter((c: any) => c.status === "stub");
    const unshipped = catalog.cells.filter(
      (c: any) => c.status === "unshipped",
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

  it("starter cells have correct shape", () => {
    runGenerator();
    const catalog = readCatalog();

    const starters = catalog.cells.filter(
      (c: any) => c.manifestation === "starter",
    );
    expect(starters.length).toBe(17);

    for (const cell of starters) {
      expect(cell.id).toMatch(/^starter\//);
      expect(cell.manifestation).toBe("starter");
      expect(cell.feature).toBeNull();
      expect(cell.feature_name).toBeNull();
      expect(cell.category).toBeNull();
      expect(cell.category_name).toBeNull();
      expect(cell.status).toBe("wired");
      expect(cell.max_depth).toBe(4);
      expect(cell.integration).toBeDefined();
      expect(cell.integration_name).toBeDefined();
      expect(typeof cell.integration_name).toBe("string");
      expect(cell.integration_name.length).toBeGreaterThan(0);
      expect(cell.parity_tier).toBeDefined();
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
