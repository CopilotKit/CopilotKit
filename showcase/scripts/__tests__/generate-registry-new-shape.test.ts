// generate-registry-new-shape.test.ts
//
// Tests for the new-shape (agents/<fw>/manifest.yaml) ingestion path added
// in Task 9. These tests call `runGenerator()` directly (in-process) with
// fixture directories and `dryRun: true`, so they:
//   - Do not write any real files.
//   - Do not spawn subprocesses (no npx/tsx).
//   - Run on all platforms (Windows, macOS, Linux).
//
// This is intentionally kept separate from generate-registry.test.ts, which
// invokes the generator as a subprocess and has a known Windows limitation
// (see test-cleanup.ts comments).

import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runGenerator } from "../generate-registry.js";

/** Directories created per test — cleaned up in afterEach. */
const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

/** Create a temp directory that will serve as the integrationsRoot fixture. */
function makeFixtureDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "gen-registry-new-shape-"),
  );
  tmpDirs.push(dir);
  return dir;
}

/** Write a file (creating parent dirs) inside the fixture root. */
function writeFile(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

describe("generate-registry: new-shape integrations", () => {
  it("synthesizes Integration from agents/<fw>/manifest.yaml + nextjs/demos.yaml", () => {
    const root = makeFixtureDir();
    writeFile(
      root,
      "agents/strands/manifest.yaml",
      [
        "name: Strands",
        "slug: strands",
        "language: python",
        "description: Test",
        "backend_url: http://strands-backend.local",
        "deployed: true",
        "sort_order: 130",
        "demos:",
        "  - id: agentic-chat",
        "    backend_highlight:",
        "      - src/agents/agentic_chat.py",
      ].join("\n") + "\n",
    );
    writeFile(root, "agents/strands/src/agents/agentic_chat.py", "");
    writeFile(
      root,
      "agents/strands/src/agent_server.py",
      'AGENT_FACTORIES = { "agentic-chat": x }',
    );
    // Use block form for frontend_highlight to avoid YAML parser treating
    // "[framework]" as a nested flow sequence.
    writeFile(
      root,
      "nextjs/demos.yaml",
      [
        "- id: agentic-chat",
        "  name: Agentic Chat",
        "  description: Natural conversation",
        "  tags:",
        "    - chat-ui",
        "  route_template: /demos/{framework}/agentic-chat",
        "  frontend_highlight:",
        "    - src/app/demos/framework/agentic-chat/page.tsx",
      ].join("\n") + "\n",
    );
    writeFile(
      root,
      "nextjs/src/app/demos/framework/agentic-chat/page.tsx",
      "",
    );

    const reg = runGenerator({
      integrationsRoot: root,
      unifiedFrontendUrl: "https://showcase.example.com",
      dryRun: true,
    });

    const s = reg.integrations.find((i: any) => i.slug === "strands");
    expect(s).toBeDefined();
    expect(s!.backend_url).toBe("https://showcase.example.com");
    expect(s!.agent_backend_url).toBe("http://strands-backend.local");
    expect(s!.unified).toBe(true);
    expect((s!.demos as any[])[0].route).toBe("/demos/strands/agentic-chat");
    expect((s!.demos as any[])[0].name).toBe("Agentic Chat");
  });

  it("new-shape wins when both shapes exist for same slug", () => {
    const root = makeFixtureDir();
    // Old-shape manifest must pass AJV schema validation: real feature IDs,
    // valid repo URI, at least 1 feature, demos with required fields.
    writeFile(
      root,
      "strands/manifest.yaml",
      [
        "name: Strands OLD",
        "slug: strands",
        "category: emerging",
        "language: python",
        "description: old",
        "repo: https://github.com/example/strands",
        "backend_url: https://old.example.com",
        "deployed: true",
        "features:",
        "  - cli-start",
        "demos:",
        "  - id: cli-start",
        "    name: CLI Start",
        "    description: Basic start",
        "    tags: []",
        "not_supported_features: []",
      ].join("\n") + "\n",
    );
    writeFile(
      root,
      "agents/strands/manifest.yaml",
      [
        "name: Strands NEW",
        "slug: strands",
        "language: python",
        "description: new",
        "backend_url: http://new.local",
        "deployed: true",
        "demos: []",
      ].join("\n") + "\n",
    );
    writeFile(
      root,
      "agents/strands/src/agent_server.py",
      "AGENT_FACTORIES = {}",
    );
    writeFile(root, "nextjs/demos.yaml", "[]\n");

    const reg = runGenerator({
      integrationsRoot: root,
      unifiedFrontendUrl: "https://showcase.example.com",
      dryRun: true,
    });

    const s = reg.integrations.find((i: any) => i.slug === "strands");
    expect(s).toBeDefined();
    expect(s!.name).toBe("Strands NEW");
    expect(s!.unified).toBe(true);
  });
});
