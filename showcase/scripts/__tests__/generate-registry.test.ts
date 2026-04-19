import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const SCRIPT_PATH = path.resolve(__dirname, "..", "generate-registry.ts");

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "showcase-test-"));
}

function setupTestEnv(tmpDir: string) {
  const packagesDir = path.join(tmpDir, "packages");
  const sharedDir = path.join(tmpDir, "shared");
  const shellDir = path.join(tmpDir, "shell", "src", "data");

  fs.mkdirSync(packagesDir, { recursive: true });
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.mkdirSync(shellDir, { recursive: true });

  // Copy shared files
  const realShared = path.resolve(__dirname, "..", "..", "shared");
  fs.copyFileSync(
    path.join(realShared, "feature-registry.json"),
    path.join(sharedDir, "feature-registry.json"),
  );
  fs.copyFileSync(
    path.join(realShared, "manifest.schema.json"),
    path.join(sharedDir, "manifest.schema.json"),
  );

  return { packagesDir, sharedDir, shellDir };
}

function writeManifest(packagesDir: string, slug: string, manifest: string) {
  const dir = path.join(packagesDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.yaml"), manifest);
}

function runGenerator(tmpDir: string): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const { execSync } = require("child_process");
  try {
    const stdout = execSync(`npx tsx ${SCRIPT_PATH}`, {
      cwd: path.join(tmpDir, "scripts-placeholder"),
      env: {
        ...process.env,
        // Override the paths by running from the right context
      },
      encoding: "utf-8",
      timeout: 15000,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return {
      code: e.status || 1,
      stdout: e.stdout || "",
      stderr: e.stderr || "",
    };
  }
}

// Since the generator uses __dirname-relative paths, we test it via the actual script
// against the real showcase directory, using the existing langgraph-python package.

describe("Registry Generator", () => {
  it("generates registry.json from existing packages", async () => {
    const { execSync } = await import("child_process");
    const scriptsDir = path.resolve(__dirname, "..");

    const stdout = execSync("npx tsx generate-registry.ts", {
      cwd: scriptsDir,
      encoding: "utf-8",
      timeout: 15000,
    });

    expect(stdout).toContain("Generating integration registry");
    expect(stdout).toContain("LangGraph (Python)");

    const registryPath = path.resolve(
      scriptsDir,
      "..",
      "shell",
      "src",
      "data",
      "registry.json",
    );
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
    // Assert structural shape rather than a fixed count — demo fleet
    // grows over time (A2UI split, tool-rendering 3-way progression,
    // chat-customization-css, etc.). A minimum bound catches regressions
    // (e.g. registry collapse to zero) without pinning the count.
    expect(langgraph.features.length).toBeGreaterThanOrEqual(20);
    expect(langgraph.demos.length).toBe(langgraph.features.length);
  });

  it("sorts integrations by sort_order", () => {
    const registryPath = path.resolve(
      __dirname,
      "..",
      "..",
      "shell",
      "src",
      "data",
      "registry.json",
    );
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
      __dirname,
      "..",
      "..",
      "shared",
      "feature-registry.json",
    );
    const featureRegistry = JSON.parse(
      fs.readFileSync(featureRegistryPath, "utf-8"),
    );
    const validIds = new Set(featureRegistry.features.map((f: any) => f.id));

    const manifestPath = path.resolve(
      __dirname,
      "..",
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
