import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { execOptsFor } from "./test-cleanup";
import { SCRIPTS_DIR, SHELL_DATA_DIR } from "./paths";

// `generate-registry.ts` writes to showcase/shell/src/data/registry.json and
// constraints.json. Both are gitignored, so leaked writes don't dirty the
// working tree; we no longer snapshot/restore them. Each test invokes the
// generator itself and reads the fresh output.

const EXEC_OPTS = execOptsFor(SCRIPTS_DIR);

/** Invoke the generator via argv form — no shell parser involvement. Matches
 *  the hygiene principle in create-integration.test.ts. A prior revision
 *  used `execSync(\`npx tsx ${SCRIPT_PATH}\`)` with an interpolated path,
 *  which is a landmine even when the constant is safe today. */
function runGenerator(): string {
  const out = execFileSync("npx", ["tsx", "generate-registry.ts"], EXEC_OPTS);
  return out.toString();
}

// The generator uses __dirname-relative paths, so we test it via the actual
// script against the real showcase directory, using the existing
// langgraph-python package.

describe("Registry Generator", () => {
  it("generates registry.json from existing packages", async () => {
    const stdout = runGenerator();

    expect(stdout).toContain("Generating integration registry");
    expect(stdout).toContain("LangGraph (Python)");

    const registryPath = path.join(SHELL_DATA_DIR, "registry.json");
    expect(fs.existsSync(registryPath)).toBe(true);

    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    expect(registry.generated_at).toBeDefined();
    expect(registry.feature_registry).toBeDefined();
    expect(registry.feature_registry.features.length).toBeGreaterThan(0);
    expect(registry.integrations.length).toBeGreaterThan(0);

    const langgraph = registry.integrations.find(
      (i: any) => i.slug === "langgraph-python",
    );
    expect(langgraph).toBeDefined();
    expect(langgraph.name).toBe("LangGraph (Python)");
    expect(langgraph.category).toBe("popular");
    expect(langgraph.language).toBe("python");
    // Count matches current manifest after #4029 scrubbed open-gen-ui (5→4
    // GenUI strategies).
    expect(langgraph.features.length).toBe(30);
    expect(langgraph.demos.length).toBe(30);
  });

  it("sorts integrations by sort_order", () => {
    // Run the generator explicitly — afterEach restores shell/src/data JSONs
    // to HEAD between tests, so we can't rely on test 1's side effect to
    // leave registry.json populated. Mirrors the `runBundlerAndRead` pattern
    // in bundle-demo-content.test.ts tests 2-5.
    runGenerator();

    const registryPath = path.join(SHELL_DATA_DIR, "registry.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));

    // langgraph-python (sort_order: 10) should come before mastra (sort_order: 20)
    const lgIdx = registry.integrations.findIndex(
      (i: any) => i.slug === "langgraph-python",
    );
    const mastraIdx = registry.integrations.findIndex(
      (i: any) => i.slug === "mastra",
    );
    expect(lgIdx).toBeLessThan(mastraIdx);

    // Verify overall order is non-decreasing by sort_order
    for (let i = 1; i < registry.integrations.length; i++) {
      const prevOrder = registry.integrations[i - 1].sort_order ?? 999;
      const currOrder = registry.integrations[i].sort_order ?? 999;
      expect(currOrder).toBeGreaterThanOrEqual(prevOrder);
    }
  });

  it("validates feature IDs against the registry", async () => {
    const featureRegistryPath = path.resolve(
      SCRIPTS_DIR,
      "..",
      "shared",
      "feature-registry.json",
    );
    const featureRegistry = JSON.parse(
      fs.readFileSync(featureRegistryPath, "utf-8"),
    );
    const validIds = new Set(featureRegistry.features.map((f: any) => f.id));

    const manifestPath = path.resolve(
      SCRIPTS_DIR,
      "..",
      "packages",
      "langgraph-python",
      "manifest.yaml",
    );
    const yaml = await import("yaml");
    const manifest = yaml.parse(fs.readFileSync(manifestPath, "utf-8"));

    for (const featureId of manifest.features) {
      expect(validIds.has(featureId)).toBe(true);
    }

    for (const demo of manifest.demos) {
      expect(validIds.has(demo.id)).toBe(true);
    }
  });
});
