import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Content Bundler", () => {
  it("generates demo-content.json from existing packages", async () => {
    const { execSync } = await import("child_process");
    const scriptsDir = path.resolve(__dirname, "..");

    const stdout = execSync("npx tsx bundle-demo-content.ts", {
      cwd: scriptsDir,
      encoding: "utf-8",
      timeout: 15000,
    });

    expect(stdout).toContain("Bundling demo content");
    expect(stdout).toContain("langgraph-python::agentic-chat");

    const contentPath = path.resolve(
      scriptsDir,
      "..",
      "shell",
      "src",
      "data",
      "demo-content.json",
    );
    expect(fs.existsSync(contentPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(contentPath, "utf-8"));
    expect(content.generated_at).toBeDefined();
    expect(Object.keys(content.demos).length).toBeGreaterThan(0);
  });

  it("bundles correct files for each demo", async () => {
    const contentPath = path.resolve(
      __dirname,
      "..",
      "..",
      "shell",
      "src",
      "data",
      "demo-content.json",
    );

    if (!fs.existsSync(contentPath)) {
      // Run bundler first
      const { execSync } = await import("child_process");
      execSync("npx tsx bundle-demo-content.ts", {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf-8",
        timeout: 15000,
      });
    }

    const content = JSON.parse(fs.readFileSync(contentPath, "utf-8"));

    const agenticChat = content.demos["langgraph-python::agentic-chat"];
    expect(agenticChat).toBeDefined();
    expect(agenticChat.readme).toBeTruthy();
    expect(agenticChat.readme).toContain("Agentic Chat");
    expect(agenticChat.files.length).toBeGreaterThan(0);

    // page.tsx should be first (sorted by bundler); its bundled filename
    // is the column-relative path.
    expect(agenticChat.files[0].filename).toBe(
      "src/app/demos/agentic-chat/page.tsx",
    );
    expect(agenticChat.files[0].language).toBe("typescript");
    expect(agenticChat.files[0].content).toContain("CopilotKit");

    // Backend agent file (from manifest.highlight) should be present.
    const agentFile = agenticChat.files.find((f: any) =>
      /agents\/agentic_chat\.py$/.test(f.filename),
    );
    expect(agentFile).toBeDefined();
    expect(agentFile.language).toBe("python");
  });

  it("detects correct language for each file type", async () => {
    const contentPath = path.resolve(
      __dirname,
      "..",
      "..",
      "shell",
      "src",
      "data",
      "demo-content.json",
    );
    const content = JSON.parse(fs.readFileSync(contentPath, "utf-8"));

    for (const [, demo] of Object.entries(content.demos) as any) {
      for (const file of demo.files) {
        if (file.filename.endsWith(".tsx") || file.filename.endsWith(".ts")) {
          expect(file.language).toBe("typescript");
        } else if (file.filename.endsWith(".py")) {
          expect(file.language).toBe("python");
        } else if (file.filename.endsWith(".css")) {
          expect(file.language).toBe("css");
        }
      }
    }
  });

  it("includes backend files for packages with agent code", async () => {
    const contentPath = path.resolve(
      __dirname,
      "..",
      "..",
      "shell",
      "src",
      "data",
      "demo-content.json",
    );
    const content = JSON.parse(fs.readFileSync(contentPath, "utf-8"));

    // langgraph-python: backend files are merged into the flat `files`
    // list via the manifest's `highlight:` entries (column-relative paths
    // like src/agents/main.py).
    const lgDemo = content.demos["langgraph-python::agentic-chat"];
    expect(lgDemo).toBeDefined();
    const lgAgent = lgDemo.files.find((f: any) =>
      /src\/agents\/agentic_chat\.py$/.test(f.filename),
    );
    expect(lgAgent).toBeDefined();
    expect(lgAgent.language).toBe("python");
  });

  it("includes core langgraph-python demos", () => {
    const contentPath = path.resolve(
      __dirname,
      "..",
      "..",
      "shell",
      "src",
      "data",
      "demo-content.json",
    );
    const content = JSON.parse(fs.readFileSync(contentPath, "utf-8"));

    const expectedDemos = [
      "agentic-chat",
      "frontend-tools",
      "hitl-in-chat",
      "tool-rendering",
      "gen-ui-tool-based",
      "gen-ui-agent",
      "shared-state-read-write",
      "shared-state-streaming",
      "subagents",
    ];

    for (const demoId of expectedDemos) {
      const key = `langgraph-python::${demoId}`;
      expect(content.demos[key]).toBeDefined();
      expect(content.demos[key].files.length).toBeGreaterThan(0);
    }
  });
});
