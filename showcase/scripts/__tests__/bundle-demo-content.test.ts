import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { execOptsFor } from "./test-cleanup";
import { SCRIPTS_DIR, SHELL_DATA_DIR } from "./paths";

// `bundle-demo-content.ts` writes to showcase/shell/src/data/demo-content.json.
// The output is gitignored, so leaked writes do not dirty the working tree;
// we no longer snapshot/restore it. Each test invokes the bundler itself and
// reads the fresh output.
const CONTENT_PATH = path.join(SHELL_DATA_DIR, "demo-content.json");

const EXEC_OPTS = execOptsFor(SCRIPTS_DIR);

/** Invoke the bundler via argv form — argv-safe, no shell parser involvement.
 *  Returns raw stdout so the call sites that need it (test 1) can assert
 *  against it. */
function runBundler(): string {
  const out = execFileSync("npx", ["tsx", "bundle-demo-content.ts"], EXEC_OPTS);
  return out.toString();
}

/** Run the bundler and return the parsed demo-content.json. */
function runBundlerAndRead(): any {
  runBundler();
  return JSON.parse(fs.readFileSync(CONTENT_PATH, "utf-8"));
}

describe("Content Bundler", () => {
  it("generates demo-content.json from existing packages", () => {
    const stdout = runBundler();

    expect(stdout).toContain("Bundling demo content");
    expect(stdout).toContain("langgraph-python::agentic-chat");

    expect(fs.existsSync(CONTENT_PATH)).toBe(true);

    const content = JSON.parse(fs.readFileSync(CONTENT_PATH, "utf-8"));
    expect(content.generated_at).toBeDefined();
    expect(Object.keys(content.demos).length).toBeGreaterThan(0);
  });

  it("bundles correct files for each demo", () => {
    const content = runBundlerAndRead();

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

  it("detects correct language for each file type", () => {
    const content = runBundlerAndRead();

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

  it("includes backend files for packages with agent code", () => {
    const content = runBundlerAndRead();

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
    const content = runBundlerAndRead();

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
