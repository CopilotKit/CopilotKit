import { describe, it, expect } from "vitest";
import { listUnreadyFrameworks } from "./audit-docs-porting.js";
import { diffFramework } from "./audit-docs-porting.js";
import path from "path";
import fs from "fs";
import os from "os";

describe("listUnreadyFrameworks", () => {
  it("excludes the ready slugs and includes known unready ones", () => {
    const result = listUnreadyFrameworks();
    expect(result).not.toContain("langgraph-python");
    expect(result).not.toContain("langgraph-typescript");
    expect(result).not.toContain("google-adk");
    expect(result).toContain("mastra");
    expect(result).toContain("pydantic-ai");
    expect(result).toContain("ms-agent-dotnet");
  });
});

describe("diffFramework", () => {
  it("reports v1 pages missing from shell-docs as missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docs-port-"));
    const v1 = path.join(tmp, "v1");
    const shell = path.join(tmp, "shell");
    fs.mkdirSync(path.join(v1, "framework"), { recursive: true });
    fs.mkdirSync(path.join(shell, "framework"), { recursive: true });
    fs.writeFileSync(path.join(v1, "framework", "quickstart.mdx"), "# qs");
    fs.writeFileSync(path.join(v1, "framework", "frontend-tools.mdx"), "# ft");
    fs.writeFileSync(path.join(shell, "framework", "quickstart.mdx"), "# qs");

    const result = diffFramework({
      slug: "framework",
      v1Root: v1,
      shellDocsRoot: shell,
    });
    expect(result.missing).toEqual(["frontend-tools.mdx"]);
    expect(result.divergent).toEqual([]);
  });

  it("reports pages with different content as divergent", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docs-port-"));
    const v1 = path.join(tmp, "v1");
    const shell = path.join(tmp, "shell");
    fs.mkdirSync(path.join(v1, "framework"), { recursive: true });
    fs.mkdirSync(path.join(shell, "framework"), { recursive: true });
    fs.writeFileSync(path.join(v1, "framework", "quickstart.mdx"), "# v1");
    fs.writeFileSync(path.join(shell, "framework", "quickstart.mdx"), "# v2");

    const result = diffFramework({
      slug: "framework",
      v1Root: v1,
      shellDocsRoot: shell,
    });
    expect(result.missing).toEqual([]);
    expect(result.divergent).toEqual(["quickstart.mdx"]);
  });
});
