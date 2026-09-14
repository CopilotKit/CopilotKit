import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { requiresConformance, gatePassed } from "../gate.mjs";

test("runtime, fixture, dependency, and gate changes require conformance", () => {
  for (const path of [
    "packages/runtime/src/v2/runtime/runner/intelligence.ts",
    "packages/shared/src/index.ts",
    "packages/core/src/index.ts",
    "packages/runtime-python/src/copilotkit_runtime/runtime.py",
    "packages/runtime-go/runtime.go",
    "packages/runtime-ruby/lib/copilotkit/runtime.rb",
    "packages/runtime-dotnet/src/IntelligenceRuntime.cs",
    "tools/runtime-conformance/platform.mjs",

    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "package.json",
    "nx.json",
    "tsconfig.base.json",
    ".github/workflows/intelligence-runtimes.yml",
    ".github/CODEOWNERS",
  ]) {
    assert.equal(requiresConformance([path]), true, path);
  }
});

test("docs-only and empty changes do not require native toolchains", () => {
  assert.equal(
    requiresConformance(["showcase/shell-docs/README.md", "README.md"]),
    false,
  );
  assert.equal(requiresConformance([]), false);
});

test("the gate accepts a successful matrix or an explicit unrelated change", () => {
  assert.equal(gatePassed("success", "true", "success"), true);
  assert.equal(gatePassed("success", "false", "skipped"), true);
});

test("the gate rejects failed, cancelled, missing, and unexpectedly skipped jobs", () => {
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    assert.equal(gatePassed("success", "true", result), false);
  }
  assert.equal(gatePassed("failure", "false", "skipped"), false);
  assert.equal(gatePassed("cancelled", "true", "success"), false);
  assert.equal(gatePassed("success", undefined, "success"), false);
  assert.equal(gatePassed("success", "false", "failure"), false);
});

test("moving a runtime file outside the package still requires conformance", () => {
  const cwd = mkdtempSync(join(tmpdir(), "runtime-gate-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init");
    mkdirSync(join(cwd, "packages", "runtime"), { recursive: true });
    mkdirSync(join(cwd, "docs"));
    writeFileSync(
      join(cwd, "packages", "runtime", "index.ts"),
      "export const runtime = true;\n",
    );
    git("add", ".");
    git(
      "-c",
      "user.name=Gate Test",
      "-c",
      "user.email=gate@example.test",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    );
    const base = git("rev-parse", "HEAD");
    git("mv", "packages/runtime/index.ts", "docs/runtime.ts");
    git(
      "-c",
      "user.name=Gate Test",
      "-c",
      "user.email=gate@example.test",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "move fixture",
    );
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL("../gate.mjs", import.meta.url)), "scope"],
      { cwd, encoding: "utf8", env: { ...process.env, BASE_SHA: base } },
    );
    assert.equal(output.trim(), "required=true");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("unrelated frontend packages and documentation scripts skip native toolchains", () => {
  assert.equal(
    requiresConformance([
      "packages/react-core/src/index.ts",
      "packages/react-ui/src/index.ts",
      "scripts/doc-tests/run.ts",
    ]),
    false,
  );
});
