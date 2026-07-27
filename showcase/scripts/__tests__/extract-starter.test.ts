import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { execOptsFor } from "./test-cleanup";
import { SCRIPTS_DIR } from "./paths";

describe("extract-starter", () => {
  it("adds .copilotkit/ to generated starter .gitignore", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "starter-"));

    try {
      execFileSync(
        "npx",
        ["tsx", "extract-starter.ts", "langgraph-python", outDir],
        execOptsFor(SCRIPTS_DIR),
      );

      const gitignore = fs.readFileSync(
        path.join(outDir, ".gitignore"),
        "utf-8",
      );
      expect(gitignore.split(/\r?\n/)).toContain(".copilotkit/");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
