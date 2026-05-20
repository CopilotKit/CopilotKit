// Split from validate-pins.test.ts — see validate-pins.shared.ts header
// for the full rationale (vitest birpc 60s cliff, fork-per-file).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import {} from "../validate-pins.js";
import {
  VALIDATE_PINS_SCRIPT,
  tmpdir,
  withTmp,
  write,
} from "./validate-pins.shared.js";

describe("validate-pins CLI exit codes", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = tmpdir();
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "integrations"), {
      recursive: true,
    });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function runCli() {
    return spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
      encoding: "utf-8",
      env: { ...process.env, VALIDATE_PINS_REPO_ROOT: repoRoot },
      timeout: 30_000,
    });
  }

  it("exits 1 when FAIL>0 (real drift: non-exact pin)", () => {
    // Create a slug with a non-exact spec on both sides to force a
    // drift [FAIL] — this exercises the EXIT_DRIFT path rather than
    // the EXIT_UNREADABLE path that missing/empty packages dirs now
    // take.
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "integrations", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.mkdirSync(exDir, { recursive: true });
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "next" },
      }),
    );
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "next" },
      }),
    );
    const r = runCli();
    expect(r.status, r.stdout + r.stderr).toBe(1);
  });

  it("exits 0 when clean (all [OK]/[SKIP])", () => {
    // Create one born-in-showcase slug → [SKIP], FAIL=0, exit 0.
    fs.mkdirSync(path.join(repoRoot, "showcase", "integrations", "ag2"), {
      recursive: true,
    });
    const r = runCli();
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
describe("validate-pins CLI exit code 3 (unreadable input)", () => {
  it("exits 3 when VALIDATE_PINS_REPO_ROOT points at a non-directory", () => {
    const tmp = tmpdir();
    try {
      const filePath = path.join(tmp, "not-a-dir");
      fs.writeFileSync(filePath, "x");
      const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
        encoding: "utf-8",
        env: { ...process.env, VALIDATE_PINS_REPO_ROOT: filePath },
        timeout: 30_000,
      });
      expect(r.status, r.stdout + r.stderr).toBe(3);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
describe("module import does not invoke main()", () => {
  it("importing the module exits cleanly (status 0)", () => {
    // Use tsx's module loader via a small inline program that imports
    // validate-pins.js. If main() were invoked on import, the process
    // would exit with the validator's report status (likely 1 in this
    // test environment), NOT 0.
    const prog = `import(${JSON.stringify(
      VALIDATE_PINS_SCRIPT,
    )}).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(42); });`;

    const r = spawnSync("npx", ["tsx", "-e", prog], {
      encoding: "utf-8",
      env: {
        ...process.env,
        // Point REPO_ROOT at this worktree so computeRepoRoot's override
        // validation passes; the value is irrelevant because main() must
        // not run.
        VALIDATE_PINS_REPO_ROOT: path.resolve(__dirname, "..", "..", ".."),
      },
      timeout: 30_000,
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
