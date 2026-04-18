import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import yaml from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const SCRIPTS_DIR = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.resolve(SCRIPTS_DIR, "..", "packages");
const SCHEMA_PATH = path.resolve(
  SCRIPTS_DIR,
  "..",
  "shared",
  "manifest.schema.json",
);
const FEATURE_REGISTRY_PATH = path.resolve(
  SCRIPTS_DIR,
  "..",
  "shared",
  "feature-registry.json",
);

const TEST_SLUG = "test-integration-tmp";
const TEST_DIR = path.join(PACKAGES_DIR, TEST_SLUG);

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// Clean up before AND after — handles leftover dirs from killed CI runs
beforeAll(cleanup);
afterEach(cleanup);
afterAll(cleanup);

describe("Template Generator", () => {
  it("generates a valid package structure", async () => {
    cleanup();
    const { execSync } = await import("child_process");

    execSync(
      `npx tsx create-integration/index.ts --name "Test Integration" --slug ${TEST_SLUG} --category agent-framework --language python --features agentic-chat,hitl-in-chat`,
      { cwd: SCRIPTS_DIR, encoding: "utf-8", timeout: 15000 },
    );

    // Check directory exists
    expect(fs.existsSync(TEST_DIR)).toBe(true);

    // Check required files
    const requiredFiles = [
      "manifest.yaml",
      "package.json",
      "Dockerfile",
      "entrypoint.sh",
      ".env.example",
      ".gitignore",
      "next.config.ts",
      "tsconfig.json",
      "playwright.config.ts",
      "requirements.txt",
      "src/agent_server.py",
      "src/app/layout.tsx",
      "src/app/globals.css",
      "src/app/page.tsx",
      "src/app/api/copilotkit/route.ts",
      "src/app/api/health/route.ts",
    ];

    for (const file of requiredFiles) {
      expect(fs.existsSync(path.join(TEST_DIR, file))).toBe(true);
    }
  });

  it("generates a manifest that passes schema validation", async () => {
    cleanup();
    const { execSync } = await import("child_process");

    execSync(
      `npx tsx create-integration/index.ts --name "Test Integration" --slug ${TEST_SLUG} --category provider-sdk --language typescript --features agentic-chat,tool-rendering,mcp-apps`,
      { cwd: SCRIPTS_DIR, encoding: "utf-8", timeout: 15000 },
    );

    const manifest = yaml.parse(
      fs.readFileSync(path.join(TEST_DIR, "manifest.yaml"), "utf-8"),
    );

    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8"));
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const valid = validate(manifest);

    if (!valid) {
      console.error("Validation errors:", validate.errors);
    }
    expect(valid).toBe(true);

    // New fields should be present with defaults
    expect(manifest.generative_ui).toEqual(["constrained-explicit"]);
    expect(manifest.interaction_modalities).toEqual(["chat"]);
  });

  it("generates correct demo stubs for each feature", async () => {
    cleanup();
    const { execSync } = await import("child_process");

    execSync(
      `npx tsx create-integration/index.ts --name "Test Integration" --slug ${TEST_SLUG} --category agent-framework --language python --features agentic-chat,hitl-in-chat,subagents`,
      { cwd: SCRIPTS_DIR, encoding: "utf-8", timeout: 15000 },
    );

    const demoIds = ["agentic-chat", "hitl-in-chat", "subagents"];

    for (const demoId of demoIds) {
      const demoDir = path.join(TEST_DIR, "src", "app", "demos", demoId);
      expect(fs.existsSync(demoDir)).toBe(true);

      // Frontend page
      expect(fs.existsSync(path.join(demoDir, "page.tsx"))).toBe(true);
      const page = fs.readFileSync(path.join(demoDir, "page.tsx"), "utf-8");
      expect(page).toContain("CopilotKit");
      expect(page).toContain("CopilotChat");

      // Agent file (Python for this test)
      expect(fs.existsSync(path.join(demoDir, "agent.py"))).toBe(true);

      // README
      expect(fs.existsSync(path.join(demoDir, "README.md"))).toBe(true);

      // E2E test
      expect(
        fs.existsSync(path.join(TEST_DIR, "tests", "e2e", `${demoId}.spec.ts`)),
      ).toBe(true);

      // QA template
      expect(fs.existsSync(path.join(TEST_DIR, "qa", `${demoId}.md`))).toBe(
        true,
      );
    }
  });

  it("generates TypeScript agent files for TS integrations", async () => {
    cleanup();
    const { execSync } = await import("child_process");

    execSync(
      `npx tsx create-integration/index.ts --name "Test TS" --slug ${TEST_SLUG} --category agent-framework --language typescript --features agentic-chat`,
      { cwd: SCRIPTS_DIR, encoding: "utf-8", timeout: 15000 },
    );

    const demoDir = path.join(TEST_DIR, "src", "app", "demos", "agentic-chat");
    expect(fs.existsSync(path.join(demoDir, "agent.ts"))).toBe(true);
    expect(fs.existsSync(path.join(demoDir, "agent.py"))).toBe(false);

    // No requirements.txt for TS
    expect(fs.existsSync(path.join(TEST_DIR, "requirements.txt"))).toBe(false);
  });

  it("generates manifest with all declared features and demos", async () => {
    cleanup();
    const { execSync } = await import("child_process");

    const features = [
      "agentic-chat",
      "hitl-in-chat",
      "tool-rendering",
      "mcp-apps",
    ];

    execSync(
      `npx tsx create-integration/index.ts --name "Test" --slug ${TEST_SLUG} --category agent-framework --language python --features ${features.join(",")}`,
      { cwd: SCRIPTS_DIR, encoding: "utf-8", timeout: 15000 },
    );

    const manifest = yaml.parse(
      fs.readFileSync(path.join(TEST_DIR, "manifest.yaml"), "utf-8"),
    );

    expect(manifest.features).toEqual(features);
    expect(manifest.demos.length).toBe(features.length);

    for (const demo of manifest.demos) {
      expect(features).toContain(demo.id);
      expect(demo.name).toBeTruthy();
      expect(demo.description).toBeTruthy();
      expect(demo.route).toMatch(/^\/demos\//);
      expect(demo.tags.length).toBeGreaterThan(0);
    }
  });

  it("refuses to create a package if directory already exists", async () => {
    cleanup();
    const { execSync } = await import("child_process");

    // Create first
    execSync(
      `npx tsx create-integration/index.ts --name "Test" --slug ${TEST_SLUG} --category agent-framework --language python --features agentic-chat`,
      { cwd: SCRIPTS_DIR, encoding: "utf-8", timeout: 15000 },
    );

    // Try to create again
    try {
      execSync(
        `npx tsx create-integration/index.ts --name "Test" --slug ${TEST_SLUG} --category agent-framework --language python --features agentic-chat`,
        { cwd: SCRIPTS_DIR, encoding: "utf-8", timeout: 15000 },
      );
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.stderr || e.stdout).toContain("already exists");
    }
  });

  it("validates feature IDs against the registry", () => {
    const featureRegistry = JSON.parse(
      fs.readFileSync(FEATURE_REGISTRY_PATH, "utf-8"),
    );
    const validIds = new Set(featureRegistry.features.map((f: any) => f.id));

    // All features in the registry should have valid IDs
    for (const feature of featureRegistry.features) {
      expect(feature.id).toMatch(/^[a-z0-9-]+$/);
      expect(feature.name).toBeTruthy();
      expect(feature.category).toBeTruthy();
      expect(feature.description).toBeTruthy();
    }

    // Registry should have all expected categories
    const categories = new Set(
      featureRegistry.categories.map((c: any) => c.id),
    );
    expect(categories.has("chat-ui")).toBe(true);
    expect(categories.has("generative-ui")).toBe(true);
    expect(categories.has("agent-state")).toBe(true);
    expect(categories.has("interactivity")).toBe(true);
    expect(categories.has("multi-agent")).toBe(true);
    expect(categories.has("platform")).toBe(true);
  });
});
