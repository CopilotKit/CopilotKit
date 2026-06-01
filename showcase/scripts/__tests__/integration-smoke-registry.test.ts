import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { FileSnapshotRestorer, execOptsFor } from "./test-cleanup";
import { SCRIPTS_DIR, SHELL_DATA_DIR } from "./paths";

// Ensure registry.json exists (it's generated, gitignored).
const DATA_FILES = [
  path.join(SHELL_DATA_DIR, "registry.json"),
  path.join(SHELL_DATA_DIR, "constraints.json"),
];
const dataRestorer = new FileSnapshotRestorer(DATA_FILES);
const EXEC_OPTS = execOptsFor(SCRIPTS_DIR);

function runGenerator(): string {
  return execFileSync(
    "npx",
    ["tsx", "generate-registry.ts"],
    EXEC_OPTS,
  ).toString();
}

let registry: {
  integrations: Array<{
    slug: string;
    name: string;
    backend_url: string;
    deployed: boolean;
    features: string[];
    demos: Array<{ id: string }>;
  }>;
};

// Mirror the derivation logic from the smoke spec
let INTEGRATIONS: Array<{
  slug: string;
  name: string;
  backendUrl: string;
  deployed: boolean;
  hasToolRendering: boolean;
  demos: string[];
}>;

beforeAll(() => {
  runGenerator();
  dataRestorer.snapshot();

  const registryPath = path.join(SHELL_DATA_DIR, "registry.json");
  registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));

  INTEGRATIONS = registry.integrations.map((i) => ({
    slug: i.slug,
    name: i.name,
    backendUrl: i.backend_url,
    deployed: i.deployed,
    hasToolRendering: i.features.includes("tool-rendering"),
    demos: i.demos.map((d: { id: string }) => d.id),
  }));
});

afterEach(() => dataRestorer.restore());
afterAll(() => dataRestorer.restore());

describe("smoke spec integration registry derivation", () => {
  it("produces one entry per registry integration", () => {
    expect(INTEGRATIONS.length).toBe(registry.integrations.length);
  });

  it("every integration has a non-empty backendUrl", () => {
    for (const i of INTEGRATIONS) {
      expect(i.backendUrl, `${i.slug} missing backendUrl`).toBeTruthy();
      expect(i.backendUrl).toMatch(/^https?:\/\//);
    }
  });

  it("hasToolRendering matches features list", () => {
    for (const reg of registry.integrations) {
      const derived = INTEGRATIONS.find((i) => i.slug === reg.slug)!;
      expect(derived.hasToolRendering).toBe(
        reg.features.includes("tool-rendering"),
      );
    }
  });

  it("demo IDs match registry demos", () => {
    for (const reg of registry.integrations) {
      const derived = INTEGRATIONS.find((i) => i.slug === reg.slug)!;
      expect(derived.demos).toEqual(reg.demos.map((d) => d.id));
    }
  });

  it("slugs match registry exactly", () => {
    expect(INTEGRATIONS.map((i) => i.slug)).toEqual(
      registry.integrations.map((i) => i.slug),
    );
  });

  it("deployed filter works", () => {
    const deployed = INTEGRATIONS.filter((i) => i.deployed);
    const registryDeployed = registry.integrations.filter((i) => i.deployed);
    expect(deployed.length).toBe(registryDeployed.length);
    expect(deployed.length).toBeGreaterThan(0);
  });

  it("no hardcoded integration data remains in smoke spec", () => {
    const specPath = path.resolve(
      __dirname,
      "../../tests/e2e/integration-smoke.spec.ts",
    );
    const src = fs.readFileSync(specPath, "utf-8");
    // The old hardcoded array had Railway URLs inline
    expect(src).not.toContain("showcase-langgraph-python-production");
    expect(src).not.toContain("showcase-mastra-production");
    // Should not have a literal Integration[] type (replaced by inference)
    expect(src).not.toContain("const INTEGRATIONS: Integration[]");
  });
});
