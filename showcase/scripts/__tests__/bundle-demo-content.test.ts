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
    expect(agenticChat.files.length).toBeGreaterThan(0);

    // In the per-cell column-container layout, paths are prefixed with
    // `backend/` or `frontend/`. The page.tsx lives under the frontend
    // subtree and agent.py under the backend subtree.
    const pageFile = agenticChat.files.find((f: any) =>
      (f.filename ?? f.path).endsWith("page.tsx"),
    );
    expect(pageFile).toBeDefined();
    expect(pageFile.language).toBe("typescript");
    expect(pageFile.content).toContain("CopilotKit");

    const agentFile = agenticChat.files.find((f: any) =>
      (f.filename ?? f.path).endsWith("agent.py"),
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
        const fileName = file.filename ?? file.path;
        if (fileName.endsWith(".tsx") || fileName.endsWith(".ts")) {
          expect(file.language).toBe("typescript");
        } else if (fileName.endsWith(".py")) {
          expect(file.language).toBe("python");
        } else if (fileName.endsWith(".css")) {
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

    // Under the per-cell column-container layout, backend files appear
    // in the unified `files` array with a `backend/` path prefix. Assert
    // that langgraph-python cells expose at least one Python file in the
    // backend subtree.
    const lgDemo = content.demos["langgraph-python::agentic-chat"];
    expect(lgDemo).toBeDefined();
    const pyBackend = lgDemo.files.filter((f: any) => {
      const p = f.filename ?? f.path;
      return p.startsWith("backend/") && p.endsWith(".py");
    });
    expect(pyBackend.length).toBeGreaterThan(0);
    expect(pyBackend[0].language).toBe("python");
  });

  it("includes every langgraph-python demo declared in the manifest", () => {
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

    // Core set that every langgraph-python release should carry — new
    // cells (tool-rendering-*catchall, chat-customization-css, A2UI
    // variants) are checked via the registry-count assertion in
    // generate-registry.test.ts, so keep this list focused on the
    // long-standing canonical demos.
    const expectedDemos = [
      "agentic-chat",
      "frontend-tools",
      "hitl-in-chat",
      "tool-rendering",
      "gen-ui-tool-based",
      "gen-ui-agent",
      "shared-state-read",
      "shared-state-write",
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
